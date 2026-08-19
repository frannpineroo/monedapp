import 'dotenv/config'

// Antes de importar createApp: los getters de env son lazy pero los tests necesitan valores.
process.env.MP_CLIENT_ID ??= 'test-client-id'
process.env.MP_CLIENT_SECRET ??= 'test-client-secret'
process.env.MP_REDIRECT_URI ??= 'https://monedapp.test/integrations/mercadopago/callback'
process.env.MP_WEBHOOK_SECRET ??= 'test-secret'
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

import crypto from 'crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { httpClient } from '../src/lib/httpClient'
import { prisma } from '../src/prisma/prisma'
import { fakeMpFetch, tokenResponse, approvedPayment, pendingPayment, refundedPayment } from './helpers/mpFixtures'

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

describe('ensureProviderWallet', () => {
  it('llamarla dos veces deja una sola billetera', async () => {
    const { ensureProviderWallet } = await import('../src/services/integrationWalletService')
    const { userId } = await registerAndOnboard()

    const first = await prisma.$transaction((tx) =>
      ensureProviderWallet(tx, userId, 'mercadopago', 'ARS')
    )
    const second = await prisma.$transaction((tx) =>
      ensureProviderWallet(tx, userId, 'mercadopago', 'ARS')
    )

    expect(second.id).toBe(first.id)
    expect(first.name).toBe('Mercado Pago ARS')

    const count = await prisma.wallet.count({
      where: { userId, externalProvider: 'mercadopago', currency: 'ARS' },
    })
    expect(count).toBe(1)
  })

  it('si el nombre ya lo usa una cuenta manual, usa el nombre alternativo', async () => {
    const { ensureProviderWallet } = await import('../src/services/integrationWalletService')
    const { userId } = await registerAndOnboard()

    await prisma.account.create({
      data: { userId, name: 'Mercado Pago ARS', kind: 'ASSET', currency: 'ARS' },
    })

    const wallet = await prisma.$transaction((tx) =>
      ensureProviderWallet(tx, userId, 'mercadopago', 'ARS')
    )

    expect(wallet.name).toBe('Mercado Pago ARS (integración)')
  })
})

describe('rutas de integraciones', () => {
  const realFetch = httpClient.fetch

  afterEach(() => {
    httpClient.fetch = realFetch
  })

  it('connect devuelve una URL con PKCE y el callback vuelve al deep link', async () => {
    const { token } = await registerAndOnboard()
    const fake = fakeMpFetch({ token: { ...tokenResponse, user_id: Date.now() } })
    httpClient.fetch = fake.fetchImpl

    const connect = await request(app)
      .post('/integrations/mercadopago/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ mobileRedirectUri: 'monedapp://integrations/mercadopago' })

    expect(connect.status).toBe(200)
    const url = new URL(connect.body.authorizationUrl)
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')

    const state = url.searchParams.get('state')!
    const callback = await request(app).get(
      `/integrations/mercadopago/callback?code=code-1&state=${state}`
    )

    expect(callback.status).toBe(302)
    expect(callback.headers.location).toContain('monedapp://integrations/mercadopago')
    expect(callback.headers.location).toContain('status=connected')

    const list = await request(app).get('/integrations').set('Authorization', `Bearer ${token}`)
    expect(list.body[0].status).toBe('connected')
    expect(list.body[0].credentials).toBeUndefined()
  })

  it('un state ya usado redirige con status=error', async () => {
    const { token } = await registerAndOnboard()
    httpClient.fetch = fakeMpFetch({ token: { ...tokenResponse, user_id: Date.now() } }).fetchImpl

    const connect = await request(app)
      .post('/integrations/mercadopago/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ mobileRedirectUri: 'monedapp://integrations/mercadopago' })
    const state = new URL(connect.body.authorizationUrl).searchParams.get('state')!

    await request(app).get(`/integrations/mercadopago/callback?code=code-1&state=${state}`)
    const replay = await request(app).get(
      `/integrations/mercadopago/callback?code=code-1&state=${state}`
    )

    expect(replay.status).toBe(302)
    expect(replay.headers.location).toContain('status=error')
  })

  it('mobileRedirectUri de otro esquema → 400', async () => {
    const { token } = await registerAndOnboard()

    const res = await request(app)
      .post('/integrations/mercadopago/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ mobileRedirectUri: 'https://evil.test/steal' })

    expect(res.status).toBe(400)
  })

  it('proveedor desconocido → 400', async () => {
    const { token } = await registerAndOnboard()

    const res = await request(app)
      .post('/integrations/stripe/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ mobileRedirectUri: 'monedapp://integrations/stripe' })

    expect(res.status).toBe(400)
  })
})

describe('ingestPayment', () => {
  it('un pago aprobado crea ingreso bruto + comisión y el asiento suma 0', async () => {
    const { ingestPayment } = await import('../src/services/mercadopago/mpIngestionService')
    const { userId } = await registerAndOnboard()

    const result = await ingestPayment(userId, approvedPayment({ id: 200000001 }))

    expect(result.status).toBe('posted')

    const movements = await prisma.movement.findMany({
      where: { userId, externalProvider: 'mercadopago' },
      orderBy: { externalId: 'asc' },
    })
    expect(movements).toHaveLength(2)
    expect(movements.map((m) => m.externalId)).toEqual(['200000001', '200000001:fee'])
    expect(movements[0].needsReview).toBe(true)
    expect(movements[1].needsReview).toBe(false)
    expect(movements[0].date.toISOString()).toBe('2026-08-14T00:00:00.000Z')

    const feeCategory = await prisma.account.findUnique({
      where: { id: movements[1].categoryAccountId! },
    })
    expect(feeCategory?.name).toBe('Comisiones bancarias')

    const entries = await prisma.ledgerEntry.findMany({
      where: { movementId: { in: movements.map((m) => m.id) } },
    })
    expect(entries.reduce((sum, e) => sum + Number(e.change), 0)).toBe(0)
  })

  it('reingestar el mismo pago no duplica nada', async () => {
    const { ingestPayment } = await import('../src/services/mercadopago/mpIngestionService')
    const { userId } = await registerAndOnboard()

    await ingestPayment(userId, approvedPayment({ id: 200000002 }))
    await ingestPayment(userId, approvedPayment({ id: 200000002 }))

    const count = await prisma.movement.count({
      where: { userId, externalProvider: 'mercadopago' },
    })
    expect(count).toBe(2)
  })

  it('un pago pendiente no crea movimientos', async () => {
    const { ingestPayment } = await import('../src/services/mercadopago/mpIngestionService')
    const { userId } = await registerAndOnboard()

    const result = await ingestPayment(userId, pendingPayment({ id: 200000003 }))

    expect(result.status).toBe('skipped')
    expect(await prisma.movement.count({ where: { userId, externalProvider: 'mercadopago' } })).toBe(0)
  })
})

describe('POST /webhooks/mercadopago', () => {
  const realFetch = httpClient.fetch

  afterEach(() => {
    httpClient.fetch = realFetch
  })

  function signWebhook(dataId: string, requestId = 'req-1', ts = '1704908010') {
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`
    const v1 = crypto
      .createHmac('sha256', process.env.MP_WEBHOOK_SECRET!)
      .update(manifest)
      .digest('hex')
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId }
  }

  /** Deja una Integration conectada apuntando a un collector id único. */
  async function seedConnectedIntegration(userId: string, externalAccountId: string) {
    const { encryptSecret } = await import('../src/lib/crypto')
    await prisma.integration.create({
      data: {
        userId,
        provider: 'mercadopago',
        status: 'connected',
        externalAccountId,
        tokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        credentials: encryptSecret(
          JSON.stringify({ accessToken: 'APP_USR-access-token', refreshToken: 'TG-refresh' })
        ),
      },
    })
  }

  function uniqueNotificationId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  function uniqueCollectorId() {
    return String(Date.now() * 1000 + Math.floor(Math.random() * 1000))
  }

  function body(paymentId: string, collectorId: string, notificationId: number | string) {
    return {
      id: notificationId,
      live_mode: false,
      type: 'payment',
      action: 'payment.created',
      user_id: Number(collectorId),
      data: { id: paymentId },
    }
  }

  it('pago aprobado firmado → 200 y dos movimientos', async () => {
    const { userId } = await registerAndOnboard()
    const collectorId = uniqueCollectorId()
    await seedConnectedIntegration(userId, collectorId)
    const payment = approvedPayment({ id: 300000001, collector_id: Number(collectorId) })
    httpClient.fetch = fakeMpFetch({ payments: { '300000001': payment } }).fetchImpl

    const res = await request(app)
      .post('/webhooks/mercadopago?data.id=300000001')
      .set(signWebhook('300000001'))
      .send(body('300000001', collectorId, uniqueNotificationId()))

    expect(res.status).toBe(200)
    const movements = await prisma.movement.findMany({ where: { userId } })
    expect(movements).toHaveLength(2)
  })

  it('la misma notificación reentregada no duplica', async () => {
    const { userId } = await registerAndOnboard()
    const collectorId = uniqueCollectorId()
    await seedConnectedIntegration(userId, collectorId)
    const payment = approvedPayment({ id: 300000002, collector_id: Number(collectorId) })
    httpClient.fetch = fakeMpFetch({ payments: { '300000002': payment } }).fetchImpl
    const notification = body('300000002', collectorId, uniqueNotificationId())

    await request(app)
      .post('/webhooks/mercadopago?data.id=300000002')
      .set(signWebhook('300000002'))
      .send(notification)
    const replay = await request(app)
      .post('/webhooks/mercadopago?data.id=300000002')
      .set(signWebhook('300000002'))
      .send(notification)

    expect(replay.status).toBe(200)
    expect(await prisma.movement.count({ where: { userId } })).toBe(2)
  })

  it('payment.updated con otra notification id tampoco duplica', async () => {
    const { userId } = await registerAndOnboard()
    const collectorId = uniqueCollectorId()
    await seedConnectedIntegration(userId, collectorId)
    const payment = approvedPayment({ id: 300000003, collector_id: Number(collectorId) })
    httpClient.fetch = fakeMpFetch({ payments: { '300000003': payment } }).fetchImpl

    await request(app)
      .post('/webhooks/mercadopago?data.id=300000003')
      .set(signWebhook('300000003'))
      .send(body('300000003', collectorId, uniqueNotificationId()))
    await request(app)
      .post('/webhooks/mercadopago?data.id=300000003')
      .set(signWebhook('300000003', 'req-2'))
      .send({ ...body('300000003', collectorId, uniqueNotificationId()), action: 'payment.updated' })

    expect(await prisma.movement.count({ where: { userId } })).toBe(2)
  })

  it('firma inválida → 401 y ningún movimiento', async () => {
    const { userId } = await registerAndOnboard()
    const collectorId = uniqueCollectorId()
    await seedConnectedIntegration(userId, collectorId)

    const res = await request(app)
      .post('/webhooks/mercadopago?data.id=300000004')
      .set({ 'x-signature': 'ts=1704908010,v1=deadbeef', 'x-request-id': 'req-1' })
      .send(body('300000004', collectorId, uniqueNotificationId()))

    expect(res.status).toBe(401)
    expect(await prisma.movement.count({ where: { userId } })).toBe(0)
  })

  it('user_id sin integración → 200 y evento ignorado', async () => {
    const unknownCollector = uniqueCollectorId()
    const notificationId = uniqueNotificationId()

    const res = await request(app)
      .post('/webhooks/mercadopago?data.id=300000005')
      .set(signWebhook('300000005'))
      .send(body('300000005', unknownCollector, notificationId))

    expect(res.status).toBe(200)
    const event = await prisma.integrationWebhookEvent.findFirst({
      where: { provider: 'mercadopago', notificationId },
    })
    expect(event?.status).toBe('ignored')
  })

  it('un topic que no es payment se ignora con 200', async () => {
    const res = await request(app)
      .post('/webhooks/mercadopago?data.id=300000006')
      .set(signWebhook('300000006'))
      .send({ id: uniqueNotificationId(), type: 'merchant_order', action: 'merchant_order.updated', data: { id: '1' } })

    expect(res.status).toBe(200)
    expect(res.body.ignored).toBe(true)
  })

  it('un pago pendiente no crea movimientos', async () => {
    const { userId } = await registerAndOnboard()
    const collectorId = uniqueCollectorId()
    await seedConnectedIntegration(userId, collectorId)
    const payment = pendingPayment({ id: 300000007, collector_id: Number(collectorId) })
    httpClient.fetch = fakeMpFetch({ payments: { '300000007': payment } }).fetchImpl

    const res = await request(app)
      .post('/webhooks/mercadopago?data.id=300000007')
      .set(signWebhook('300000007'))
      .send(body('300000007', collectorId, uniqueNotificationId()))

    expect(res.status).toBe(200)
    expect(await prisma.movement.count({ where: { userId } })).toBe(0)
  })
})

describe('reembolsos', () => {
  it('un reembolso agrega un movimiento compensatorio y no toca el original', async () => {
    const { ingestPayment } = await import('../src/services/mercadopago/mpIngestionService')
    const { userId } = await registerAndOnboard()

    await ingestPayment(userId, approvedPayment({ id: 400000001 }))
    const original = await prisma.movement.findFirstOrThrow({
      where: { userId, externalId: '400000001' },
    })

    await ingestPayment(userId, refundedPayment({ id: 400000001 }))

    const movements = await prisma.movement.findMany({
      where: { userId, externalProvider: 'mercadopago' },
      orderBy: { externalId: 'asc' },
    })
    expect(movements.map((m) => m.externalId)).toEqual([
      '400000001',
      '400000001:fee',
      '400000001:reversal',
    ])

    const stillThere = await prisma.movement.findUniqueOrThrow({ where: { id: original.id } })
    expect(Number(stillThere.amount)).toBe(Number(original.amount))

    const entries = await prisma.ledgerEntry.findMany({
      where: { movementId: { in: movements.map((m) => m.id) } },
    })
    expect(entries.reduce((sum, e) => sum + Number(e.change), 0)).toBe(0)
  })
})

describe('POST /integrations/mercadopago/sync', () => {
  const realFetch = httpClient.fetch

  afterEach(() => {
    httpClient.fetch = realFetch
  })

  it('la primera corrida crea movimientos y la segunda no crea nada', async () => {
    const { token, userId } = await registerAndOnboard()
    const collectorId = String(Date.now() * 1000 + Math.floor(Math.random() * 1000))
    const { encryptSecret } = await import('../src/lib/crypto')
    await prisma.integration.create({
      data: {
        userId,
        provider: 'mercadopago',
        status: 'connected',
        externalAccountId: collectorId,
        tokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        credentials: encryptSecret(
          JSON.stringify({ accessToken: 'APP_USR-access-token', refreshToken: 'TG-refresh' })
        ),
      },
    })
    httpClient.fetch = fakeMpFetch({
      search: [approvedPayment({ id: 500000001, collector_id: Number(collectorId) })],
    }).fetchImpl

    const first = await request(app)
      .post('/integrations/mercadopago/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(first.status).toBe(200)
    expect(first.body.created).toBe(2)

    const second = await request(app)
      .post('/integrations/mercadopago/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(second.body.created).toBe(0)
    expect(await prisma.movement.count({ where: { userId } })).toBe(2)
  })
})

describe('bandeja de revisión', () => {
  it('filtra por needsReview y el PATCH limpia la marca', async () => {
    const { ingestPayment } = await import('../src/services/mercadopago/mpIngestionService')
    const { token, userId } = await registerAndOnboard()
    await ingestPayment(userId, approvedPayment({ id: 600000001 }))

    const pending = await request(app)
      .get('/movements?needsReview=true')
      .set('Authorization', `Bearer ${token}`)

    expect(pending.status).toBe(200)
    expect(pending.body).toHaveLength(1)
    expect(pending.body[0].source).toBe('mercadopago')
    expect(pending.body[0].needsReview).toBe(true)

    const confirmed = await request(app)
      .patch(`/movements/${pending.body[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Cobro Estudio Contable', needsReview: false })

    expect(confirmed.status).toBe(200)
    expect(confirmed.body.needsReview).toBe(false)

    const after = await request(app)
      .get('/movements?needsReview=true')
      .set('Authorization', `Bearer ${token}`)
    expect(after.body).toHaveLength(0)
  })
})
