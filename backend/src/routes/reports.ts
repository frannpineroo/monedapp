import { Router } from 'express'
import { MovementType } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { serializeWallet } from '../lib/serializers'
import { getMonotributoAlert, getMonthlySummary, sumByCategory } from '../services/reportService'

const router = Router()
router.use(requireAuth)

router.get(
  '/balance-by-wallet',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest

    const wallets = await prisma.wallet.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    })

    const balances = await Promise.all(
      wallets.map(async (wallet) => {
        const aggregate = await prisma.ledgerEntry.aggregate({
          where: { accountId: wallet.accountId },
          _sum: { change: true },
        })
        return {
          wallet: serializeWallet(wallet),
          balance: aggregate._sum.change ?? 0,
          currency: wallet.currency,
        }
      })
    )

    res.json(balances)
  })
)

/** 'YYYY-MM' → [primer día del mes, primer día del siguiente), en UTC. */
function parseMonth(value: unknown): { from: Date; to: Date } {
  const now = new Date()
  const raw =
    typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
      ? value
      : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  const [year, month] = raw.split('-').map(Number)
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 1)),
  }
}

router.get(
  '/by-category',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { month, type } = req.query

    if (type !== undefined && type !== 'expense' && type !== 'income') {
      throw new AppError(400, 'type inválido (expense|income)')
    }
    const movementType = type === 'income' ? MovementType.income : MovementType.expense
    const { from, to } = parseMonth(month)

    const movements = await prisma.movement.findMany({
      where: { userId, type: movementType, date: { gte: from, lt: to } },
      select: {
        categoryAccountId: true,
        amount: true,
        categoryAccount: { select: { name: true } },
        exchangeRate: { select: { value: true } },
      },
    })

    res.json(sumByCategory(movements))
  })
)

router.get(
  '/monotributo-alert',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    res.json(await getMonotributoAlert(userId))
  })
)

router.get(
  '/monthly-summary',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { month } = req.query

    if (month !== undefined && (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month))) {
      throw new AppError(400, 'month debe tener el formato YYYY-MM')
    }

    res.json(await getMonthlySummary(userId, month as string | undefined))
  })
)

export default router
