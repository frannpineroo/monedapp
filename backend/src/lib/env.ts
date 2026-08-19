import { AppError } from './errors'

/** Lazy a propósito: validar en el boot rompería `npm test` y `npm run dev` sin MP configurado. */
export function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new AppError(500, `Falta la variable de entorno ${name}`)
  }
  return value
}

export function mpConfig() {
  return {
    clientId: requiredEnv('MP_CLIENT_ID'),
    clientSecret: requiredEnv('MP_CLIENT_SECRET'),
    redirectUri: requiredEnv('MP_REDIRECT_URI'),
    webhookSecret: requiredEnv('MP_WEBHOOK_SECRET'),
    authBaseUrl: process.env.MP_AUTH_BASE_URL || 'https://auth.mercadopago.com.ar',
    apiBaseUrl: process.env.MP_API_BASE_URL || 'https://api.mercadopago.com',
  }
}

export function integrationsEncryptionKey(): Buffer {
  const key = Buffer.from(requiredEnv('INTEGRATIONS_ENCRYPTION_KEY'), 'base64')
  if (key.length !== 32) {
    throw new AppError(500, 'INTEGRATIONS_ENCRYPTION_KEY debe decodificar a 32 bytes')
  }
  return key
}

export function mobileDeepLinkScheme(): string {
  return process.env.MOBILE_DEEP_LINK_SCHEME || 'monedapp'
}
