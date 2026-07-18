import { Router } from 'express'
import { Currency } from '@prisma/client'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { getRates } from '../services/exchangeRateService'

const router = Router()
router.use(requireAuth)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { currency, date } = req.query

    if (typeof currency !== 'string' || !(currency in Currency)) {
      throw new AppError(400, 'currency es requerido (ARS|USD|USDT)')
    }

    const d =
      typeof date === 'string' && !Number.isNaN(new Date(date).getTime())
        ? new Date(date)
        : new Date()

    const rates = await getRates(currency as Currency, d)
    res.json(
      rates.map((r) => ({
        id: r.id,
        date: r.date,
        type: r.type,
        currency: r.currency,
        value: r.value,
        source: r.source,
      }))
    )
  })
)

export default router
