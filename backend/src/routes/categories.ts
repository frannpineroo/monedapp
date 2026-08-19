import { Router } from 'express'
import { AccountKind } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { paramId } from '../lib/params'
import { serializeCategory } from '../lib/serializers'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { ensureDefaultCategories, FX_DIFFERENCE_ACCOUNT_NAME, RECEIVABLES_ACCOUNT_NAME } from '../services/onboardingService'

const router = Router()
router.use(requireAuth)

/** Cuentas internas que el usuario no maneja como categoría. */
export const SYSTEM_CATEGORY_NAMES = [RECEIVABLES_ACCOUNT_NAME, FX_DIFFERENCE_ACCOUNT_NAME]

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

async function findOwnedCategory(userId: string, id: string) {
  const category = await prisma.account.findFirst({
    where: { id, userId, kind: { in: CATEGORY_KINDS }, name: { notIn: SYSTEM_CATEGORY_NAMES } },
  })
  if (!category) throw new AppError(404, 'Categoría no encontrada')
  return category
}

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const category = await findOwnedCategory(userId, paramId(req.params.id))
    const { name } = req.body as { name?: unknown }

    if (typeof name !== 'string' || name.trim() === '') {
      throw new AppError(400, 'El nombre es requerido')
    }

    const updated = await prisma.account.update({
      where: { id: category.id },
      data: { name: name.trim() },
    })
    res.json(serializeCategory(updated))
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const category = await findOwnedCategory(userId, paramId(req.params.id))

    const movementCount = await prisma.movement.count({
      where: { categoryAccountId: category.id },
    })
    // Los movimientos viejos (previos al backfill) solo aparecen en el ledger.
    const entryCount = await prisma.ledgerEntry.count({ where: { accountId: category.id } })
    if (movementCount > 0 || entryCount > 0) {
      throw new AppError(400, 'No se puede borrar una categoría con movimientos')
    }

    const sameKindCount = await prisma.account.count({
      where: { userId, kind: category.kind, name: { notIn: SYSTEM_CATEGORY_NAMES } },
    })
    if (sameKindCount <= 1) {
      throw new AppError(400, 'No se puede borrar la última categoría de este tipo')
    }

    await prisma.account.delete({ where: { id: category.id } })
    res.status(204).send()
  })
)

export default router
