import 'dotenv/config'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/prisma/prisma'

const app = createApp()

function uniqueEmail() {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

/** Usuario registrado + onboarding + un cliente listo para facturar. */
export async function setupUser() {
  const registered = await request(app)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: 'password123' })
  const token = registered.body.accessToken as string

  await request(app)
    .post('/users/me/onboarding')
    .set(auth(token))
    .send({ templateId: 'freelancer_software' })

  const wallets = await request(app).get('/wallets').set(auth(token))
  const client = await request(app)
    .post('/clients')
    .set(auth(token))
    .send({ name: 'Estudio Contable' })

  return {
    token,
    wallets: wallets.body as { id: string; name: string; currency: string }[],
    client: client.body as { id: string; name: string },
  }
}

describe('schema de cobrables', () => {
  it('un movimiento sin billetera se puede guardar y todo asiento tiene changeArs', async () => {
    const { token, client, wallets } = await setupUser()
    const { resolveExchangeRateId } = await import('../src/services/exchangeRateService')
    const user = await prisma.user.findFirstOrThrow({
      where: { clients: { some: { id: client.id } } },
    })

    const movement = await prisma.movement.create({
      data: {
        userId: user.id,
        walletId: null,
        clientId: client.id,
        type: 'invoice',
        amount: 1000,
        currency: 'USD',
        exchangeRateId: await resolveExchangeRateId('USD', new Date(Date.UTC(2026, 7, 14))),
        description: 'Sprint 12',
        date: new Date(Date.UTC(2026, 7, 14)),
        dueDate: new Date(Date.UTC(2026, 8, 14)),
      },
    })

    expect(movement.walletId).toBeNull()
    expect(movement.dueDate?.toISOString()).toBe('2026-09-14T00:00:00.000Z')

    // Un movimiento normal deja asientos con changeArs poblado.
    const income = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: wallets[0].id, type: 'income', amount: 500, description: 'Cobro' })
    expect(income.status).toBe(201)
    const entries = await prisma.ledgerEntry.findMany({
      where: { movementId: income.body.id },
    })
    expect(entries.every((e) => e.changeArs !== null)).toBe(true)
  })
})

describe('cuentas de sistema', () => {
  it('el onboarding las crea y llamarlas de nuevo no duplica', async () => {
    const { ensureSystemAccounts } = await import('../src/services/onboardingService')
    const { client } = await setupUser()
    const user = await prisma.user.findFirstOrThrow({
      where: { clients: { some: { id: client.id } } },
    })

    const first = await ensureSystemAccounts(user.id)
    const second = await ensureSystemAccounts(user.id)

    expect(second).toEqual(first)

    const accounts = await prisma.account.findMany({
      where: { userId: user.id, name: { in: ['Deudores por ventas', 'Diferencia de cambio'] } },
    })
    expect(accounts).toHaveLength(2)
    expect(accounts.find((a) => a.name === 'Deudores por ventas')?.kind).toBe('ASSET')
    expect(accounts.find((a) => a.name === 'Diferencia de cambio')?.kind).toBe('INCOME')
  })
})

describe('changeArs en asientos normales', () => {
  it('un ingreso en USD deja changeArs = monto × cotización y suma 0 en ARS', async () => {
    const { token, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!

    const created = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: usd.id, type: 'income', amount: 100, description: 'Cobro USD' })

    expect(created.status).toBe(201)

    const entries = await prisma.ledgerEntry.findMany({ where: { movementId: created.body.id } })
    const rate = await prisma.exchangeRate.findUniqueOrThrow({
      where: { id: created.body.exchangeRateId },
    })

    expect(entries).toHaveLength(2)
    expect(entries.reduce((sum, e) => sum + Number(e.changeArs), 0)).toBe(0)
    const walletEntry = entries.find((e) => Number(e.change) > 0)!
    expect(Number(walletEntry.changeArs)).toBe(Math.round(100 * Number(rate.value) * 100) / 100)
  })
})

describe('POST /movements type invoice', () => {
  it('emite la factura sin tocar los saldos de billetera', async () => {
    const { token, client } = await setupUser()
    const before = await request(app).get('/reports/balance-by-wallet').set(auth(token))

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-09-14',
        description: 'Sprint 12',
      })

    expect(res.status).toBe(201)
    expect(res.body.walletId).toBeNull()
    expect(res.body.dueDate).toContain('2026-09-14')

    const after = await request(app).get('/reports/balance-by-wallet').set(auth(token))
    expect(after.body).toEqual(before.body)

    const entries = await prisma.ledgerEntry.findMany({ where: { movementId: res.body.id } })
    expect(entries).toHaveLength(2)
    expect(entries.reduce((sum, e) => sum + Number(e.changeArs), 0)).toBe(0)

    const accounts = await prisma.account.findMany({
      where: { id: { in: entries.map((e) => e.accountId) } },
    })
    expect(accounts.map((a) => a.name)).toContain('Deudores por ventas')
  })

  it('factura sin cliente → 400', async () => {
    const { token } = await setupUser()

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'invoice', amount: 1000, currency: 'USD', dueDate: '2026-09-14', description: 'X' })

    expect(res.status).toBe(400)
  })

  it('factura con walletId → 400', async () => {
    const { token, client, wallets } = await setupUser()

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        walletId: wallets[0].id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-09-14',
        description: 'X',
      })

    expect(res.status).toBe(400)
  })

  it('factura sin moneda → 400', async () => {
    const { token, client } = await setupUser()

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'invoice', clientId: client.id, amount: 1000, dueDate: '2026-09-14', description: 'X' })

    expect(res.status).toBe(400)
  })
})

describe('POST /movements type collection', () => {
  async function issueInvoice(token: string, clientId: string, amount = 1000, currency = 'USD') {
    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId,
        amount,
        currency,
        dueDate: '2026-09-14',
        description: 'Sprint 12',
      })
    return res.body as { id: string }
  }

  it('un cobro acredita la billetera y baja el saldo', async () => {
    const { token, client, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!
    const invoice = await issueInvoice(token, client.id, 1000, 'USD')

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.id, walletId: usd.id, amount: 400 })

    expect(res.status).toBe(201)

    const balances = await request(app).get('/reports/balance-by-wallet').set(auth(token))
    const usdBalance = (balances.body as { wallet: { id: string }; balance: string }[]).find(
      (b) => b.wallet.id === usd.id
    )!
    expect(Number(usdBalance.balance)).toBe(400)

    const entries = await prisma.ledgerEntry.findMany({ where: { movementId: res.body.id } })
    expect(entries.reduce((sum, e) => sum + Number(e.changeArs), 0)).toBe(0)
  })

  it('un cobro que excede el saldo → 400', async () => {
    const { token, client, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!
    const invoice = await issueInvoice(token, client.id, 1000, 'USD')

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.id, walletId: usd.id, amount: 1500 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('El cobro supera el saldo pendiente')
  })

  it('factura USD cobrada en ARS deja una pata en Diferencia de cambio y suma 0 en ARS', async () => {
    const { token, client, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!
    const invoice = await issueInvoice(token, client.id, 1000, 'USD')
    const invoiceRow = await prisma.movement.findUniqueOrThrow({ where: { id: invoice.id } })
    const invoiceRate = await prisma.exchangeRate.findUniqueOrThrow({
      where: { id: invoiceRow.exchangeRateId },
    })

    // Cobrar en ARS un poco menos de lo facturado: la diferencia es pérdida de cambio.
    const cobrado = Math.round(Number(invoiceRate.value) * 1000 * 0.95)
    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.id, walletId: ars.id, amount: cobrado })

    expect(res.status).toBe(201)

    const entries = await prisma.ledgerEntry.findMany({ where: { movementId: res.body.id } })
    expect(entries).toHaveLength(3)
    expect(entries.reduce((sum, e) => sum + Number(e.changeArs), 0)).toBe(0)

    const accounts = await prisma.account.findMany({
      where: { id: { in: entries.map((e) => e.accountId) } },
    })
    expect(accounts.map((a) => a.name)).toContain('Diferencia de cambio')
  })

  it('cobro sin billetera o sin factura → 400', async () => {
    const { token, client, wallets } = await setupUser()
    const invoice = await issueInvoice(token, client.id)

    const sinWallet = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.id, amount: 100 })
    const sinInvoice = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', walletId: wallets[0].id, amount: 100 })

    expect(sinWallet.status).toBe(400)
    expect(sinInvoice.status).toBe(400)
  })
})

describe('DELETE /movements/:id de facturas', () => {
  it('con cobros → 400; borrar el cobro primero la libera', async () => {
    const { token, client, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!
    const invoice = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-09-14',
        description: 'Sprint 12',
      })
    const collection = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.body.id, walletId: usd.id, amount: 400 })

    const blocked = await request(app)
      .delete(`/movements/${invoice.body.id}`)
      .set(auth(token))
    expect(blocked.status).toBe(400)
    expect(blocked.body.error).toBe('No se puede borrar una factura con cobros')

    expect((await request(app).delete(`/movements/${collection.body.id}`).set(auth(token))).status).toBe(204)
    expect((await request(app).delete(`/movements/${invoice.body.id}`).set(auth(token))).status).toBe(204)
  })

  it('factura de otro usuario → 404', async () => {
    const owner = await setupUser()
    const intruder = await setupUser()
    const invoice = await request(app)
      .post('/movements')
      .set(auth(owner.token))
      .send({
        type: 'invoice',
        clientId: owner.client.id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-09-14',
        description: 'Sprint 12',
      })

    const res = await request(app)
      .delete(`/movements/${invoice.body.id}`)
      .set(auth(intruder.token))

    expect(res.status).toBe(404)
  })
})

describe('GET /receivables', () => {
  it('refleja pendiente, parcial y cobrada', async () => {
    const { token, client, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!
    const invoice = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2099-01-01',
        description: 'Sprint 12',
      })

    const pending = await request(app).get('/receivables').set(auth(token))
    expect(pending.status).toBe(200)
    expect(pending.body[0]).toMatchObject({
      id: invoice.body.id,
      outstanding: 1000,
      collected: 0,
      status: 'pending',
    })
    expect(pending.body[0].client.name).toBe('Estudio Contable')

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.body.id, walletId: usd.id, amount: 400 })

    const partial = await request(app).get('/receivables').set(auth(token))
    expect(partial.body[0]).toMatchObject({ outstanding: 600, collected: 400, status: 'partial' })
    expect(partial.body[0].collections).toHaveLength(1)

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.body.id, walletId: usd.id, amount: 600 })

    const paid = await request(app).get('/receivables').set(auth(token))
    expect(paid.body[0]).toMatchObject({ outstanding: 0, status: 'paid' })
  })

  it('una factura vencida e impaga trae daysOverdue > 0', async () => {
    const { token, client } = await setupUser()
    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 500,
        currency: 'ARS',
        date: '2026-01-10',
        dueDate: '2026-02-10',
        description: 'Vieja',
      })

    const res = await request(app).get('/receivables?status=overdue').set(auth(token))

    expect(res.body).toHaveLength(1)
    expect(res.body[0].status).toBe('overdue')
    expect(res.body[0].daysOverdue).toBeGreaterThan(0)
  })

  it('filtra por cliente', async () => {
    const { token, client } = await setupUser()
    const otro = await request(app).post('/clients').set(auth(token)).send({ name: 'Otro' })
    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 100,
        currency: 'ARS',
        dueDate: '2099-01-01',
        description: 'A',
      })

    const res = await request(app).get(`/receivables?clientId=${otro.body.id}`).set(auth(token))

    expect(res.body).toHaveLength(0)
  })
})

describe('GET /receivables/summary', () => {
  it('agrupa por moneda y por antigüedad', async () => {
    const { token, client } = await setupUser()

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 500,
        currency: 'ARS',
        dueDate: '2099-01-01',
        description: 'Al día',
      })
    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 100,
        currency: 'USD',
        date: '2026-01-10',
        dueDate: '2026-02-10',
        description: 'Vencida hace mucho',
      })

    const res = await request(app).get('/receivables/summary').set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.byCurrency.ARS).toBe(500)
    expect(res.body.byCurrency.USD).toBe(100)
    expect(res.body.totalArs).toBeGreaterThan(500)
    expect(res.body.overdueArs).toBeGreaterThan(0)
    expect(res.body.aging['61+']).toBeGreaterThan(0)
  })
})

describe('serializeMovement con cobrables', () => {
  it('la factura y el cobro exponen dueDate e invoiceId', async () => {
    const { token, client, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!
    const invoice = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-09-14',
        description: 'Sprint 12',
      })
    const collection = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.body.id, walletId: usd.id, amount: 400 })

    expect(invoice.body.dueDate).toContain('2026-09-14')
    expect(invoice.body.invoiceId).toBeNull()
    expect(collection.body.invoiceId).toBe(invoice.body.id)

    const list = await request(app).get('/movements?type=invoice').set(auth(token))
    expect(list.body[0].dueDate).toContain('2026-09-14')
  })
})
