import 'dotenv/config'

// Antes de importar createApp: los getters de env son lazy pero los tests necesitan valores.
process.env.MP_CLIENT_ID ??= 'test-client-id'
process.env.MP_CLIENT_SECRET ??= 'test-client-secret'
process.env.MP_REDIRECT_URI ??= 'https://monedapp.test/integrations/mercadopago/callback'
process.env.MP_WEBHOOK_SECRET ??= 'test-secret'
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { httpClient } from '../src/lib/httpClient'
import { prisma } from '../src/prisma/prisma'
import { fakeMpFetch, tokenResponse } from './helpers/mpFixtures'

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
