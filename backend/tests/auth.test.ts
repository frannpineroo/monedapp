import 'dotenv/config'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/prisma/prisma'

const app = createApp()

function uniqueEmail() {
  return `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
}

describe('auth', () => {
  it('POST /auth/register válido → 201 + tokens', async () => {
    const email = uniqueEmail()
    const res = await request(app)
      .post('/auth/register')
      .send({ email, password: 'password123' })

    expect(res.status).toBe(201)
    expect(res.body.user.email).toBe(email)
    expect(res.body.accessToken).toBeTypeOf('string')
    expect(res.body.refreshToken).toBeTypeOf('string')
  })

  it('register email duplicado → 409', async () => {
    const email = uniqueEmail()
    await request(app).post('/auth/register').send({ email, password: 'password123' })

    const res = await request(app)
      .post('/auth/register')
      .send({ email, password: 'password123' })

    expect(res.status).toBe(409)
  })

  it('password < 8 chars → 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: 'short' })

    expect(res.status).toBe(400)
  })

  it('POST /auth/login ok → 200 + tokens', async () => {
    const email = uniqueEmail()
    const password = 'password123'
    await request(app).post('/auth/register').send({ email, password })

    const res = await request(app).post('/auth/login').send({ email, password })

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTypeOf('string')
    expect(res.body.refreshToken).toBeTypeOf('string')
  })

  it('login password mala → 401', async () => {
    const email = uniqueEmail()
    await request(app).post('/auth/register').send({ email, password: 'password123' })

    const res = await request(app)
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })

    expect(res.status).toBe(401)
  })

  it('POST /auth/refresh con refresh válido → 200 + nuevos tokens', async () => {
    const email = uniqueEmail()
    const register = await request(app)
      .post('/auth/register')
      .send({ email, password: 'password123' })

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: register.body.refreshToken })

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTypeOf('string')
    expect(res.body.refreshToken).toBeTypeOf('string')
    expect(res.body.refreshToken).not.toBe(register.body.refreshToken)
  })

  it('token de un usuario borrado → 401, no una app vacía', async () => {
    const registered = await request(app)
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: 'password123' })
    const token = registered.body.accessToken as string
    const userId = registered.body.user.id as string

    const before = await request(app).get('/wallets').set({ Authorization: `Bearer ${token}` })
    expect(before.status).toBe(200)

    await prisma.user.delete({ where: { id: userId } })

    // La firma del token sigue siendo válida: lo que ya no existe es el usuario.
    const after = await request(app).get('/wallets').set({ Authorization: `Bearer ${token}` })
    expect(after.status).toBe(401)
  })

  it('refresh inválido → 401', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'not-a-valid-token' })

    expect(res.status).toBe(401)
  })
})
