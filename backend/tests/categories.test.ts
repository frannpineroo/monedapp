import 'dotenv/config'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/prisma/prisma'

const app = createApp()

function uniqueEmail() {
  return `cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
}

/** Usuario registrado + onboarding aplicado. */
async function setupUser() {
  const registered = await request(app)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: 'password123' })
  const token = registered.body.accessToken as string

  await request(app)
    .post('/users/me/onboarding')
    .set('Authorization', `Bearer ${token}`)
    .send({ templateId: 'freelancer_software' })

  const wallets = await request(app).get('/wallets').set('Authorization', `Bearer ${token}`)
  return { token, wallets: wallets.body as { id: string; name: string; currency: string }[] }
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

describe('movimientos con categoría', () => {
  it('un gasto sin categoryId responde category: null', async () => {
    const { token, wallets } = await setupUser()

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: wallets[0].id, type: 'expense', amount: 500, description: 'Café' })

    expect(res.status).toBe(201)
    expect(res.body.category).toBeNull()

    const stored = await prisma.movement.findUnique({ where: { id: res.body.id } })
    expect(stored!.categoryAccountId).toBeNull()
  })
})
