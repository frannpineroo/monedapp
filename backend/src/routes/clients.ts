import { Router } from 'express'
import { Currency } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { serializeClient } from '../lib/serializers'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { paramId } from '../lib/params'

const router = Router()
router.use(requireAuth)

function parseCurrency(value: unknown, fallback: Currency = Currency.ARS): Currency {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string' || !(value in Currency)) {
    throw new AppError(400, 'Moneda inválida (ARS|USD|USDT)')
  }
  return value as Currency
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const clients = await prisma.client.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    })
    res.json(clients.map(serializeClient))
  })
)

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { name, defaultCurrency } = req.body as {
      name?: unknown
      defaultCurrency?: unknown
    }

    if (typeof name !== 'string' || name.trim() === '') {
      throw new AppError(400, 'El nombre es requerido')
    }

    const client = await prisma.client.create({
      data: {
        userId,
        name: name.trim(),
        defaultCurrency: parseCurrency(defaultCurrency),
      },
    })
    res.status(201).json(serializeClient(client))
  })
)

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const id = paramId(req.params.id)
    const existing = await prisma.client.findFirst({
      where: { id, userId },
    })
    if (!existing) throw new AppError(404, 'Cliente no encontrado')

    const { name, defaultCurrency } = req.body as {
      name?: unknown
      defaultCurrency?: unknown
    }

    const data: { name?: string; defaultCurrency?: Currency } = {}
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        throw new AppError(400, 'El nombre es inválido')
      }
      data.name = name.trim()
    }
    if (defaultCurrency !== undefined) {
      data.defaultCurrency = parseCurrency(defaultCurrency)
    }

    const client = await prisma.client.update({
      where: { id: existing.id },
      data,
    })
    res.json(serializeClient(client))
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const id = paramId(req.params.id)
    const existing = await prisma.client.findFirst({
      where: { id, userId },
    })
    if (!existing) throw new AppError(404, 'Cliente no encontrado')

    await prisma.client.delete({ where: { id: existing.id } })
    res.status(204).send()
  })
)

export default router
