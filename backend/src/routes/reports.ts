import { Router } from 'express'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { serializeWallet } from '../lib/serializers'

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

export default router
