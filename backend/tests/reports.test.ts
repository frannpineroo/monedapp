import 'dotenv/config'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/prisma/prisma'

const app = createApp()

function uniqueEmail() {
  return `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

/** Usuario registrado + onboarding + escalas cargadas, sin depender del seed manual. */
export async function setupUser() {
  const { ensureMonotributoScales } = await import('../src/config/monotributoScales')
  await ensureMonotributoScales()

  const registered = await request(app)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: 'password123' })
  const token = registered.body.accessToken as string

  await request(app)
    .post('/users/me/onboarding')
    .set(auth(token))
    .send({ templateId: 'freelancer_software' })

  const wallets = await request(app).get('/wallets').set(auth(token))
  return { token, wallets: wallets.body as { id: string; name: string; currency: string }[] }
}

describe('escalas de monotributo', () => {
  it('la tabla existe y acepta una escala', async () => {
    const validFrom = new Date(Date.UTC(1999, 0, 1))
    await prisma.monotributoScale.upsert({
      where: { category_validFrom: { category: 'TEST', validFrom } },
      create: {
        category: 'TEST',
        validFrom,
        annualGrossLimit: 1000,
        monthlyFeeServices: 10,
      },
      update: {},
    })

    const stored = await prisma.monotributoScale.findFirstOrThrow({
      where: { category: 'TEST', validFrom },
    })
    expect(Number(stored.annualGrossLimit)).toBe(1000)
  })
})

describe('ensureMonotributoScales', () => {
  it('carga 11 escalas y correrla dos veces no duplica', async () => {
    const { ensureMonotributoScales, MONOTRIBUTO_VALID_FROM } = await import(
      '../src/config/monotributoScales'
    )

    await ensureMonotributoScales()
    await ensureMonotributoScales()

    const scales = await prisma.monotributoScale.findMany({
      where: { validFrom: MONOTRIBUTO_VALID_FROM },
      orderBy: { annualGrossLimit: 'asc' },
    })

    expect(scales).toHaveLength(11)
    expect(scales[0].category).toBe('A')
    expect(scales[scales.length - 1].category).toBe('K')
    expect(Number(scales[0].annualGrossLimit)).toBe(12009410.45)
    expect(Number(scales[0].monthlyFeeServices)).toBe(49527.18)
  })
})
