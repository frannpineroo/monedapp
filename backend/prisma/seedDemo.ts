import 'dotenv/config'
import request from 'supertest'
import { createApp } from '../src/app'
import { prisma } from '../src/prisma/prisma'
import { encryptSecret } from '../src/lib/crypto'
import { ensureMonotributoScales } from '../src/config/monotributoScales'
import { ensureProviderWallet } from '../src/services/integrationWalletService'
import { Currency } from '@prisma/client'

/**
 * Usuario de demo con datos de todas las entidades del dominio, para recorrer
 * la app sin cargar nada a mano.
 *
 * Corre contra la API en proceso, no contra Prisma directo: así cada movimiento
 * pasa por el mismo camino que la app y el ledger queda balanceado de verdad.
 *
 * Es destructivo pero acotado: borra el usuario de demo y lo vuelve a crear.
 * No toca ningún otro usuario.
 */
const DEMO_EMAIL = 'fran@ejemplo.com'
const DEMO_PASSWORD = 'fran1234'

const app = createApp()

let token = ''
const authHeader = () => ({ Authorization: `Bearer ${token}` })

/** Lanza si la API rechazó el pedido: un seed a medias es peor que uno que falla. */
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await request(app).post(path).set(authHeader()).send(body as object)
  if (res.status >= 400) {
    throw new Error(`POST ${path} → ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body as T
}

async function get<T>(path: string): Promise<T> {
  const res = await request(app).get(path).set(authHeader())
  if (res.status >= 400) {
    throw new Error(`GET ${path} → ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body as T
}

/** Fecha a N días de hoy, en UTC y sin hora: la API espera YYYY-MM-DD. */
function day(offset: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

/** Mismo día del mes, N meses atrás. Útil para llenar la ventana de 12 meses. */
function monthsAgo(months: number, dayOfMonth = 10): string {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, dayOfMonth))
  return d.toISOString().slice(0, 10)
}

type Wallet = { id: string; name: string; currency: string }
type Client = { id: string; name: string }
type Category = { id: string; name: string; kind: string }
type Movement = { id: string; description: string }

async function main() {
  await ensureMonotributoScales()

  const previous = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })
  if (previous) {
    // Los asientos apuntan a cuentas sin ON DELETE CASCADE: si se borra el usuario
    // de una, Postgres intenta llevarse las cuentas con los asientos todavía vivos.
    await prisma.ledgerEntry.deleteMany({ where: { movement: { userId: previous.id } } })
    await prisma.movement.deleteMany({ where: { userId: previous.id } })
    await prisma.user.delete({ where: { id: previous.id } })
    console.log(`Usuario de demo anterior borrado (${DEMO_EMAIL})`)
  }

  const registered = await request(app)
    .post('/auth/register')
    .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
  if (registered.status !== 201) {
    throw new Error(`No se pudo registrar: ${registered.status} ${JSON.stringify(registered.body)}`)
  }
  token = registered.body.accessToken as string
  const userId = registered.body.user.id as string

  await post('/users/me/onboarding', { templateId: 'freelancer_software' })
  await post('/categories/defaults', {})

  // --- Billeteras -----------------------------------------------------------
  await post<Wallet>('/wallets', { name: 'Caja chica ARS', currency: 'ARS' })
  await post<Wallet>('/wallets', { name: 'Binance USDT', currency: 'USDT' })

  const wallets = await get<Wallet[]>('/wallets')
  const walletBy = (name: string) => {
    const found = wallets.find((w) => w.name === name)
    if (!found) throw new Error(`Falta la billetera ${name}`)
    return found
  }
  const ars = walletBy('Efectivo ARS')
  const usd = walletBy('Cuenta USD')
  const cajaChica = walletBy('Caja chica ARS')
  const usdt = walletBy('Binance USDT')

  // --- Categorías -----------------------------------------------------------
  await post<Category>('/categories', { name: 'Cursos y capacitación', kind: 'INCOME' })
  await post<Category>('/categories', { name: 'Coworking', kind: 'EXPENSE' })

  const categories = await get<Category[]>('/categories')
  const categoryBy = (name: string) => {
    const found = categories.find((c) => c.name === name)
    if (!found) throw new Error(`Falta la categoría ${name}`)
    return found
  }
  const servicios = categoryBy('Ingresos servicios')
  const cursos = categoryBy('Cursos y capacitación')
  const herramientas = categoryBy('Herramientas y software')
  const internet = categoryBy('Internet y teléfono')
  const equipamiento = categoryBy('Equipamiento')
  const coworking = categoryBy('Coworking')
  const comisiones = categoryBy('Comisiones bancarias')

  // --- Clientes -------------------------------------------------------------
  const acme = await post<Client>('/clients', {
    name: 'Acme SRL',
    phone: '+5491133334444',
    defaultCurrency: 'ARS',
  })
  const globex = await post<Client>('/clients', {
    name: 'Globex Inc',
    phone: '+14155551234',
    defaultCurrency: 'USD',
  })
  const initech = await post<Client>('/clients', {
    name: 'Initech',
    phone: '+5491155556666',
    defaultCurrency: 'USD',
  })

  // --- Historia de 12 meses -------------------------------------------------
  // Llena la ventana móvil de la alerta de monotributo con volumen realista.
  for (let i = 11; i >= 1; i--) {
    await post('/movements', {
      walletId: ars.id,
      type: 'income',
      amount: 250000,
      description: 'Mantenimiento mensual',
      clientId: acme.id,
      categoryId: servicios.id,
      date: monthsAgo(i, 5),
    })
    await post('/movements', {
      walletId: usd.id,
      type: 'income',
      amount: 230,
      description: 'Sprint de desarrollo',
      clientId: globex.id,
      categoryId: servicios.id,
      date: monthsAgo(i, 18),
    })
    await post('/movements', {
      walletId: ars.id,
      type: 'expense',
      amount: 34000,
      description: 'Suscripciones del mes',
      categoryId: herramientas.id,
      date: monthsAgo(i, 6),
    })
  }

  // --- Mes en curso ---------------------------------------------------------
  await post('/movements', {
    walletId: ars.id,
    type: 'income',
    amount: 200000,
    description: 'Rediseño del checkout',
    clientId: acme.id,
    categoryId: servicios.id,
    date: day(-12),
  })
  await post('/movements', {
    walletId: usd.id,
    type: 'income',
    amount: 400,
    description: 'Consultoría de arquitectura',
    clientId: globex.id,
    categoryId: servicios.id,
    date: day(-8),
  })
  await post('/movements', {
    walletId: usdt.id,
    type: 'income',
    amount: 150,
    description: 'Curso de TypeScript',
    categoryId: cursos.id,
    date: day(-6),
  })

  await post('/movements', {
    walletId: ars.id,
    type: 'expense',
    amount: 45000,
    description: 'Suscripciones (GitHub, Figma)',
    categoryId: herramientas.id,
    date: day(-14),
  })
  await post('/movements', {
    walletId: ars.id,
    type: 'expense',
    amount: 18500,
    description: 'Internet fibra',
    categoryId: internet.id,
    date: day(-10),
  })
  await post('/movements', {
    walletId: ars.id,
    type: 'expense',
    amount: 92000,
    description: 'Escritorio en el coworking',
    categoryId: coworking.id,
    date: day(-7),
  })
  await post('/movements', {
    walletId: usd.id,
    type: 'expense',
    amount: 60,
    description: 'Monitor externo',
    categoryId: equipamiento.id,
    date: day(-4),
  })

  await post('/movements', {
    walletId: ars.id,
    toWalletId: cajaChica.id,
    type: 'transfer',
    amount: 60000,
    description: 'Para gastos del día a día',
    date: day(-3),
  })

  // --- Cuentas por cobrar ---------------------------------------------------
  // Una de cada estado: pendiente, vencida, cobrada a medias y cobrada entera.
  const pendiente = await post<Movement>('/movements', {
    type: 'invoice',
    clientId: initech.id,
    currency: 'USD',
    amount: 800,
    description: 'Factura 0001-00000012 · integración de pagos',
    date: day(-5),
    dueDate: day(12),
    categoryId: servicios.id,
  })

  const vencida = await post<Movement>('/movements', {
    type: 'invoice',
    clientId: acme.id,
    currency: 'ARS',
    amount: 350000,
    description: 'Factura 0001-00000010 · soporte de septiembre',
    date: day(-48),
    dueDate: day(-18),
    categoryId: servicios.id,
  })

  const parcial = await post<Movement>('/movements', {
    type: 'invoice',
    clientId: globex.id,
    currency: 'ARS',
    amount: 500000,
    description: 'Factura 0001-00000011 · migración a Postgres',
    date: day(-30),
    dueDate: day(6),
    categoryId: servicios.id,
  })
  await post('/movements', {
    type: 'collection',
    invoiceId: parcial.id,
    walletId: ars.id,
    amount: 200000,
    description: 'Anticipo de la migración',
    date: day(-20),
  })

  const cobrada = await post<Movement>('/movements', {
    type: 'invoice',
    clientId: initech.id,
    currency: 'USD',
    amount: 300,
    description: 'Factura 0001-00000009 · auditoría de performance',
    date: day(-40),
    dueDate: day(-10),
    categoryId: servicios.id,
  })
  await post('/movements', {
    type: 'collection',
    invoiceId: cobrada.id,
    walletId: usd.id,
    amount: 300,
    description: 'Pago de la auditoría',
    date: day(-11),
  })

  console.log(
    `Facturas: ${[pendiente, vencida, parcial, cobrada].map((i) => i.description.slice(0, 22)).join(' · ')}`
  )

  // --- Integración de Mercado Pago -----------------------------------------
  // Credenciales de mentira: la integración se ve conectada y el pago importado
  // aparece en "Para revisar", pero sincronizar contra MP de verdad va a fallar.
  // Sin clave de cifrado (o con una mal formada) no se puede escribir la fila. El
  // resto de la demo no depende de ella: se saltea con un aviso en vez de abortar
  // y dejar el usuario a medio cargar.
  try {
    const credentials = encryptSecret(
      JSON.stringify({ accessToken: 'DEMO-not-a-real-token', refreshToken: 'DEMO' })
    )
    await prisma.integration.create({
      data: {
        userId,
        provider: 'mercadopago',
        credentials,
        status: 'connected',
        externalAccountId: `demo-${Date.now()}`,
        lastSyncAt: new Date(),
        lastWebhookAt: new Date(),
      },
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.log(`Mercado Pago queda desconectado en Ajustes → Integraciones: ${reason}`)
    console.log(
      'La clave se lee como base64: generala con `openssl rand -base64 32`, no con -hex.'
    )
  }

  const mpWallet = await prisma.$transaction((tx) =>
    ensureProviderWallet(tx, userId, 'mercadopago', Currency.ARS)
  )

  const importado = await post<Movement>('/movements', {
    walletId: mpWallet.id,
    type: 'income',
    amount: 124000,
    description: 'Pago Mercado Pago',
    date: day(-2),
  })
  const comision = await post<Movement>('/movements', {
    walletId: mpWallet.id,
    type: 'expense',
    amount: 8680,
    description: 'Comisión Mercado Pago',
    categoryId: comisiones.id,
    date: day(-2),
  })

  // El auto-posteo real marca needsReview y sella el origen: acá se replica el
  // estado final, que es lo que la pantalla "Para revisar" muestra.
  await prisma.movement.updateMany({
    where: { id: { in: [importado.id, comision.id] } },
    data: { needsReview: true, externalProvider: 'mercadopago' },
  })
  await prisma.movement.update({
    where: { id: importado.id },
    data: { externalId: `demo-payment-${Date.now()}` },
  })
  await prisma.movement.update({
    where: { id: comision.id },
    data: { externalId: `demo-fee-${Date.now()}` },
  })

  await prisma.integrationWebhookEvent.create({
    data: {
      provider: 'mercadopago',
      notificationId: `demo-${Date.now()}`,
      resourceId: 'demo-payment',
      status: 'processed',
    },
  })

  // --- Categoría de monotributo --------------------------------------------
  const alert = await get<{
    suggestedCategory: string | null
    incomeArs12m: number
    percentUsed: number | null
    status: string
  }>('/reports/monotributo-alert')

  if (alert.suggestedCategory) {
    await request(app)
      .patch('/users/me')
      .set(authHeader())
      .send({ monotributoCategory: alert.suggestedCategory })
  }

  const after = await get<{ status: string; percentUsed: number | null; category: string | null }>(
    '/reports/monotributo-alert'
  )
  const summary = await get<{ incomeArs: number; expenseArs: number; netAfterTax: number }>(
    '/reports/monthly-summary'
  )
  const counts = await prisma.movement.count({ where: { userId } })

  console.log('')
  console.log(`Usuario de demo: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
  console.log(`Movimientos: ${counts} · billeteras: ${wallets.length + 1} · clientes: 3`)
  console.log(
    `Facturado 12 meses: ARS ${Math.round(alert.incomeArs12m).toLocaleString('es-AR')} · categoría ${after.category} · ${after.percentUsed}% del techo (${after.status})`
  )
  console.log(
    `Mes en curso: facturaste ARS ${Math.round(summary.incomeArs).toLocaleString('es-AR')} · gastaste ARS ${Math.round(summary.expenseArs).toLocaleString('es-AR')} · libre ARS ${Math.round(summary.netAfterTax).toLocaleString('es-AR')}`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
