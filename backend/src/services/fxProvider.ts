import { ExchangeRateType } from '@prisma/client'

export type FxQuote = {
  buy: number
  sell: number
  source: 'dolarapi' | 'argentinadatos'
}

export const CASA_BY_TYPE: Record<ExchangeRateType, string> = {
  oficial: 'oficial',
  blue: 'blue',
  mep: 'bolsa',
  cripto: 'cripto',
}

/** Se lee en cada llamada: los tests cambian el env entre casos. */
function fxConfig() {
  return {
    baseUrl: process.env.FX_BASE_URL ?? 'https://dolarapi.com/v1/dolares',
    historicalBaseUrl:
      process.env.FX_HISTORICAL_BASE_URL ??
      'https://api.argentinadatos.com/v1/cotizaciones/dolares',
    timeoutMs: Number(process.env.FX_TIMEOUT_MS ?? 4000),
    enabled: process.env.FX_ENABLED !== 'false',
  }
}

function parseQuote(data: unknown): { buy: number; sell: number } | null {
  if (typeof data !== 'object' || data === null) return null
  const { compra, venta } = data as Record<string, unknown>
  const buy = Number(compra)
  const sell = Number(venta)
  if (!Number.isFinite(sell) || sell <= 0) return null
  return { buy: Number.isFinite(buy) ? buy : sell, sell }
}

async function getQuote(url: string, timeoutMs: number): Promise<{ buy: number; sell: number } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return parseQuote(await res.json())
  } catch {
    return null
  }
}

export async function fetchLiveRate(type: ExchangeRateType): Promise<FxQuote | null> {
  const { baseUrl, timeoutMs, enabled } = fxConfig()
  if (!enabled) return null

  const quote = await getQuote(`${baseUrl}/${CASA_BY_TYPE[type]}`, timeoutMs)
  return quote ? { ...quote, source: 'dolarapi' } : null
}
