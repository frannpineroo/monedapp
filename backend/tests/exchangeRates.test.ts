import 'dotenv/config'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Currency } from '@prisma/client'
import { createApp } from '../src/app'
import {
  defaultTypeForCurrency,
  ensureRateForDate,
  getRates,
  parseExchangeRateType,
  typesForCurrency,
} from '../src/services/exchangeRateService'
import { prisma } from '../src/prisma/prisma'

const app = createApp()

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

/** Fecha pasada única, para que cada corrida escriba filas propias. */
function uniquePastDate() {
  const daysFrom2000 = 1 + Math.floor(Math.random() * 7000)
  return new Date(Date.UTC(2000, 0, daysFrom2000))
}

describe('ensureRateForDate — fallbacks', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sin red + fila previa en DB → db-fallback con el valor previo', async () => {
    const previous = uniquePastDate()
    const target = new Date(previous.getTime() + 86_400_000)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 900, venta: 950 })))
    await ensureRateForDate(previous, Currency.USD, 'mep')

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))
    const rate = await ensureRateForDate(target, Currency.USD, 'mep')

    expect(rate.source).toBe('db-fallback')
    expect(Number(rate.value)).toBe(950)
    expect(Number(rate.buy)).toBe(900)
  })

  it('sin red y sin filas previas → stub', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    // 1970: no hay ninguna fila anterior posible en la tabla.
    const rate = await ensureRateForDate(new Date(Date.UTC(1970, 0, 2)), Currency.USD, 'mep')

    expect(rate.source).toBe('stub')
    expect(Number(rate.value)).toBe(1210)
  })
})

describe('getRates', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: 1530 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('USD → oficial, blue y mep', async () => {
    const rates = await getRates(Currency.USD, uniquePastDate())
    expect(rates.map((r) => r.type).sort()).toEqual(['blue', 'mep', 'oficial'])
  })

  it('USDT → solo cripto', async () => {
    const rates = await getRates(Currency.USDT, uniquePastDate())
    expect(rates.map((r) => r.type)).toEqual(['cripto'])
  })

  it('ARS → una fila fija en 1', async () => {
    const rates = await getRates(Currency.ARS, uniquePastDate())
    expect(rates).toHaveLength(1)
    expect(Number(rates[0].value)).toBe(1)
    expect(rates[0].source).toBe('fixed')
  })
})

async function registerUser() {
  const email = `fx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
  const res = await request(app).post('/auth/register').send({ email, password: 'password123' })
  return res.body.accessToken as string
}

describe('GET /exchange-rates', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: 1530 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('USD → 3 tipos con buy y sell', async () => {
    const token = await registerUser()
    const date = uniquePastDate().toISOString().slice(0, 10)

    const res = await request(app)
      .get(`/exchange-rates?currency=USD&date=${date}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    expect(Number(res.body[0].buy)).toBe(1500)
    expect(Number(res.body[0].sell)).toBe(1530)
    expect(res.body[0].source).toBe('argentinadatos')
  })

  it('USDT → solo cripto', async () => {
    const token = await registerUser()
    const date = uniquePastDate().toISOString().slice(0, 10)

    const res = await request(app)
      .get(`/exchange-rates?currency=USDT&date=${date}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.map((r: { type: string }) => r.type)).toEqual(['cripto'])
  })
})

describe('POST /movements con cotización', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: 1530 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function setup() {
    const token = await registerUser()
    await request(app)
      .post('/users/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ templateId: 'freelancer_software' })
    const wallets = await request(app).get('/wallets').set('Authorization', `Bearer ${token}`)
    return { token, wallets: wallets.body as { id: string; currency: string }[] }
  }

  it('wallet USDT sin exchangeRateType → cripto por default', async () => {
    const { token, wallets } = await setup()
    const usdt = wallets.find((w) => w.currency === 'USDT')
    if (!usdt) return // la plantilla puede no traer billetera USDT

    const res = await request(app)
      .post('/movements')
      .set('Authorization', `Bearer ${token}`)
      .send({ walletId: usdt.id, type: 'income', amount: 100, description: 'Pago cripto' })

    expect(res.status).toBe(201)
    expect(res.body.exchangeRate.type).toBe('cripto')
  })

  it('wallet USD con exchangeRateType mep → snapshot mep en la respuesta', async () => {
    const { token, wallets } = await setup()
    const usd = wallets.find((w) => w.currency === 'USD')!

    const res = await request(app)
      .post('/movements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        walletId: usd.id,
        type: 'income',
        amount: 200,
        description: 'Cobro cliente',
        exchangeRateType: 'mep',
      })

    expect(res.status).toBe(201)
    expect(res.body.exchangeRate.type).toBe('mep')
    expect(Number(res.body.exchangeRate.sell)).toBeGreaterThan(0)

    const list = await request(app).get('/movements').set('Authorization', `Bearer ${token}`)
    expect(list.body[0].exchangeRate.type).toBe('mep')
  })
})
