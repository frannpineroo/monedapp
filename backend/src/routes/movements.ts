import { Router } from 'express'
import { Currency, MovementType, Prisma } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { serializeMovement } from '../lib/serializers'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { paramId } from '../lib/params'
import { createLedgerForMovement } from '../services/ledgerService'
import {
  parseExchangeRateType,
  resolveExchangeRateId,
} from '../services/exchangeRateService'

const router = Router()
router.use(requireAuth)

const movementInclude = {
  wallet: { select: { id: true, name: true, currency: true } },
  client: { select: { id: true, name: true } },
} as const

function parseMovementType(value: unknown): MovementType {
  if (typeof value !== 'string' || !(value in MovementType)) {
    throw new AppError(400, 'type inválido (income|expense|transfer)')
  }
  return value as MovementType
}

function parseDate(value: unknown): Date {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new AppError(400, 'date debe ser una fecha válida')
  }
  const d = new Date(value)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { walletId, clientId, type, from, to } = req.query

    const where: Prisma.MovementWhereInput = { userId }

    if (typeof walletId === 'string') where.walletId = walletId
    if (typeof clientId === 'string') where.clientId = clientId
    if (typeof type === 'string') where.type = parseMovementType(type)
    if (typeof from === 'string' || typeof to === 'string') {
      where.date = {}
      if (typeof from === 'string') where.date.gte = parseDate(from)
      if (typeof to === 'string') where.date.lte = parseDate(to)
    }

    const movements = await prisma.movement.findMany({
      where,
      include: movementInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    })
    res.json(movements.map(serializeMovement))
  })
)

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const {
      walletId,
      clientId,
      toWalletId,
      type,
      amount,
      description,
      date,
      exchangeRateType,
    } = req.body as Record<string, unknown>

    if (typeof walletId !== 'string') throw new AppError(400, 'walletId es requerido')
    if (typeof description !== 'string' || description.trim() === '') {
      throw new AppError(400, 'description es requerida')
    }
    const movementType = parseMovementType(type)
    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new AppError(400, 'amount debe ser un número mayor a 0')
    }
    const movementDate = parseDate(date ?? new Date().toISOString())
    const rateType = parseExchangeRateType(exchangeRateType)

    const wallet = await prisma.wallet.findFirst({
      where: { id: walletId, userId },
    })
    if (!wallet) throw new AppError(404, 'Billetera no encontrada')

    let toWalletAccountId: string | null = null
    if (movementType === MovementType.transfer) {
      if (typeof toWalletId !== 'string') {
        throw new AppError(400, 'toWalletId es requerido para transferencias')
      }
      const toWallet = await prisma.wallet.findFirst({
        where: { id: toWalletId, userId },
      })
      if (!toWallet) throw new AppError(404, 'Billetera destino no encontrada')
      if (toWallet.currency !== wallet.currency) {
        throw new AppError(400, 'Las transferencias deben ser en la misma moneda')
      }
      toWalletAccountId = toWallet.accountId
    }

    if (clientId !== undefined && clientId !== null) {
      if (typeof clientId !== 'string') throw new AppError(400, 'clientId inválido')
      const client = await prisma.client.findFirst({
        where: { id: clientId, userId },
      })
      if (!client) throw new AppError(404, 'Cliente no encontrado')
      if (movementType !== MovementType.income) {
        throw new AppError(400, 'clientId solo aplica a ingresos')
      }
    }

    const exchangeRateId = await resolveExchangeRateId(wallet.currency, movementDate, rateType)

    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.movement.create({
        data: {
          userId,
          walletId: wallet.id,
          clientId: typeof clientId === 'string' ? clientId : null,
          toWalletId: typeof toWalletId === 'string' ? toWalletId : null,
          type: movementType,
          amount: new Prisma.Decimal(amountNum),
          currency: wallet.currency as Currency,
          exchangeRateId,
          description: description.trim(),
          date: movementDate,
        },
      })

      await createLedgerForMovement(tx, {
        userId,
        movementId: created.id,
        type: movementType,
        amount: created.amount,
        currency: created.currency,
        walletAccountId: wallet.accountId,
        toWalletAccountId,
      })

      return tx.movement.findUniqueOrThrow({
        where: { id: created.id },
        include: movementInclude,
      })
    })

    res.status(201).json(serializeMovement(movement))
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const id = paramId(req.params.id)
    const movement = await prisma.movement.findFirst({
      where: { id, userId },
      include: movementInclude,
    })
    if (!movement) throw new AppError(404, 'Movimiento no encontrado')
    res.json(serializeMovement(movement))
  })
)

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const id = paramId(req.params.id)
    const existing = await prisma.movement.findFirst({
      where: { id, userId },
      include: { wallet: true },
    })
    if (!existing) throw new AppError(404, 'Movimiento no encontrado')

    const { description, date, clientId } = req.body as Record<string, unknown>
    const data: Prisma.MovementUpdateInput = {}

    if (description !== undefined) {
      if (typeof description !== 'string' || description.trim() === '') {
        throw new AppError(400, 'description inválida')
      }
      data.description = description.trim()
    }
    if (date !== undefined) {
      data.date = parseDate(date)
    }
    if (clientId !== undefined) {
      if (clientId === null) {
        data.client = { disconnect: true }
      } else if (typeof clientId === 'string') {
        const client = await prisma.client.findFirst({
          where: { id: clientId, userId },
        })
        if (!client) throw new AppError(404, 'Cliente no encontrado')
        data.client = { connect: { id: clientId } }
      } else {
        throw new AppError(400, 'clientId inválido')
      }
    }

    const movement = await prisma.movement.update({
      where: { id: existing.id },
      data,
      include: movementInclude,
    })
    res.json(serializeMovement(movement))
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const id = paramId(req.params.id)
    const existing = await prisma.movement.findFirst({
      where: { id, userId },
    })
    if (!existing) throw new AppError(404, 'Movimiento no encontrado')

    await prisma.movement.delete({ where: { id: existing.id } })
    res.status(204).send()
  })
)

export default router
