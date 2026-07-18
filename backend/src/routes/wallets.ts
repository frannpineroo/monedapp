import { Router } from 'express'
import { AccountKind, Currency } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { serializeWallet } from '../lib/serializers'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { paramId } from '../lib/params'

const router = Router()
router.use(requireAuth)

function parseCurrency(value: unknown): Currency {
  if (typeof value !== 'string' || !(value in Currency)) {
    throw new AppError(400, 'Moneda inválida (ARS|USD|USDT)')
  }
  return value as Currency
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const wallets = await prisma.wallet.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    })
    res.json(wallets.map(serializeWallet))
  })
)

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { name, currency } = req.body as { name?: unknown; currency?: unknown }

    if (typeof name !== 'string' || name.trim() === '') {
      throw new AppError(400, 'El nombre es requerido')
    }
    const cur = parseCurrency(currency)

    const wallet = await prisma.$transaction(async (tx) => {
      const accountName = `${name.trim()} (${cur})`
      const account = await tx.account.create({
        data: {
          userId,
          name: accountName,
          kind: AccountKind.ASSET,
          currency: cur,
        },
      })
      return tx.wallet.create({
        data: {
          userId,
          accountId: account.id,
          currency: cur,
          name: name.trim(),
        },
      })
    })

    res.status(201).json(serializeWallet(wallet))
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const id = paramId(req.params.id)
    const wallet = await prisma.wallet.findFirst({
      where: { id, userId },
    })
    if (!wallet) throw new AppError(404, 'Billetera no encontrada')
    res.json(serializeWallet(wallet))
  })
)

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { name } = req.body as { name?: unknown }
    const id = paramId(req.params.id)

    const existing = await prisma.wallet.findFirst({
      where: { id, userId },
    })
    if (!existing) throw new AppError(404, 'Billetera no encontrada')

    if (typeof name !== 'string' || name.trim() === '') {
      throw new AppError(400, 'El nombre es requerido')
    }

    const wallet = await prisma.wallet.update({
      where: { id: existing.id },
      data: { name: name.trim() },
    })
    res.json(serializeWallet(wallet))
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const id = paramId(req.params.id)
    const existing = await prisma.wallet.findFirst({
      where: { id, userId },
    })
    if (!existing) throw new AppError(404, 'Billetera no encontrada')

    const movementCount = await prisma.movement.count({ where: { walletId: existing.id } })
    if (movementCount > 0) {
      throw new AppError(400, 'No se puede borrar una billetera con movimientos')
    }

    await prisma.$transaction(async (tx) => {
      await tx.wallet.delete({ where: { id: existing.id } })
      await tx.account.delete({ where: { id: existing.accountId } })
    })

    res.status(204).send()
  })
)

export default router
