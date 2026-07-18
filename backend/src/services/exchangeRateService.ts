import { Currency, ExchangeRateType, Prisma } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { AppError } from '../lib/errors'

const STUB_RATES: Record<ExchangeRateType, number> = {
  oficial: 980,
  blue: 1280,
  mep: 1210,
}

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export async function ensureRateForDate(
  date: Date,
  currency: Currency,
  type: ExchangeRateType = ExchangeRateType.blue
) {
  if (currency === Currency.ARS) {
    const d = dateOnly(date)
    return prisma.exchangeRate.upsert({
      where: {
        date_type_currency: { date: d, type, currency: Currency.ARS },
      },
      create: {
        date: d,
        type,
        currency: Currency.ARS,
        value: new Prisma.Decimal(1),
        source: 'stub',
      },
      update: {},
    })
  }

  const d = dateOnly(date)
  const value = STUB_RATES[type]

  return prisma.exchangeRate.upsert({
    where: {
      date_type_currency: { date: d, type, currency },
    },
    create: {
      date: d,
      type,
      currency,
      value: new Prisma.Decimal(value),
      source: 'stub',
    },
    update: {},
  })
}

export async function getRates(currency: Currency, date: Date) {
  const d = dateOnly(date)
  const types = Object.values(ExchangeRateType)

  const rates = []
  for (const type of types) {
    rates.push(await ensureRateForDate(d, currency, type))
  }
  return rates
}

export async function resolveExchangeRateId(
  currency: Currency,
  date: Date,
  type: ExchangeRateType = ExchangeRateType.blue
): Promise<string> {
  const rate = await ensureRateForDate(date, currency, type)
  return rate.id
}

export function parseExchangeRateType(value: unknown): ExchangeRateType {
  if (value === undefined || value === null) return ExchangeRateType.blue
  if (typeof value !== 'string' || !(value in ExchangeRateType)) {
    throw new AppError(400, 'Tipo de cotización inválido (oficial|blue|mep)')
  }
  return value as ExchangeRateType
}
