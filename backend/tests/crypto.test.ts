import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
})

describe('crypto de credenciales', () => {
  it('roundtrip', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/lib/crypto')
    const payload = JSON.stringify({ accessToken: 'APP_USR-123', refreshToken: 'TG-456' })

    expect(decryptSecret(encryptSecret(payload))).toBe(payload)
  })

  it('dos cifrados del mismo texto dan ciphertext distinto', async () => {
    const { encryptSecret } = await import('../src/lib/crypto')

    expect(encryptSecret('hola')).not.toBe(encryptSecret('hola'))
  })

  it('un tag manipulado no descifra', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/lib/crypto')
    const [version, iv, tag, ct] = encryptSecret('hola').split('.')
    const brokenTag = tag.slice(0, -2) + (tag.endsWith('AA') ? 'BB' : 'AA')

    expect(() => decryptSecret([version, iv, brokenTag, ct].join('.'))).toThrow()
  })

  it('una clave que no decodifica a 32 bytes es error de configuración', async () => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.from('corta').toString('base64')
    const { encryptSecret } = await import('../src/lib/crypto')

    expect(() => encryptSecret('hola')).toThrow(/32 bytes/)

    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
  })
})
