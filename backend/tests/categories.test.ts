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

describe('categorías del onboarding', () => {
  it('deja al menos 6 categorías de gasto y 2 de ingreso', async () => {
    const { token } = await setupUser()
    const me = await request(app).get('/wallets').set(auth(token))
    expect(me.status).toBe(200)

    const user = await prisma.user.findFirstOrThrow({
      where: { wallets: { some: { id: (me.body as { id: string }[])[0].id } } },
    })

    const expense = await prisma.account.count({ where: { userId: user.id, kind: 'EXPENSE' } })
    const income = await prisma.account.count({ where: { userId: user.id, kind: 'INCOME' } })

    expect(expense).toBeGreaterThanOrEqual(6)
    expect(income).toBeGreaterThanOrEqual(2)

    const operativos = await prisma.account.findFirst({
      where: { userId: user.id, name: 'Gastos operativos' },
    })
    expect(operativos).not.toBeNull()
  })
})

describe('GET /categories', () => {
  it('filtra por kind y no expone las cuentas de billetera', async () => {
    const { token } = await setupUser()

    const res = await request(app).get('/categories?kind=EXPENSE').set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThanOrEqual(6)
    expect(res.body.every((c: { kind: string }) => c.kind === 'EXPENSE')).toBe(true)
    expect(res.body.map((c: { name: string }) => c.name)).not.toContain('Caja ARS')
    expect(res.body[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      kind: 'EXPENSE',
    })
  })

  it('sin kind devuelve gastos e ingresos', async () => {
    const { token } = await setupUser()

    const res = await request(app).get('/categories').set(auth(token))

    const kinds = new Set(res.body.map((c: { kind: string }) => c.kind))
    expect(kinds).toEqual(new Set(['EXPENSE', 'INCOME']))
  })

  it('kind inválido → 400', async () => {
    const { token } = await setupUser()
    const res = await request(app).get('/categories?kind=ASSET').set(auth(token))
    expect(res.status).toBe(400)
  })
})

describe('POST /categories', () => {
  it('crea una categoría de gasto', async () => {
    const { token } = await setupUser()

    const res = await request(app)
      .post('/categories')
      .set(auth(token))
      .send({ name: 'Publicidad', kind: 'EXPENSE' })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: expect.any(String), name: 'Publicidad', kind: 'EXPENSE' })
  })

  it('nombre repetido → 409', async () => {
    const { token } = await setupUser()
    await request(app).post('/categories').set(auth(token)).send({ name: 'Publicidad', kind: 'EXPENSE' })

    const res = await request(app)
      .post('/categories')
      .set(auth(token))
      .send({ name: 'Publicidad', kind: 'EXPENSE' })

    expect(res.status).toBe(409)
  })

  it('POST /categories/defaults es idempotente', async () => {
    const { token } = await setupUser()

    const first = await request(app).post('/categories/defaults').set(auth(token))
    const second = await request(app).post('/categories/defaults').set(auth(token))

    expect(first.status).toBe(200)
    expect(second.body).toHaveLength(first.body.length)
  })
})

describe('PATCH y DELETE /categories/:id', () => {
  async function createCategory(token: string, name: string, kind = 'EXPENSE') {
    const res = await request(app).post('/categories').set(auth(token)).send({ name, kind })
    return res.body as { id: string; name: string; kind: string }
  }

  it('renombra una categoría', async () => {
    const { token } = await setupUser()
    const category = await createCategory(token, 'Publicidad')

    const res = await request(app)
      .patch(`/categories/${category.id}`)
      .set(auth(token))
      .send({ name: 'Marketing' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Marketing')
  })

  it('borra una categoría libre → 204', async () => {
    const { token } = await setupUser()
    const category = await createCategory(token, 'Sin uso')

    const res = await request(app).delete(`/categories/${category.id}`).set(auth(token))

    expect(res.status).toBe(204)
  })

  it('categoría de otro usuario → 404', async () => {
    const owner = await setupUser()
    const intruder = await setupUser()
    const category = await createCategory(owner.token, 'Privada')

    const res = await request(app).delete(`/categories/${category.id}`).set(auth(intruder.token))

    expect(res.status).toBe(404)
  })

  it('última categoría del kind → 400', async () => {
    const { token } = await setupUser()
    const income = await request(app).get('/categories?kind=INCOME').set(auth(token))
    const ids = (income.body as { id: string }[]).map((c) => c.id)

    // Borrar todas menos una.
    for (const id of ids.slice(0, -1)) {
      await request(app).delete(`/categories/${id}`).set(auth(token))
    }

    const res = await request(app).delete(`/categories/${ids[ids.length - 1]}`).set(auth(token))

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('No se puede borrar la última categoría de este tipo')
  })
})
