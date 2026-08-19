import { mpConfig } from '../../lib/env'
import { requestJson } from '../../lib/httpClient'
import type { MpPayment } from './mpPaymentMapper'

export type MpTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  user_id: number | string
  public_key?: string | null
  scope?: string | null
  live_mode?: boolean | null
}

export function buildAuthorizationUrl(params: { state: string; codeChallenge: string }): string {
  const { clientId, redirectUri, authBaseUrl } = mpConfig()
  const url = new URL('/authorization', authBaseUrl)

  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('platform_id', 'mp')
  url.searchParams.set('state', params.state)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')

  return url.toString()
}

function tokenRequest(body: Record<string, string>): Promise<MpTokenResponse> {
  const { apiBaseUrl } = mpConfig()
  return requestJson<MpTokenResponse>(`${apiBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function exchangeAuthorizationCode(params: {
  code: string
  codeVerifier: string
}): Promise<MpTokenResponse> {
  const { clientId, clientSecret, redirectUri } = mpConfig()
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: redirectUri,
    code_verifier: params.codeVerifier,
  })
}

export function refreshAccessToken(refreshToken: string): Promise<MpTokenResponse> {
  const { clientId, clientSecret } = mpConfig()
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

export function getPayment(accessToken: string, paymentId: string): Promise<MpPayment> {
  const { apiBaseUrl } = mpConfig()
  return requestJson<MpPayment>(`${apiBaseUrl}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function searchPayments(
  accessToken: string,
  params: { from: Date; to: Date; offset: number }
): Promise<{ results: MpPayment[]; paging: { total: number } }> {
  const { apiBaseUrl } = mpConfig()
  const url = new URL('/v1/payments/search', apiBaseUrl)

  // `sort` es obligatorio en este endpoint: sin él MP responde 400.
  url.searchParams.set('sort', 'date_created')
  url.searchParams.set('criteria', 'desc')
  url.searchParams.set('range', 'date_created')
  url.searchParams.set('begin_date', params.from.toISOString())
  url.searchParams.set('end_date', params.to.toISOString())
  url.searchParams.set('limit', '50')
  url.searchParams.set('offset', String(params.offset))

  return requestJson(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
