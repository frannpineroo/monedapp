import 'dotenv/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Currency } from '@prisma/client'
import {
  defaultTypeForCurrency,
  ensureRateForDate,
  parseExchangeRateType,
  typesForCurrency,
} from '../src/services/exchangeRateService'
import { prisma } from '../src/prisma/prisma'

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response
}

function todayUtc() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

describe('exchange rates', () => {
  it('accepts cripto as a movement exchange-rate type', () => {
    expect(parseExchangeRateType('cripto')).toBe('cripto')
  })

  it('default por moneda: USDT → cripto, USD → blue', () => {
    expect(defaultTypeForCurrency(Currency.USDT)).toBe('cripto')
    expect(defaultTypeForCurrency(Currency.USD)).toBe('blue')
  })

  it('tipos por moneda', () => {
    expect(typesForCurrency(Currency.USD)).toEqual(['oficial', 'blue', 'mep'])
    expect(typesForCurrency(Currency.USDT)).toEqual(['cripto'])
    expect(typesForCurrency(Currency.ARS)).toEqual([])
  })
})

describe('ensureRateForDate — cascada', () => {
  beforeEach(async () => {
    process.env.FX_ENABLED = 'true'
    // 'oficial' no lo usa ningún movimiento de los tests: se puede limpiar sin romper FKs.
    await prisma.exchangeRate.deleteMany({
      where: { currency: Currency.USD, type: 'oficial', date: todayUtc() },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ARS → value 1, source fixed, sin tocar la red', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const rate = await ensureRateForDate(todayUtc(), Currency.ARS)

    expect(Number(rate.value)).toBe(1)
    expect(Number(rate.sell)).toBe(1)
    expect(rate.source).toBe('fixed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetch ok → source dolarapi y value === sell', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: 1530 })))

    const rate = await ensureRateForDate(todayUtc(), Currency.USD, 'oficial')

    expect(rate.source).toBe('dolarapi')
    expect(Number(rate.buy)).toBe(1500)
    expect(Number(rate.sell)).toBe(1530)
    expect(Number(rate.value)).toBe(1530)
  })

  it('segunda llamada con misma fecha y tipo no vuelve a pegarle a la red', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: 1530 })))
    await ensureRateForDate(todayUtc(), Currency.USD, 'oficial')

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cached = await ensureRateForDate(todayUtc(), Currency.USD, 'oficial')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(Number(cached.value)).toBe(1530)
    expect(cached.source).toBe('dolarapi')
  })
})
