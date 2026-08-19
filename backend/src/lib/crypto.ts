import crypto from 'crypto'
import { AppError } from './errors'
import { integrationsEncryptionKey } from './env'

/** Formato `v1.<iv>.<tag>.<ct>`: el prefijo reserva un camino de rotación de clave. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', integrationsEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])

  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split('.')
  if (version !== 'v1' || !iv || !tag || !ciphertext) {
    throw new AppError(500, 'Credencial con formato inválido')
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    integrationsEncryptionKey(),
    Buffer.from(iv, 'base64url')
  )
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
