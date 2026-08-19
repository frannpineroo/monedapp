# Reportes mensuales + alerta de monotributo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el usuario vea cuánto facturó, cuánto gastó y cuánto le queda libre después de la cuota de monotributo, y que la app le avise antes de pasarse del techo de su categoría.

**Architecture:** Los números salen de los movimientos que ya existen, convertidos a ARS con **el snapshot de cotización de cada uno**, no con la de hoy. Las escalas de monotributo viven en una tabla con `validFrom`, cargadas por un seed idempotente, así actualizarlas a futuro es agregar un bloque y volver a correr el seed. La alerta usa una ventana de **12 meses móviles**, que es el criterio de recategorización de ARCA. La agregación se hace en JS: el volumen es chico y evita SQL crudo.

**Tech Stack:** Node 22 · Express 5 · TypeScript · Prisma 7 + PostgreSQL · Vitest + supertest (Postgres real) · Expo (React Native) + TanStack Query · StyleSheet nativo.

**Spec:** [docs/superpowers/specs/06-reportes-monotributo.md](../specs/06-reportes-monotributo.md)

**Rama:** `codex/f6-reportes-monotributo`. Crear desde `main`. No reutilizar ramas de otras fases.

**Depende de:**
- **Fase 1** (cotización real) — sin ella los totales en ARS son correctos pero sobre cotizaciones inventadas. No bloquea.
- **Fase 3** (categorías) — `reportService.ts` con `toArs` ya existe; este plan lo extiende en vez de duplicarlo. Si la fase 3 no está, la Task 3 crea el archivo.
- **Fase 5** (cobrables) — "cuánto facturé" cuenta lo **devengado**. Con la fase 5 hecha, eso incluye los movimientos `invoice`; sin ella, solo `income`. El código contempla los dos casos sin ramas: suma `income` + `invoice` y excluye `transfer` y `collection`, así que si el tipo `invoice` no existe todavía la consulta simplemente no lo encuentra.

## Global Constraints

- Todo monto en ARS se calcula con `movement.exchangeRate.value`, el snapshot del propio movimiento. Para ARS ese valor ya es 1, garantizado por la rama ARS de `ensureRateForDate`.
- **Facturación = devengado**: cuentan `income` e `invoice`. **Nunca** cuentan `transfer` (mueve plata entre billeteras propias) ni `collection` (es cobranza de algo ya facturado; contarla duplicaría).
- Ventana de la alerta: **12 meses móviles** desde hoy hacia atrás, no año calendario.
- Escalas: tabla en DB con `validFrom`, y las consultas toman siempre el `validFrom` más reciente ≤ la fecha de referencia. Actualizar escalas = agregar un bloque nuevo con otro `validFrom` y correr el seed; **nunca** editar el bloque viejo, que es el histórico.
- Las escalas vigentes son las de **2026-08-01**, "locaciones y prestaciones de servicios". La fuente y la fecha van documentadas en el README.
- `ensureMonotributoScales()` es idempotente y la llaman el seed **y** los tests: la suite no depende de que alguien haya corrido el seed a mano.
- `netAfterTax = incomeArs − expenseArs − monthlyFee`. Si el usuario no eligió categoría se usa la **sugerida** y se marca con `taxSource: 'suggested'`.
- `month` se valida contra `^\d{4}-\d{2}$` → 400 si no matchea. Sin `month`, mes actual.
- Estilo del backend: `asyncHandler`, `AppError`, serializers de `backend/src/lib/serializers.ts`. Sin librerías nuevas.
- La app no tiene suite de tests: las tasks de mobile se verifican con `npx tsc --noEmit` más una pasada manual.
- **Commits en inglés**, formato `tipo: mensaje` (`feat:`, `fix:`, `test:`, `docs:`), como todo el historial del repo. `.cursor/rules/push-after-task.mdc` además pide commitear y pushear al terminar cada task, sin esperar que lo pidan.

---

### Task 1: Tabla de escalas de monotributo

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_monotributo_scales/migration.sql`
- Create: `backend/tests/reports.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `model MonotributoScale { id, category, validFrom, annualGrossLimit, monthlyFeeServices, createdAt }` con `@@unique([category, validFrom])`.

- [ ] **Step 1: Levantar la DB y escribir el test que falla**

```bash
docker compose up -d db
```

Crear `backend/tests/reports.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/reports.test.ts`
Expected: FAIL — `prisma.monotributoScale` no existe.

- [ ] **Step 3: Agregar el model**

En `backend/prisma/schema.prisma`, al final:

```prisma
model MonotributoScale {
  id                 String   @id @default(cuid())
  category           String
  validFrom          DateTime @db.Date
  annualGrossLimit   Decimal  @db.Decimal(18, 2)
  monthlyFeeServices Decimal  @db.Decimal(18, 2)
  createdAt          DateTime @default(now())

  @@unique([category, validFrom])
  @@index([validFrom])
  @@map("monotributo_scales")
}
```

```bash
cd backend && npx prisma migrate dev --name add_monotributo_scales && npx prisma generate
```

- [ ] **Step 4: Correr el test**

Run: `cd backend && npx vitest run tests/reports.test.ts`
Expected: FAIL solo porque `../src/config/monotributoScales` todavía no existe (lo crea la Task 2); el caso de la tabla pasa si se comenta temporalmente el import del helper en `setupUser`. Alternativa más limpia: dejar el test rojo y cerrarlo en la Task 2.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/tests/reports.test.ts
git commit -m "feat: add monotributo scales table"
```

---

### Task 2: Escalas vigentes y seed

**Files:**
- Create: `backend/src/config/monotributoScales.ts`
- Modify: `backend/prisma/seed.ts`
- Test: `backend/tests/reports.test.ts`

**Interfaces:**
- Consumes: `MonotributoScale` (Task 1).
- Produces:
  - `MONOTRIBUTO_VALID_FROM: Date` y `MONOTRIBUTO_SCALES: { category, annualGrossLimit, monthlyFeeServices }[]`
  - `ensureMonotributoScales(): Promise<void>` — upsert idempotente por `(category, validFrom)`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/reports.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/reports.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

Crear `backend/src/config/monotributoScales.ts`:

```ts
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma/prisma'

/**
 * Escalas vigentes desde el 1/8/2026, "locaciones y prestaciones de servicios".
 * Fuente: afip.gob.ar/monotributo/categorias.asp
 *
 * Para actualizar: agregar un bloque nuevo con otro validFrom y correr el seed.
 * Nunca editar este: es el histórico con el que se calcularon reportes viejos.
 */
export const MONOTRIBUTO_VALID_FROM = new Date(Date.UTC(2026, 7, 1))

export const MONOTRIBUTO_SCALES = [
  { category: 'A', annualGrossLimit: 12009410.45, monthlyFeeServices: 49527.18 },
  { category: 'B', annualGrossLimit: 17595182.74, monthlyFeeServices: 56379.08 },
  { category: 'C', annualGrossLimit: 24670494.31, monthlyFeeServices: 66020.12 },
  { category: 'D', annualGrossLimit: 30628651.43, monthlyFeeServices: 84612.93 },
  { category: 'E', annualGrossLimit: 36028231.33, monthlyFeeServices: 119811.45 },
  { category: 'F', annualGrossLimit: 45151659.41, monthlyFeeServices: 150784.21 },
  { category: 'G', annualGrossLimit: 53995798.87, monthlyFeeServices: 230312.94 },
  { category: 'H', annualGrossLimit: 81924660.37, monthlyFeeServices: 522706.68 },
  { category: 'I', annualGrossLimit: 91699761.9, monthlyFeeServices: 963747.86 },
  { category: 'J', annualGrossLimit: 105012519.2, monthlyFeeServices: 1167299.76 },
  { category: 'K', annualGrossLimit: 126610838.75, monthlyFeeServices: 1614446.04 },
]

/** Idempotente: la corren el seed y también los tests. */
export async function ensureMonotributoScales() {
  for (const scale of MONOTRIBUTO_SCALES) {
    await prisma.monotributoScale.upsert({
      where: {
        category_validFrom: { category: scale.category, validFrom: MONOTRIBUTO_VALID_FROM },
      },
      create: {
        category: scale.category,
        validFrom: MONOTRIBUTO_VALID_FROM,
        annualGrossLimit: new Prisma.Decimal(scale.annualGrossLimit),
        monthlyFeeServices: new Prisma.Decimal(scale.monthlyFeeServices),
      },
      update: {
        annualGrossLimit: new Prisma.Decimal(scale.annualGrossLimit),
        monthlyFeeServices: new Prisma.Decimal(scale.monthlyFeeServices),
      },
    })
  }
}
```

En `backend/prisma/seed.ts`, dentro de `main()`:

```ts
  const { ensureMonotributoScales } = await import('../src/config/monotributoScales')
  await ensureMonotributoScales()
  console.log('Escalas de monotributo cargadas')
```

- [ ] **Step 4: Correr el test y el seed**

Run: `cd backend && npx vitest run tests/reports.test.ts && npm run db:seed`
Expected: PASS y el seed imprime la línea de escalas.

```bash
docker compose exec db psql -U monedapp_user -d monedapp -c 'select count(*) from monotributo_scales;'
```

Expected: 11 (más la fila `TEST` del primer test, si quedó).

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/monotributoScales.ts backend/prisma/seed.ts backend/tests/reports.test.ts
git commit -m "feat: seed the current monotributo scales"
```

---

### Task 3: Alerta de monotributo

**Files:**
- Modify: `backend/src/services/reportService.ts` (o crearlo, si la fase 3 no está)
- Modify: `backend/src/routes/reports.ts`
- Test: `backend/tests/reports.test.ts`

**Interfaces:**
- Consumes: `activeScales`, `toArs`.
- Produces:
  - `activeScales(at: Date): Promise<MonotributoScale[]>` — las del `validFrom` máximo ≤ `at`, ordenadas por límite ascendente.
  - `getMonotributoAlert(userId, now?): Promise<MonotributoAlert>` con `{ status, category, suggestedCategory, incomeArs12m, limit, percentUsed, remaining, monthlyFee, windowFrom, windowTo, scales }`
  - `GET /reports/monotributo-alert`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/reports.test.ts`:

```ts
describe('GET /reports/monotributo-alert', () => {
  it('sin categoría elegida devuelve unset y una sugerida coherente', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: ars.id, type: 'income', amount: 100000, description: 'Cobro' })

    const res = await request(app).get('/reports/monotributo-alert').set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('unset')
    expect(res.body.category).toBeNull()
    expect(res.body.suggestedCategory).toBe('A')
    expect(res.body.incomeArs12m).toBe(100000)
    expect(res.body.scales).toHaveLength(11)
  })

  it('un ingreso de hace 13 meses queda fuera de la ventana móvil', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!
    const viejo = new Date()
    viejo.setUTCMonth(viejo.getUTCMonth() - 13)

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars.id,
        type: 'income',
        amount: 500000,
        description: 'Viejo',
        date: viejo.toISOString().slice(0, 10),
      })

    const res = await request(app).get('/reports/monotributo-alert').set(auth(token))

    expect(res.body.incomeArs12m).toBe(0)
  })

  it('las transferencias no cuentan como facturación', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.filter((w) => w.currency === 'ARS')
    const destino =
      ars[1] ??
      (await request(app).post('/wallets').set(auth(token)).send({ name: 'Otra ARS', currency: 'ARS' }))
        .body

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: ars[0].id, type: 'income', amount: 10000, description: 'Cobro' })
    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars[0].id,
        toWalletId: destino.id,
        type: 'transfer',
        amount: 5000,
        description: 'Pase',
      })

    const res = await request(app).get('/reports/monotributo-alert').set(auth(token))

    expect(res.body.incomeArs12m).toBe(10000)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/reports.test.ts`
Expected: FAIL — 404, la ruta no existe.

- [ ] **Step 3: Implementar el service**

En `backend/src/services/reportService.ts` (si la fase 3 no está, crearlo con `toArs` como lo define el plan de categorías, Task 9):

```ts
import { MovementType } from '@prisma/client'
import { prisma } from '../prisma/prisma'

/** Facturación devengada: la cobranza de algo ya facturado no vuelve a contar. */
export const BILLED_TYPES = [MovementType.income, MovementType.invoice]
// Si la fase 5 todavía no está, `MovementType.invoice` no existe y `tsc` falla:
// dejar `[MovementType.income]` y sumar `invoice` cuando se implemente.

export async function activeScales(at: Date) {
  const latest = await prisma.monotributoScale.findFirst({
    where: { validFrom: { lte: at } },
    orderBy: { validFrom: 'desc' },
  })
  if (!latest) return []

  return prisma.monotributoScale.findMany({
    where: { validFrom: latest.validFrom },
    orderBy: { annualGrossLimit: 'asc' },
  })
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export async function getMonotributoAlert(userId: string, now = new Date()) {
  const windowTo = now
  const windowFrom = new Date(now)
  windowFrom.setUTCMonth(windowFrom.getUTCMonth() - 12)

  const movements = await prisma.movement.findMany({
    where: { userId, type: { in: BILLED_TYPES }, date: { gte: windowFrom, lte: windowTo } },
    select: { amount: true, exchangeRate: { select: { value: true } } },
  })

  const incomeArs12m = round2(
    movements.reduce((sum, m) => sum + toArs(m.amount, m.exchangeRate.value), 0)
  )

  const scales = await activeScales(now)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

  const suggested = scales.find((s) => Number(s.annualGrossLimit) >= incomeArs12m) ?? null
  const chosen = user.monotributoCategory
    ? (scales.find((s) => s.category === user.monotributoCategory) ?? null)
    : null

  const reference = chosen ?? suggested
  const limit = reference ? Number(reference.annualGrossLimit) : null
  const percentUsed = limit ? round2((incomeArs12m / limit) * 100) : null

  let status: 'unset' | 'ok' | 'warning' | 'exceeded'
  if (!suggested) {
    status = 'exceeded'
  } else if (!chosen) {
    status = 'unset'
  } else if (incomeArs12m > Number(chosen.annualGrossLimit)) {
    status = 'exceeded'
  } else if (incomeArs12m >= Number(chosen.annualGrossLimit) * 0.8) {
    status = 'warning'
  } else {
    status = 'ok'
  }

  return {
    status,
    category: chosen?.category ?? null,
    suggestedCategory: suggested?.category ?? null,
    incomeArs12m,
    limit,
    percentUsed,
    remaining: limit === null ? null : round2(limit - incomeArs12m),
    monthlyFee: reference ? Number(reference.monthlyFeeServices) : null,
    windowFrom,
    windowTo,
    scales: scales.map((s) => ({
      category: s.category,
      annualGrossLimit: Number(s.annualGrossLimit),
      monthlyFeeServices: Number(s.monthlyFeeServices),
    })),
  }
}
```

- [ ] **Step 4: Exponer la ruta**

En `backend/src/routes/reports.ts`:

```ts
router.get(
  '/monotributo-alert',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    res.json(await getMonotributoAlert(userId))
  })
)
```

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx tsc --noEmit && npx vitest run tests/reports.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/reportService.ts backend/src/routes/reports.ts backend/tests/reports.test.ts
git commit -m "feat: add rolling 12-month monotributo alert"
```

---

### Task 4: Categoría de monotributo del usuario

**Files:**
- Create: `backend/src/routes/users.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/lib/serializers.ts` (`serializeUser`)
- Modify: `backend/src/routes/auth.ts` y `backend/src/routes/onboarding.ts` (usar el serializer compartido)
- Test: `backend/tests/reports.test.ts`

**Interfaces:**
- Consumes: `activeScales` (Task 3).
- Produces: `serializeUser(user)` en `lib/serializers.ts`; `GET /users/me`; `PATCH /users/me { monotributoCategory }` — valida contra las escalas vigentes, acepta `null` para desactivar.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/reports.test.ts`:

```ts
describe('PATCH /users/me', () => {
  it('elegir categoría cambia el estado de la alerta', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: ars.id, type: 'income', amount: 100000, description: 'Cobro' })

    const patched = await request(app)
      .patch('/users/me')
      .set(auth(token))
      .send({ monotributoCategory: 'A' })

    expect(patched.status).toBe(200)
    expect(patched.body.monotributoCategory).toBe('A')
    expect(patched.body.passwordHash).toBeUndefined()

    const alert = await request(app).get('/reports/monotributo-alert').set(auth(token))
    expect(alert.body.status).toBe('ok')
    expect(alert.body.category).toBe('A')
    expect(alert.body.percentUsed).toBeGreaterThan(0)
  })

  it('categoría inexistente → 400', async () => {
    const { token } = await setupUser()

    const res = await request(app)
      .patch('/users/me')
      .set(auth(token))
      .send({ monotributoCategory: 'Z' })

    expect(res.status).toBe(400)
  })

  it('null desactiva la categoría', async () => {
    const { token } = await setupUser()
    await request(app).patch('/users/me').set(auth(token)).send({ monotributoCategory: 'A' })

    const res = await request(app)
      .patch('/users/me')
      .set(auth(token))
      .send({ monotributoCategory: null })

    expect(res.body.monotributoCategory).toBeNull()
  })

  it('GET /users/me devuelve el usuario y el onboarding sigue funcionando', async () => {
    const { token } = await setupUser()

    const me = await request(app).get('/users/me').set(auth(token))

    expect(me.status).toBe(200)
    expect(me.body.profileTemplate).toBe('freelancer_software')
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/reports.test.ts`
Expected: FAIL — 404 en `/users/me`.

- [ ] **Step 3: Mover el serializer de usuario**

En `backend/src/lib/serializers.ts`, sumar `User` al import de `@prisma/client` y agregar:

```ts
export function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    profileTemplate: user.profileTemplate,
    monotributoCategory: user.monotributoCategory,
    createdAt: user.createdAt,
  }
}
```

En `backend/src/routes/auth.ts`, borrar la función local `publicUser` e importar `serializeUser`, reemplazando sus usos. Ídem en `backend/src/routes/onboarding.ts`, donde hoy la forma está escrita inline en el `res.json`.

- [ ] **Step 4: Escribir el router**

Crear `backend/src/routes/users.ts`:

```ts
import { Router } from 'express'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { serializeUser } from '../lib/serializers'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { activeScales } from '../services/reportService'

const router = Router()
router.use(requireAuth)

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    res.json(serializeUser(user))
  })
)

router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { monotributoCategory } = req.body as { monotributoCategory?: unknown }

    if (monotributoCategory === undefined) {
      throw new AppError(400, 'monotributoCategory es requerido')
    }

    let value: string | null = null
    if (monotributoCategory !== null) {
      if (typeof monotributoCategory !== 'string') {
        throw new AppError(400, 'monotributoCategory inválida')
      }
      const scales = await activeScales(new Date())
      if (!scales.some((s) => s.category === monotributoCategory)) {
        throw new AppError(400, 'Categoría de monotributo inválida')
      }
      value = monotributoCategory
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { monotributoCategory: value },
    })
    res.json(serializeUser(user))
  })
)

export default router
```

En `backend/src/app.ts`, montarlo **antes** del `onboardingRouter`:

```ts
  app.use('/users', usersRouter)
  app.use(onboardingRouter)
```

`POST /users/me/onboarding` no colisiona: el `usersRouter` no tiene esa ruta, así que cae por `next()` al router de onboarding, que la monta sin prefijo.

- [ ] **Step 5: Correr toda la suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: PASS — auth incluido, que ahora usa el serializer compartido.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/users.ts backend/src/app.ts backend/src/lib/serializers.ts backend/src/routes/auth.ts backend/src/routes/onboarding.ts backend/tests/reports.test.ts
git commit -m "feat: let users pick their monotributo category"
```

---

### Task 5: Resumen mensual

**Files:**
- Modify: `backend/src/services/reportService.ts`
- Modify: `backend/src/routes/reports.ts`
- Test: `backend/tests/reports.test.ts`

**Interfaces:**
- Consumes: `toArs`, `BILLED_TYPES`, `getMonotributoAlert` (Task 3).
- Produces:
  - `getMonthlySummary(userId, month?): Promise<MonthlySummary>` con `{ month, byCurrency, incomeArs, expenseArs, netArs, topClients, tax, netAfterTax }`
  - `GET /reports/monthly-summary?month=YYYY-MM` (400 si el formato no matchea)

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/reports.test.ts`:

```ts
describe('GET /reports/monthly-summary', () => {
  it('desglosa por moneda, convierte a ARS y descuenta la cuota', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!
    const usd = wallets.find((w) => w.currency === 'USD')!
    const month = new Date().toISOString().slice(0, 7)

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: ars.id, type: 'income', amount: 100000, description: 'Cobro ARS' })
    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: usd.id, type: 'income', amount: 100, description: 'Cobro USD' })
    const gasto = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: ars.id, type: 'expense', amount: 20000, description: 'Hosting' })

    const rate = await prisma.exchangeRate.findUniqueOrThrow({
      where: { id: gasto.body.exchangeRateId },
    })
    expect(Number(rate.value)).toBe(1)

    const res = await request(app)
      .get(`/reports/monthly-summary?month=${month}`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.byCurrency.ARS).toMatchObject({ income: 100000, expense: 20000, net: 80000 })
    expect(res.body.byCurrency.USD.income).toBe(100)
    expect(res.body.incomeArs).toBeGreaterThan(100000)
    expect(res.body.expenseArs).toBe(20000)
    expect(res.body.tax.source).toBe('suggested')
    expect(res.body.netAfterTax).toBe(
      Math.round((res.body.incomeArs - res.body.expenseArs - res.body.tax.monthlyFee) * 100) / 100
    )
  })

  it('las transferencias no mueven ingresos ni gastos', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.filter((w) => w.currency === 'ARS')
    const destino =
      ars[1] ??
      (await request(app).post('/wallets').set(auth(token)).send({ name: 'Otra ARS', currency: 'ARS' }))
        .body

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars[0].id,
        toWalletId: destino.id,
        type: 'transfer',
        amount: 5000,
        description: 'Pase',
      })

    const res = await request(app).get('/reports/monthly-summary').set(auth(token))

    expect(res.body.incomeArs).toBe(0)
    expect(res.body.expenseArs).toBe(0)
  })

  it('un movimiento de otro mes no entra', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars.id,
        type: 'income',
        amount: 999,
        description: 'Mes viejo',
        date: '2026-01-15',
      })

    const res = await request(app)
      .get('/reports/monthly-summary?month=2026-02')
      .set(auth(token))

    expect(res.body.incomeArs).toBe(0)
  })

  it('top clientes del mes', async () => {
    const { token, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!
    const client = await request(app).post('/clients').set(auth(token)).send({ name: 'Acme' })

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars.id,
        type: 'income',
        amount: 50000,
        description: 'Cobro',
        clientId: client.body.id,
      })

    const res = await request(app).get('/reports/monthly-summary').set(auth(token))

    expect(res.body.topClients[0]).toMatchObject({ name: 'Acme', totalArs: 50000 })
  })

  it('month inválido → 400', async () => {
    const { token } = await setupUser()

    const res = await request(app).get('/reports/monthly-summary?month=agosto').set(auth(token))

    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/reports.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Implementar**

En `backend/src/services/reportService.ts`:

```ts
export function monthRange(month: string): { from: Date; to: Date } {
  const [year, monthNumber] = month.split('-').map(Number)
  return {
    from: new Date(Date.UTC(year, monthNumber - 1, 1)),
    to: new Date(Date.UTC(year, monthNumber, 1)),
  }
}

export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function getMonthlySummary(userId: string, month = currentMonth()) {
  const { from, to } = monthRange(month)

  const movements = await prisma.movement.findMany({
    where: {
      userId,
      type: { in: [...BILLED_TYPES, MovementType.expense] },
      date: { gte: from, lt: to },
    },
    select: {
      type: true,
      amount: true,
      currency: true,
      exchangeRate: { select: { value: true, type: true } },
      client: { select: { id: true, name: true } },
    },
  })

  const byCurrency: Record<string, { income: number; expense: number; net: number }> = {}
  const clientTotals = new Map<string, { id: string | null; name: string; totalArs: number }>()
  let incomeArs = 0
  let expenseArs = 0

  for (const movement of movements) {
    const amount = Number(movement.amount)
    const ars = toArs(movement.amount, movement.exchangeRate.value)
    const bucket = (byCurrency[movement.currency] ??= { income: 0, expense: 0, net: 0 })

    if (movement.type === MovementType.expense) {
      bucket.expense = round2(bucket.expense + amount)
      expenseArs = round2(expenseArs + ars)
    } else {
      bucket.income = round2(bucket.income + amount)
      incomeArs = round2(incomeArs + ars)

      const key = movement.client?.id ?? 'sin-cliente'
      const entry = clientTotals.get(key) ?? {
        id: movement.client?.id ?? null,
        name: movement.client?.name ?? 'Sin cliente',
        totalArs: 0,
      }
      entry.totalArs = round2(entry.totalArs + ars)
      clientTotals.set(key, entry)
    }

    bucket.net = round2(bucket.income - bucket.expense)
  }

  // La cuota sale de la categoría elegida; si no eligió, de la sugerida por la alerta.
  const alert = await getMonotributoAlert(userId)
  const monthlyFee = alert.monthlyFee ?? 0

  return {
    month,
    byCurrency,
    incomeArs,
    expenseArs,
    netArs: round2(incomeArs - expenseArs),
    topClients: [...clientTotals.values()].sort((a, b) => b.totalArs - a.totalArs).slice(0, 5),
    tax: {
      category: alert.category ?? alert.suggestedCategory,
      monthlyFee,
      source: alert.category ? ('user' as const) : ('suggested' as const),
    },
    netAfterTax: round2(incomeArs - expenseArs - monthlyFee),
  }
}
```

En `backend/src/routes/reports.ts`:

```ts
router.get(
  '/monthly-summary',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { month } = req.query

    if (month !== undefined && (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month))) {
      throw new AppError(400, 'month debe tener el formato YYYY-MM')
    }

    res.json(await getMonthlySummary(userId, month as string | undefined))
  })
)
```

- [ ] **Step 4: Correr toda la suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/reportService.ts backend/src/routes/reports.ts backend/tests/reports.test.ts
git commit -m "feat: add monthly summary with tax-adjusted net"
```

---

### Task 6: Tipos y formateo en la app

**Files:**
- Modify: `mobile/src/api/types.ts`
- Modify: `mobile/src/lib/format.ts`

**Interfaces:**
- Consumes: las respuestas de las Tasks 3 y 5.
- Produces: `MonthlySummary`, `MonotributoAlert`, `MonotributoScale`; `formatArs(value)` y `formatPercent(value)`.

- [ ] **Step 1: Agregar los tipos**

En `mobile/src/api/types.ts`:

```ts
export type MonotributoScale = {
  category: string
  annualGrossLimit: number
  monthlyFeeServices: number
}

export type MonotributoAlert = {
  status: 'unset' | 'ok' | 'warning' | 'exceeded'
  category: string | null
  suggestedCategory: string | null
  incomeArs12m: number
  limit: number | null
  percentUsed: number | null
  remaining: number | null
  monthlyFee: number | null
  windowFrom: string
  windowTo: string
  scales: MonotributoScale[]
}

export type MonthlySummary = {
  month: string
  byCurrency: Record<string, { income: number; expense: number; net: number }>
  incomeArs: number
  expenseArs: number
  netArs: number
  topClients: { id: string | null; name: string; totalArs: number }[]
  tax: { category: string | null; monthlyFee: number; source: 'user' | 'suggested' }
  netAfterTax: number
}
```

- [ ] **Step 2: Agregar los formateadores**

En `mobile/src/lib/format.ts`:

```ts
/** Plata grande: los centavos sobran y estorban. */
export function formatArs(value: string | number) {
  return `ARS ${Number(value).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function formatPercent(value: string | number) {
  return `${Number(value).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`
}
```

- [ ] **Step 3: Chequear tipos**

Run: `cd mobile && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/api/types.ts mobile/src/lib/format.ts
git commit -m "feat(mobile): type reports payloads and add ARS/percent formatters"
```

---

### Task 7: Pestaña Reportes

**Files:**
- Create: `mobile/app/(tabs)/reports.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `GET /reports/monthly-summary?month=` (Task 5).
- Produces: pestaña "Reportes" con selector de mes y las tres tarjetas.

**Choque de tabs a resolver acá:** con Inicio · Movimientos · Nuevo · Reportes · Ajustes la barra llega a cinco, que es el tope que fija el roadmap. Si la fase 4 dejó una tab "Revisar", **sacarla** y resolver la bandeja como filtro `needsReview` dentro de Movimientos, más el banner en Inicio que esa fase ya agrega.

- [ ] **Step 1: Escribir la pantalla**

Crear `mobile/app/(tabs)/reports.tsx`:

```tsx
import { apiRequest } from '@/src/api/client'
import type { MonthlySummary } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount, formatArs } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function ReportsScreen() {
  const { accessToken } = useAuth()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))

  const summary = useQuery({
    queryKey: ['monthly-summary', month],
    queryFn: () =>
      apiRequest<MonthlySummary>(`/reports/monthly-summary?month=${month}`, {
        token: accessToken,
      }),
    enabled: !!accessToken,
  })

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}
      refreshControl={
        <RefreshControl refreshing={summary.isFetching} onRefresh={() => summary.refetch()} />
      }
    >
      <View style={styles.monthRow}>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))}>
          <Text style={styles.arrow}>‹</Text>
        </Pressable>
        <Text style={styles.month}>{monthLabel(month)}</Text>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, 1))}>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      </View>

      {summary.isError ? (
        <Text style={styles.error}>No pudimos traer el reporte. Probá de nuevo.</Text>
      ) : null}

      {summary.isLoading || !summary.data ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Facturaste</Text>
            <Text style={styles.cardTotal}>{formatArs(summary.data.incomeArs)}</Text>
            {Object.entries(summary.data.byCurrency)
              .filter(([, v]) => v.income > 0)
              .map(([currency, v]) => (
                <Text key={currency} style={styles.cardDetail}>
                  {formatAmount(v.income, currency)}
                </Text>
              ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Gastaste</Text>
            <Text style={styles.cardTotal}>{formatArs(summary.data.expenseArs)}</Text>
            {Object.entries(summary.data.byCurrency)
              .filter(([, v]) => v.expense > 0)
              .map(([currency, v]) => (
                <Text key={currency} style={styles.cardDetail}>
                  {formatAmount(v.expense, currency)}
                </Text>
              ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Te queda libre</Text>
            <Text style={styles.cardTotal}>{formatArs(summary.data.netAfterTax)}</Text>
            <Text style={styles.cardDetail}>
              − cuota monotributo ({formatArs(summary.data.tax.monthlyFee)}
              {summary.data.tax.category ? `, cat. ${summary.data.tax.category}` : ''})
            </Text>
            {summary.data.tax.source === 'suggested' ? (
              <Text style={styles.cardNote}>
                Categoría estimada: elegí la tuya abajo para que el número sea exacto.
              </Text>
            ) : null}
          </View>
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { fontSize: 28, color: colors.accent, paddingHorizontal: 12 },
  month: { fontSize: 18, fontWeight: '700', color: colors.ink, textTransform: 'capitalize' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cardTotal: { fontSize: 26, fontWeight: '700', color: colors.ink },
  cardDetail: { fontSize: 13, color: colors.muted },
  cardNote: { fontSize: 13, color: colors.accent, marginTop: 4 },
  error: { color: colors.danger },
})
```

- [ ] **Step 2: Registrar la pestaña**

En `mobile/app/(tabs)/_layout.tsx`, antes de la de Ajustes:

```tsx
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reportes',
          tabBarIcon: ({ color }) => <TabIcon name="pie-chart" color={String(color)} />,
        }}
      />
```

- [ ] **Step 3: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. Las flechas ‹ › cambian de mes y traen otros datos.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/\(tabs\)/reports.tsx mobile/app/\(tabs\)/_layout.tsx
git commit -m "feat(mobile): add reports tab with monthly summary"
```

---

### Task 8: Top clientes y bloque de monotributo

**Files:**
- Modify: `mobile/app/(tabs)/reports.tsx`

**Interfaces:**
- Consumes: `GET /reports/monotributo-alert` (Task 3), `PATCH /users/me` (Task 4), `setUser` de `AuthContext`.
- Produces: lista de top clientes, barra de uso del techo y chips A–K que guardan la categoría.

- [ ] **Step 1: Agregar la query y la mutación**

En `mobile/app/(tabs)/reports.tsx`:

```tsx
  const { accessToken, user, setUser } = useAuth()
  const queryClient = useQueryClient()

  const alert = useQuery({
    queryKey: ['monotributo-alert'],
    queryFn: () =>
      apiRequest<MonotributoAlert>('/reports/monotributo-alert', { token: accessToken }),
    enabled: !!accessToken,
  })

  const setCategory = useMutation({
    mutationFn: (category: string) =>
      apiRequest<User>('/users/me', {
        method: 'PATCH',
        token: accessToken,
        body: { monotributoCategory: category },
      }),
    onSuccess: async (updated) => {
      setUser(updated)
      await queryClient.invalidateQueries({ queryKey: ['monotributo-alert'] })
      await queryClient.invalidateQueries({ queryKey: ['monthly-summary'] })
    },
  })
```

con los imports de `useMutation`, `useQueryClient`, `MonotributoAlert` y `User`. Sumar `alert.refetch()` al `RefreshControl`.

- [ ] **Step 2: Renderizar el bloque**

Después de las tres tarjetas:

```tsx
          {summary.data.topClients.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Quién te pagó</Text>
              {summary.data.topClients.map((client) => (
                <View key={client.id ?? client.name} style={styles.clientRow}>
                  <Text style={styles.clientName} numberOfLines={1}>
                    {client.name}
                  </Text>
                  <Text style={styles.clientTotal}>{formatArs(client.totalArs)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {alert.data ? (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Monotributo</Text>
              {alert.data.percentUsed !== null ? (
                <>
                  <Text style={styles.cardDetail}>
                    Usaste {formatPercent(alert.data.percentUsed)} del techo de la categoría{' '}
                    {alert.data.category ?? alert.data.suggestedCategory}
                  </Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.min(alert.data.percentUsed, 100)}%`,
                          backgroundColor:
                            alert.data.status === 'exceeded' || alert.data.status === 'warning'
                              ? colors.danger
                              : colors.accent,
                        },
                      ]}
                    />
                  </View>
                </>
              ) : (
                <Text style={styles.cardDetail}>Te pasaste de todas las categorías.</Text>
              )}

              <Text style={[styles.cardDetail, { marginTop: 8 }]}>Tu categoría</Text>
              <View style={styles.chipRow}>
                {alert.data.scales.map((scale) => (
                  <Pressable
                    key={scale.category}
                    style={[styles.chip, alert.data?.category === scale.category && styles.chipActive]}
                    onPress={() => setCategory.mutate(scale.category)}
                    disabled={setCategory.isPending}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        alert.data?.category === scale.category && styles.chipTextActive,
                      ]}
                    >
                      {scale.category}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
```

y los estilos:

```ts
  clientRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  clientName: { flex: 1, fontSize: 14, color: colors.ink },
  clientTotal: { fontSize: 14, fontWeight: '700', color: colors.ink },
  barTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    overflow: 'hidden',
    marginTop: 6,
  },
  barFill: { height: 10, borderRadius: 999 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 40,
    alignItems: 'center',
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.ink, fontSize: 13 },
  chipTextActive: { color: colors.accent, fontWeight: '600' },
```

- [ ] **Step 3: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. Elegir una categoría actualiza la barra y la tarjeta "Te queda libre" sin recargar la app.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/\(tabs\)/reports.tsx
git commit -m "feat(mobile): show top clients and monotributo ceiling usage"
```

---

### Task 9: Banner de alerta en Inicio

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: la query `['monotributo-alert']` (Task 8), ya cacheada.
- Produces: banner compacto cuando `status` es `warning` o `exceeded`, que navega a Reportes.

- [ ] **Step 1: Agregar la query y el banner**

En `mobile/app/(tabs)/index.tsx`:

```tsx
  const alert = useQuery({
    queryKey: ['monotributo-alert'],
    queryFn: () =>
      apiRequest<MonotributoAlert>('/reports/monotributo-alert', { token: accessToken }),
    enabled: !!accessToken,
  })
```

y arriba de "Tu plata":

```tsx
          {alert.data && (alert.data.status === 'warning' || alert.data.status === 'exceeded') ? (
            <Pressable style={styles.taxBanner} onPress={() => router.push('/(tabs)/reports')}>
              <Text style={styles.taxBannerText}>
                {alert.data.status === 'exceeded'
                  ? 'Te pasaste del techo de tu categoría de monotributo'
                  : `Usaste ${Math.round(alert.data.percentUsed ?? 0)}% del techo de monotributo`}
              </Text>
            </Pressable>
          ) : null}
```

con los estilos:

```ts
  taxBanner: {
    backgroundColor: colors.danger,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  taxBannerText: { color: '#fff', fontWeight: '600' },
```

Sumar `alert.refetch()` a `onRefresh`.

- [ ] **Step 2: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. Con la categoría A elegida y un ingreso por encima del 80% del límite, el banner aparece; tocarlo lleva a Reportes.

- [ ] **Step 3: Commit**

```bash
git add mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): warn on the home screen when nearing the monotributo ceiling"
```

---

### Task 10: Documentación y verificación end-to-end

**Files:**
- Modify: `README.md`
- Modify: `IMPLEMENTATION_PLAN.md` (fila 6 del roadmap)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Documentar los endpoints**

En `README.md`, en la tabla de endpoints:

```
| GET | `/reports/monthly-summary?month=YYYY-MM` | Facturado, gastado y neto después de la cuota |
| GET | `/reports/monotributo-alert` | Uso del techo en 12 meses móviles + escalas |
| GET | `/users/me` | Usuario actual |
| PATCH | `/users/me` | Elegir o desactivar la categoría de monotributo |
```

Agregar la nota de vigencia: **las escalas cargadas rigen desde el 1/8/2026** ("locaciones y prestaciones de servicios", fuente `afip.gob.ar/monotributo/categorias.asp`), y para actualizarlas se agrega un bloque nuevo con otro `validFrom` en `backend/src/config/monotributoScales.ts` y se corre `npm run db:seed` — el bloque viejo no se toca, es el histórico.

- [ ] **Step 2: Marcar la fase 6 en el roadmap**

En `IMPLEMENTATION_PLAN.md`, fila 6 de "Orden de ejecución": `[Reportes mensuales + monotributo](docs/superpowers/specs/06-reportes-monotributo.md) ✅ implementada`.

- [ ] **Step 3: Verificación de backend**

```bash
docker compose up -d db
cd backend && npx prisma migrate dev && npm run db:seed && npm test
```

Expected: la migración aplica, el seed imprime las escalas y la suite entera queda verde.

```bash
docker compose exec db psql -U monedapp_user -d monedapp -c 'select count(*) from monotributo_scales;'
```

Expected: 11.

Con el server arriba, un token válido, y un ingreso ARS, uno USD y un gasto cargados:

```bash
TOKEN=... # accessToken de POST /auth/login
curl -s localhost:8000/reports/monthly-summary -H "Authorization: Bearer $TOKEN"
curl -s localhost:8000/reports/monotributo-alert -H "Authorization: Bearer $TOKEN"
curl -s -X PATCH localhost:8000/users/me -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"monotributoCategory":"A"}'
curl -s -X PATCH localhost:8000/users/me -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"monotributoCategory":"Z"}'
```

Expected: el resumen trae `byCurrency` con ARS y USD y `netAfterTax` = ingresos − gastos − cuota; la alerta arranca en `"status":"unset"` con `"suggestedCategory":"A"` en montos chicos; el primer PATCH devuelve 200 y la alerta pasa a `"ok"`; el segundo devuelve 400.

- [ ] **Step 4: Verificación de app**

```bash
cd mobile && npx expo start --ios
```

Recorrido: pestaña Reportes con los tres números → cambiar de mes y ver otros datos → elegir la categoría y ver moverse la barra y el "Te queda libre" sin recargar → superar el 80% y ver el banner en Inicio.

- [ ] **Step 5: Commit**

```bash
git add README.md IMPLEMENTATION_PLAN.md
git commit -m "docs: document monthly reports and the monotributo alert"
```
