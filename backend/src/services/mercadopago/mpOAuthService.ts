import crypto from 'crypto'
import { Currency } from '@prisma/client'
import { prisma } from '../../prisma/prisma'
import { AppError } from '../../lib/errors'
import { decryptSecret, encryptSecret } from '../../lib/crypto'
import { mobileDeepLinkScheme } from '../../lib/env'
import { HttpError } from '../../lib/httpClient'
import { ensureProviderWallet } from '../integrationWalletService'
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  type MpTokenResponse,
} from './mpClient'

export const PROVIDER = 'mercadopago'

/** El código de MP vive 10 minutos: el state no tiene por qué durar más. */
const STATE_TTL_MS = 10 * 60 * 1000
const REFRESH_MARGIN_MS = 30 * 24 * 60 * 60 * 1000

type StoredCredentials = {
  accessToken: string
  refreshToken: string
  publicKey?: string | null
  scope?: string | null
  liveMode?: boolean | null
}

function assertMobileRedirectUri(uri: string) {
  const scheme = mobileDeepLinkScheme()
  const allowed = uri.startsWith(`${scheme}://`) || (process.env.NODE_ENV !== 'production' && uri.startsWith('exp://'))
  if (!allowed) {
    throw new AppError(400, 'mobileRedirectUri inválido')
  }
}

export async function startConnect(userId: string, mobileRedirectUri: unknown) {
  if (typeof mobileRedirectUri !== 'string' || mobileRedirectUri.trim() === '') {
    throw new AppError(400, 'mobileRedirectUri es requerido')
  }
  assertMobileRedirectUri(mobileRedirectUri)

  const state = crypto.randomBytes(32).toString('base64url')
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  await prisma.integrationOAuthState.create({
    data: {
      userId,
      provider: PROVIDER,
      state,
      codeVerifier,
      mobileRedirectUri,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  })

  return { authorizationUrl: buildAuthorizationUrl({ state, codeChallenge }) }
}

async function persistTokens(userId: string, tokens: MpTokenResponse) {
  const credentials: StoredCredentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    publicKey: tokens.public_key ?? null,
    scope: tokens.scope ?? null,
    liveMode: tokens.live_mode ?? null,
  }

  const data = {
    credentials: encryptSecret(JSON.stringify(credentials)),
    status: 'connected',
    externalAccountId: String(tokens.user_id),
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    lastError: null,
  }

  return prisma.integration.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { userId, provider: PROVIDER, ...data },
    update: data,
  })
}

export async function completeConnect(params: { state: unknown; code: unknown }) {
  if (typeof params.state !== 'string' || typeof params.code !== 'string') {
    throw new AppError(400, 'Faltan state o code')
  }

  // Compare-and-set atómico: el state es de un solo uso, sin carrera posible.
  const consumed = await prisma.integrationOAuthState.updateMany({
    where: { state: params.state, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  })
  if (consumed.count !== 1) {
    throw new AppError(400, 'El pedido de conexión venció o ya fue usado')
  }

  const row = await prisma.integrationOAuthState.findUniqueOrThrow({
    where: { state: params.state },
  })

  const tokens = await exchangeAuthorizationCode({
    code: params.code,
    codeVerifier: row.codeVerifier,
  })
  await persistTokens(row.userId, tokens)

  // La billetera se crea ya para que la pantalla de conexión muestre algo concreto.
  await prisma.$transaction((tx) =>
    ensureProviderWallet(tx, row.userId, PROVIDER, Currency.ARS)
  )

  return { mobileRedirectUri: row.mobileRedirectUri }
}

export async function getValidAccessToken(userId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  })
  if (!integration || integration.status !== 'connected' || !integration.credentials) {
    throw new AppError(400, 'Mercado Pago no está conectado')
  }

  const credentials = JSON.parse(decryptSecret(integration.credentials)) as StoredCredentials
  const expiresSoon =
    !integration.tokenExpiresAt ||
    integration.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS

  if (!expiresSoon) return credentials.accessToken

  try {
    // El refresh_token rota en cada refresh: hay que guardar el nuevo o la conexión muere.
    const tokens = await refreshAccessToken(credentials.refreshToken)
    await persistTokens(userId, tokens)
    return tokens.access_token
  } catch (error) {
    if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
      await prisma.integration.update({
        where: { id: integration.id },
        data: { status: 'error', lastError: 'Reconectá Mercado Pago' },
      })
      throw new AppError(400, 'Reconectá Mercado Pago')
    }
    throw error
  }
}

export async function disconnect(userId: string) {
  // No se borran ni la billetera ni sus movimientos: son historial real del ledger.
  await prisma.integration.updateMany({
    where: { userId, provider: PROVIDER },
    data: { status: 'disconnected', credentials: '', externalAccountId: null, tokenExpiresAt: null },
  })
}

export function getIntegrationStatus(userId: string) {
  return prisma.integration.findMany({ where: { userId }, orderBy: { provider: 'asc' } })
}
