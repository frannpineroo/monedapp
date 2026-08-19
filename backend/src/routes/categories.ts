import { Router } from 'express'
import { AccountKind } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { serializeCategory } from '../lib/serializers'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { ensureDefaultCategories } from '../services/onboardingService'

const router = Router()
router.use(requireAuth)

/** Cuentas internas que el usuario no maneja como categoría. */
export const SYSTEM_CATEGORY_NAMES = ['Deudores por ventas', 'Diferencia de cambio']

const CATEGORY_KINDS = [AccountKind.EXPENSE, AccountKind.INCOME]

export function parseCategoryKind(value: unknown): AccountKind {
  if (value !== 'EXPENSE' && value !== 'INCOME') {
    throw new AppError(400, 'kind inválido (EXPENSE|INCOME)')
  }
  return value as AccountKind
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { kind } = req.query

    const kinds = kind === undefined ? CATEGORY_KINDS : [parseCategoryKind(kind)]

    const categories = await prisma.account.findMany({
      where: { userId, kind: { in: kinds }, name: { notIn: SYSTEM_CATEGORY_NAMES } },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    })

    res.json(categories.map(serializeCategory))
  })
)

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { name, kind } = req.body as { name?: unknown; kind?: unknown }

    if (typeof name !== 'string' || name.trim() === '') {
      throw new AppError(400, 'El nombre es requerido')
    }

    // Nombre repetido → P2002 → 409 desde asyncHandler.
    const category = await prisma.account.create({
      data: { userId, name: name.trim(), kind: parseCategoryKind(kind), currency: null },
    })

    res.status(201).json(serializeCategory(category))
  })
)

router.post(
  '/defaults',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const categories = await ensureDefaultCategories(userId)
    res.json(
      categories
        .filter((c) => !SYSTEM_CATEGORY_NAMES.includes(c.name))
        .map(serializeCategory)
    )
  })
)

export default router
