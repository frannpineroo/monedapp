import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { httpClient } from '../src/lib/httpClient'
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  getPayment,
  searchPayments,
} from '../src/services/mercadopago/mpClient'
import { approvedPayment, fakeMpFetch } from './helpers/mpFixtures'

const realFetch = httpClient.fetch

beforeEach(() => {
  process.env.MP_CLIENT_ID = 'test-client-id'
  process.env.MP_CLIENT_SECRET = 'test-client-secret'
  process.env.MP_REDIRECT_URI = 'https://monedapp.test/integrations/mercadopago/callback'
  process.env.MP_WEBHOOK_SECRET = 'test-secret'
  process.env.MP_API_BASE_URL = 'https://api.mp.test'
  process.env.MP_AUTH_BASE_URL = 'https://auth.mp.test'
})

afterEach(() => {
  httpClient.fetch = realFetch
})

describe('mpClient', () => {
  it('la URL de autorización lleva PKCE y el redirect registrado', () => {
    const url = new URL(buildAuthorizationUrl({ state: 'st-1', codeChallenge: 'ch-1' }))

    expect(url.origin + url.pathname).toBe('https://auth.mp.test/authorization')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('platform_id')).toBe('mp')
    expect(url.searchParams.get('state')).toBe('st-1')
    expect(url.searchParams.get('code_challenge')).toBe('ch-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://monedapp.test/integrations/mercadopago/callback'
    )
  })

  it('el intercambio manda el body exacto de MP', async () => {
    const fake = fakeMpFetch({})
    httpClient.fetch = fake.fetchImpl

    const tokens = await exchangeAuthorizationCode({ code: 'code-1', codeVerifier: 'verifier-1' })

    expect(tokens.access_token).toBe('APP_USR-access-token')
    const call = fake.calls[0]
    expect(call.url).toBe('https://api.mp.test/oauth/token')
    expect(JSON.parse(String(call.init?.body))).toEqual({
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'https://monedapp.test/integrations/mercadopago/callback',
      code_verifier: 'verifier-1',
    })
  })

  it('getPayment pega al recurso con el bearer', async () => {
    const fake = fakeMpFetch({ payments: { '111111111': approvedPayment() } })
    httpClient.fetch = fake.fetchImpl

    const payment = await getPayment('APP_USR-access-token', '111111111')

    expect(payment.id).toBe(111111111)
    expect(fake.calls[0].url).toBe('https://api.mp.test/v1/payments/111111111')
  })

  it('searchPayments manda sort, que MP exige', async () => {
    const fake = fakeMpFetch({ search: [approvedPayment()] })
    httpClient.fetch = fake.fetchImpl

    const from = new Date(Date.UTC(2026, 6, 1))
    const to = new Date(Date.UTC(2026, 7, 1))
    const page = await searchPayments('APP_USR-access-token', { from, to, offset: 0 })

    expect(page.results).toHaveLength(1)
    const url = new URL(fake.calls[0].url)
    expect(url.searchParams.get('sort')).toBe('date_created')
    expect(url.searchParams.get('criteria')).toBe('desc')
    expect(url.searchParams.get('range')).toBe('date_created')
    expect(url.searchParams.get('limit')).toBe('50')
  })
})
