import { Currency, ExchangeRateType, Prisma } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { AppError } from '../lib/errors'
import { fetchHistoricalRate, fetchLiveRate, type FxQuote } from './fxProvider'

const STUB_RATES: Record<ExchangeRateType, number> = {
  oficial: 980,
  blue: 1280,
  mep: 1210,
  cripto: 1300,
}

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function defaultTypeForCurrency(currency: Currency): ExchangeRateType {
  return currency === Currency.USDT ? ExchangeRateType.cripto : ExchangeRateType.blue
}

export function typesForCurrency(currency: Currency): ExchangeRateType[] {
  if (currency === Currency.ARS) return []
  if (currency === Currency.USDT) return [ExchangeRateType.cripto]
  return [ExchangeRateType.oficial, ExchangeRateType.blue, ExchangeRateType.mep]
}

async function upsertRate(
  d: Date,
  type: ExchangeRateType,
  currency: Currency,
  values: { buy: number; sell: number; source: string }
) {
  const data = {
    value: new Prisma.Decimal(values.sell),
    buy: new Prisma.Decimal(values.buy),
    sell: new Prisma.Decimal(values.sell),
    source: values.source,
  }

  return prisma.exchangeRate.upsert({
    where: { date_type_currency: { date: d, type, currency } },
    create: { date: d, type, currency, ...data },
    update: data,
  })
}

export async function ensureRateForDate(
  date: Date,
  currency: Currency,
  type: ExchangeRateType = defaultTypeForCurrency(currency)
) {
  const d = dateOnly(date)

  // 1. ARS no cotiza contra sí mismo.
  if (currency === Currency.ARS) {
    return upsertRate(d, type, Currency.ARS, { buy: 1, sell: 1, source: 'fixed' })
  }

  // 2. Caché: cualquier fila que no sea stub ya sirve.
  const cached = await prisma.exchangeRate.findUnique({
    where: { date_type_currency: { date: d, type, currency } },
  })
  if (cached && cached.source !== 'stub') return cached

  // 3. Red: hoy → cotización actual; fecha pasada → histórica.
  const isToday = d.getTime() >= dateOnly(new Date()).getTime()
  const quote: FxQuote | null = isToday
    ? await fetchLiveRate(type)
    : await fetchHistoricalRate(type, d)

  if (quote) {
    return upsertRate(d, type, currency, {
      buy: quote.buy,
      sell: quote.sell,
      source: quote.source,
    })
  }

  // 4. Última cotización conocida de esa moneda y tipo (nunca una stub).
  const previous = await prisma.exchangeRate.findFirst({
    where: { currency, type, date: { lt: d }, source: { not: 'stub' } },
    orderBy: { date: 'desc' },
  })

  if (previous) {
    return upsertRate(d, type, currency, {
      buy: Number(previous.buy ?? previous.value),
      sell: Number(previous.sell ?? previous.value),
      source: 'db-fallback',
    })
  }

  // 5. Último recurso: constante, para que el movimiento nunca falle.
  return upsertRate(d, type, currency, {
    buy: STUB_RATES[type],
    sell: STUB_RATES[type],
    source: 'stub',
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
    throw new AppError(400, 'Tipo de cotización inválido (oficial|blue|mep|cripto)')
  }
  return value as ExchangeRateType
}
