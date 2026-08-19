import 'dotenv/config'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/prisma/prisma'

const app = createApp()

function uniqueEmail() {
  return `wc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
}

/** Usuario registrado + onboarding aplicado (deja billeteras "Efectivo ARS" y "Cuenta USD"). */
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

async function createWallet(token: string, name: string, currency = 'ARS') {
  const res = await request(app)
    .post('/wallets')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, currency })
  return res.body as { id: string; name: string; currency: string }
}

async function createMovement(
  token: string,
  walletId: string,
  extra: Record<string, unknown> = {}
) {
  return request(app)
    .post('/movements')
    .set('Authorization', `Bearer ${token}`)
    .send({
      walletId,
      type: 'income',
      amount: 1000,
      description: 'Cobro de prueba',
      ...extra,
    })
}

describe('wallets', () => {
  it('POST /wallets crea la billetera y su cuenta espejo', async () => {
    const { token } = await setupUser()

    const res = await request(app)
      .post('/wallets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mercado Pago', currency: 'ARS' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Mercado Pago')

    const wallet = await prisma.wallet.findUnique({ where: { id: res.body.id } })
    const account = await prisma.account.findUnique({ where: { id: wallet!.accountId } })
    expect(account!.name).toBe('Mercado Pago (ARS)')

    const list = await request(app).get('/wallets').set('Authorization', `Bearer ${token}`)
    expect(list.body.map((w: { name: string }) => w.name)).toContain('Mercado Pago')
  })

  it('DELETE /wallets/:id sin movimientos → 204', async () => {
    const { token } = await setupUser()
    const wallet = await createWallet(token, 'Billetera vacía')

    const res = await request(app)
      .delete(`/wallets/${wallet.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(204)
  })

  it('DELETE /wallets/:id con movimientos → 400', async () => {
    const { token } = await setupUser()
    const wallet = await createWallet(token, 'Billetera con plata')
    const movement = await createMovement(token, wallet.id)
    expect(movement.status).toBe(201)

    const res = await request(app)
      .delete(`/wallets/${wallet.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('No se puede borrar una billetera con movimientos')
  })

  it('billetera de otro usuario → 404', async () => {
    const owner = await setupUser()
    const intruder = await setupUser()
    const wallet = await createWallet(owner.token, 'Privada')

    const res = await request(app)
      .patch(`/wallets/${wallet.id}`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .send({ name: 'Robada' })

    expect(res.status).toBe(404)
  })

  it('PATCH /wallets/:id renombra la billetera y su cuenta espejo', async () => {
    const { token } = await setupUser()
    const wallet = await createWallet(token, 'Mercado Pago', 'ARS')

    const res = await request(app)
      .patch(`/wallets/${wallet.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'MP' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('MP')

    const updated = await prisma.wallet.findUnique({ where: { id: wallet.id } })
    const account = await prisma.account.findUnique({ where: { id: updated!.accountId } })
    expect(account!.name).toBe('MP (ARS)')
  })

  it('PATCH /wallets/:id con un nombre ya usado → 409', async () => {
    const { token } = await setupUser()
    await createWallet(token, 'Mercado Pago', 'ARS')
    const otra = await createWallet(token, 'Banco', 'ARS')

    const res = await request(app)
      .patch(`/wallets/${otra.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mercado Pago' })

    expect(res.status).toBe(409)
  })
})
