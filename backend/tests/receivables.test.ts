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
