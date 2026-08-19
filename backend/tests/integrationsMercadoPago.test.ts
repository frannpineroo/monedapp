import 'dotenv/config'

// Antes de importar createApp: los getters de env son lazy pero los tests necesitan valores.
process.env.MP_CLIENT_ID ??= 'test-client-id'
process.env.MP_CLIENT_SECRET ??= 'test-client-secret'
process.env.MP_REDIRECT_URI ??= 'https://monedapp.test/integrations/mercadopago/callback'
process.env.MP_WEBHOOK_SECRET ??= 'test-secret'
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/prisma/prisma'

const app = createApp()

function uniqueEmail() {
  return `mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
}

export async function registerAndOnboard() {
  const registered = await request(app)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: 'password123' })
  const token = registered.body.accessToken as string
  const userId = (
    await prisma.user.findUniqueOrThrow({ where: { email: registered.body.user.email } })
  ).id

  await request(app)
    .post('/users/me/onboarding')
    .set('Authorization', `Bearer ${token}`)
    .send({ templateId: 'freelancer_software' })

  return { token, userId }
}

describe('schema de integraciones', () => {
  it('el índice de dedupe rechaza dos movimientos con el mismo externalId', async () => {
    const { userId, token } = await registerAndOnboard()
    const wallets = await request(app).get('/wallets').set('Authorization', `Bearer ${token}`)
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { id: (wallets.body as { id: string }[])[0].id },
    })
    // No se puede asumir que la tabla de cotizaciones tenga filas: el service las crea.
    const { resolveExchangeRateId } = await import('../src/services/exchangeRateService')
    const exchangeRateId = await resolveExchangeRateId(wallet.currency, new Date(Date.UTC(2026, 7, 14)))

    const base = {
      userId,
      walletId: wallet.id,
      type: 'income' as const,
      amount: 1000,
      currency: wallet.currency,
      exchangeRateId,
      description: 'Cobro MP',
      date: new Date(Date.UTC(2026, 7, 14)),
      externalProvider: 'mercadopago',
      externalId: 'dedupe-1',
      needsReview: true,
    }

    await prisma.movement.create({ data: base })
    await expect(prisma.movement.create({ data: base })).rejects.toMatchObject({ code: 'P2002' })
  })
})
