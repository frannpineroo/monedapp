import 'dotenv/config'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/prisma/prisma'

const app = createApp()

function uniqueEmail() {
  return `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

/** Usuario registrado + onboarding + escalas cargadas, sin depender del seed manual. */
export async function setupUser() {
  const { ensureMonotributoScales } = await import('../src/config/monotributoScales')
  await ensureMonotributoScales()

  const registered = await request(app)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: 'password123' })
  const token = registered.body.accessToken as string

  await request(app)
    .post('/users/me/onboarding')
    .set(auth(token))
    .send({ templateId: 'freelancer_software' })

  const wallets = await request(app).get('/wallets').set(auth(token))
  return { token, wallets: wallets.body as { id: string; name: string; currency: string }[] }
}

describe('escalas de monotributo', () => {
  it('la tabla existe y acepta una escala', async () => {
    const validFrom = new Date(Date.UTC(1999, 0, 1))
    await prisma.monotributoScale.upsert({
      where: { category_validFrom: { category: 'TEST', validFrom } },
      create: {
        category: 'TEST',
        validFrom,
        annualGrossLimit: 1000,
        monthlyFeeServices: 10,
      },
      update: {},
    })

    const stored = await prisma.monotributoScale.findFirstOrThrow({
      where: { category: 'TEST', validFrom },
    })
    expect(Number(stored.annualGrossLimit)).toBe(1000)
  })
})

describe('ensureMonotributoScales', () => {
  it('carga 11 escalas y correrla dos veces no duplica', async () => {
    const { ensureMonotributoScales, MONOTRIBUTO_VALID_FROM } = await import(
      '../src/config/monotributoScales'
    )

    await ensureMonotributoScales()
    await ensureMonotributoScales()

    const scales = await prisma.monotributoScale.findMany({
      where: { validFrom: MONOTRIBUTO_VALID_FROM },
      orderBy: { annualGrossLimit: 'asc' },
    })

    expect(scales).toHaveLength(11)
    expect(scales[0].category).toBe('A')
    expect(scales[scales.length - 1].category).toBe('K')
    expect(Number(scales[0].annualGrossLimit)).toBe(12009410.45)
    expect(Number(scales[0].monthlyFeeServices)).toBe(49527.18)
  })
})

describe('GET /reports/monotributo-alert', () => {
  it('sin categoría elegida devuelve unset y una sugerida coherente', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: ars.id, type: 'income', amount: 100000, description: 'Cobro' })

    const res = await request(app).get('/reports/monotributo-alert').set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('unset')
    expect(res.body.category).toBeNull()
    expect(res.body.suggestedCategory).toBe('A')
    expect(res.body.incomeArs12m).toBe(100000)
    expect(res.body.scales).toHaveLength(11)
  })

  it('un ingreso de hace 13 meses queda fuera de la ventana móvil', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!
    const viejo = new Date()
    viejo.setUTCMonth(viejo.getUTCMonth() - 13)

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars.id,
        type: 'income',
        amount: 500000,
        description: 'Viejo',
        date: viejo.toISOString().slice(0, 10),
      })

    const res = await request(app).get('/reports/monotributo-alert').set(auth(token))

    expect(res.body.incomeArs12m).toBe(0)
  })

  it('las transferencias no cuentan como facturación', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.filter((w) => w.currency === 'ARS')
    const destino =
      ars[1] ??
      (await request(app).post('/wallets').set(auth(token)).send({ name: 'Otra ARS', currency: 'ARS' }))
        .body

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: ars[0].id, type: 'income', amount: 10000, description: 'Cobro' })
    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars[0].id,
        toWalletId: destino.id,
        type: 'transfer',
        amount: 5000,
        description: 'Pase',
      })

    const res = await request(app).get('/reports/monotributo-alert').set(auth(token))

    expect(res.body.incomeArs12m).toBe(10000)
  })
})

describe('PATCH /users/me', () => {
  it('elegir categoría cambia el estado de la alerta', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: ars.id, type: 'income', amount: 100000, description: 'Cobro' })

    const patched = await request(app)
      .patch('/users/me')
      .set(auth(token))
      .send({ monotributoCategory: 'A' })

    expect(patched.status).toBe(200)
    expect(patched.body.monotributoCategory).toBe('A')
    expect(patched.body.passwordHash).toBeUndefined()

    const alert = await request(app).get('/reports/monotributo-alert').set(auth(token))
    expect(alert.body.status).toBe('ok')
    expect(alert.body.category).toBe('A')
    expect(alert.body.percentUsed).toBeGreaterThan(0)
  })

  it('categoría inexistente → 400', async () => {
    const { token } = await setupUser()

    const res = await request(app)
      .patch('/users/me')
      .set(auth(token))
      .send({ monotributoCategory: 'Z' })

    expect(res.status).toBe(400)
  })

  it('null desactiva la categoría', async () => {
    const { token } = await setupUser()
    await request(app).patch('/users/me').set(auth(token)).send({ monotributoCategory: 'A' })

    const res = await request(app)
      .patch('/users/me')
      .set(auth(token))
      .send({ monotributoCategory: null })

    expect(res.body.monotributoCategory).toBeNull()
  })

  it('GET /users/me devuelve el usuario y el onboarding sigue funcionando', async () => {
    const { token } = await setupUser()

    const me = await request(app).get('/users/me').set(auth(token))

    expect(me.status).toBe(200)
    expect(me.body.profileTemplate).toBe('freelancer_software')
  })
})

describe('GET /reports/monthly-summary', () => {
  it('desglosa por moneda, convierte a ARS y descuenta la cuota', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!
    const usd = wallets.find((w) => w.currency === 'USD')!
    const month = new Date().toISOString().slice(0, 7)

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: ars.id, type: 'income', amount: 100000, description: 'Cobro ARS' })
    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: usd.id, type: 'income', amount: 100, description: 'Cobro USD' })
    const gasto = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: ars.id, type: 'expense', amount: 20000, description: 'Hosting' })

    const rate = await prisma.exchangeRate.findUniqueOrThrow({
      where: { id: gasto.body.exchangeRateId },
    })
    expect(Number(rate.value)).toBe(1)

    const res = await request(app)
      .get(`/reports/monthly-summary?month=${month}`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.byCurrency.ARS).toMatchObject({ income: 100000, expense: 20000, net: 80000 })
    expect(res.body.byCurrency.USD.income).toBe(100)
    expect(res.body.incomeArs).toBeGreaterThan(100000)
    expect(res.body.expenseArs).toBe(20000)
    expect(res.body.tax.source).toBe('suggested')
    expect(res.body.netAfterTax).toBe(
      Math.round((res.body.incomeArs - res.body.expenseArs - res.body.tax.monthlyFee) * 100) / 100
    )
  })

  it('las transferencias no mueven ingresos ni gastos', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.filter((w) => w.currency === 'ARS')
    const destino =
      ars[1] ??
      (await request(app).post('/wallets').set(auth(token)).send({ name: 'Otra ARS', currency: 'ARS' }))
        .body

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars[0].id,
        toWalletId: destino.id,
        type: 'transfer',
        amount: 5000,
        description: 'Pase',
      })

    const res = await request(app).get('/reports/monthly-summary').set(auth(token))

    expect(res.body.incomeArs).toBe(0)
    expect(res.body.expenseArs).toBe(0)
  })

  it('un movimiento de otro mes no entra', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars.id,
        type: 'income',
        amount: 999,
        description: 'Mes viejo',
        date: '2026-01-15',
      })

    const res = await request(app)
      .get('/reports/monthly-summary?month=2026-02')
      .set(auth(token))

    expect(res.body.incomeArs).toBe(0)
  })

  it('top clientes del mes', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!
    const client = await request(app).post('/clients').set(auth(token)).send({ name: 'Acme' })

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars.id,
        type: 'income',
        amount: 50000,
        description: 'Cobro',
        clientId: client.body.id,
      })

    const res = await request(app).get('/reports/monthly-summary').set(auth(token))

    expect(res.body.topClients[0]).toMatchObject({ name: 'Acme', totalArs: 50000 })
  })

  it('month inválido → 400', async () => {
    const { token } = await setupUser()

    const res = await request(app).get('/reports/monthly-summary?month=agosto').set(auth(token))

    expect(res.status).toBe(400)
  })
})
