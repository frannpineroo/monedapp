# Categorías de gasto y rubros de ingreso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada gasto e ingreso quede clasificado en una categoría elegida por el usuario, con categorías útiles desde el onboarding, ABM propio, y un reporte "en qué se te fue" con los totales del mes convertidos a ARS.

**Architecture:** Una categoría **es** una `Account` (`EXPENSE` para gastos, `INCOME` para rubros de ingreso) — sin modelo paralelo. El movimiento guarda `categoryAccountId` explícito (migración con backfill desde los asientos existentes) y el ledger usa esa cuenta como contrapartida en lugar de la primera cuenta del kind. El reporte por categoría convierte cada movimiento a ARS con el snapshot de cotización que ya tiene sellado.

**Tech Stack:** Node 22 · Express 5 · TypeScript · Prisma 7 + PostgreSQL · Vitest + supertest (Postgres real) · Expo (React Native) + expo-router + TanStack Query · StyleSheet nativo.

**Spec:** [docs/superpowers/specs/03-categorias.md](../specs/03-categorias.md)

**Rama:** `codex/f3-categorias` (implementada y mergeada a `main`). Crear desde `main`. No reutilizar ramas de otras fases.

**Depende de:** la fase 2 ([plan de ABM](2026-08-17-abm-billeteras-clientes.md)) — las Tasks 10-11 cuelgan la pantalla de categorías del tab Ajustes y reusan `mobile/src/ui/formStyles.ts`. Si la fase 2 todavía no está, esas dos tasks quedan bloqueadas; el backend (Tasks 1-9) no depende de nada.

## Global Constraints

- Una categoría es una `Account`; no se crea ningún modelo nuevo. La UI nunca dice "cuenta", "asiento" ni "Debe/Haber": dice "categoría".
- `GET /categories` **nunca** devuelve cuentas `ASSET`/`EQUITY` (las de billetera son ASSET) ni las cuentas de sistema `Deudores por ventas` / `Diferencia de cambio`, reservadas por el spec de cuentas por cobrar.
- La FK `movements.categoryAccountId` es `ON DELETE RESTRICT`: una categoría con movimientos no se borra, se responde 400.
- Borrar la **última** categoría de un kind también es 400: el ledger necesita un default al que caer.
- `transfer` nunca lleva categoría: mandar `categoryId` en una transferencia es 400.
- Categoría de otro usuario → **404** (aislamiento por `userId`), kind equivocado → **400**.
- Nombre de categoría repetido → **409** automático por P2002 de `@@unique([userId, name])` en `Account`; no agregar manejo propio.
- El asiento sigue balanceado (suma 0) después de cualquier cambio de categoría: `assertBalanced` no se toca en esta fase (el spec de cobrables lo reescribe).
- Los montos del reporte se convierten a ARS con `movement.exchangeRate.value` (el snapshot del movimiento), nunca con la cotización de hoy. Transferencias excluidas.
- Estilo del backend: `asyncHandler`, `AppError`, `paramId`, serializers de `backend/src/lib/serializers.ts`. Nada de librerías nuevas.
- La app no tiene suite de tests: las tasks de mobile se verifican con `npx tsc --noEmit` más una pasada manual en el simulador.
- **Commits en inglés**, formato `tipo: mensaje` (`feat:`, `fix:`, `test:`, `docs:`), como todo el historial del repo. `.cursor/rules/push-after-task.mdc` además pide commitear y pushear al terminar cada task, sin esperar que lo pidan.

---

### Task 1: Columna `categoryAccountId` con backfill

**Files:**
- Modify: `backend/prisma/schema.prisma:65-81` (model Account) y `:131-157` (model Movement)
- Create: `backend/prisma/migrations/<timestamp>_add_movement_category/migration.sql`
- Modify: `backend/src/routes/movements.ts:18-21` (`movementInclude`)
- Modify: `backend/src/lib/serializers.ts:23-52` (`serializeMovement`)
- Create: `backend/tests/categories.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `Movement.categoryAccountId` (`String?`, FK RESTRICT), relación `MovementCategory`, y `serializeMovement` devolviendo `category: { id, name } | null`. Lo consumen todas las tasks siguientes.

- [ ] **Step 1: Levantar la DB y escribir el test que falla**

```bash
docker compose up -d db
```

Crear `backend/tests/categories.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: FAIL — `res.body.category` es `undefined` y `stored.categoryAccountId` no existe en el modelo.

- [ ] **Step 3: Agregar la relación al schema**

En `backend/prisma/schema.prisma`, en `model Movement`, después de `clientId`:

```prisma
  categoryAccountId String?
```

y en el bloque de relaciones del mismo modelo:

```prisma
  categoryAccount Account? @relation("MovementCategory", fields: [categoryAccountId], references: [id], onDelete: Restrict)
```

más el índice, junto a los otros `@@index`:

```prisma
  @@index([categoryAccountId])
```

En `model Account`, junto a las otras relaciones:

```prisma
  categorizedMovements Movement[] @relation("MovementCategory")
```

- [ ] **Step 4: Generar la migración y agregarle el backfill a mano**

```bash
cd backend && npx prisma migrate dev --create-only --name add_movement_category
```

Al SQL generado (columna + índice + FK `ON DELETE RESTRICT`) agregarle al final el backfill, que lee el asiento que ya existe:

```sql
UPDATE "movements" m SET "categoryAccountId" = le."accountId"
FROM "ledger_entries" le
JOIN "accounts" a ON a.id = le."accountId"
WHERE le."movementId" = m.id
  AND ((m.type = 'expense' AND a.kind = 'EXPENSE') OR (m.type = 'income' AND a.kind = 'INCOME'));
```

Aplicar:

```bash
npx prisma migrate dev
```

- [ ] **Step 5: Incluir y serializar la categoría**

En `backend/src/routes/movements.ts`, sumar a `movementInclude`:

```ts
  categoryAccount: { select: { id: true, name: true } },
```

En `backend/src/lib/serializers.ts`, agregar al tipo del parámetro de `serializeMovement`:

```ts
    categoryAccount?: { id: string; name: string } | null
```

y al objeto devuelto, después de `client`:

```ts
    category: movement.categoryAccount
      ? { id: movement.categoryAccount.id, name: movement.categoryAccount.name }
      : null,
```

- [ ] **Step 6: Correr el test y verificar el backfill**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: PASS.

```bash
docker compose exec db psql -U monedapp_user -d monedapp -c \
  "select count(*) from movements where \"categoryAccountId\" is null and type in ('expense','income');"
```

Expected: cuenta solo los movimientos creados **después** de la migración (los viejos quedaron backfilleados). Si había datos previos y el número no baja, revisar el `UPDATE`.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/routes/movements.ts backend/src/lib/serializers.ts backend/tests/categories.test.ts
git commit -m "feat: add movement category with backfill from the ledger"
```

---

### Task 2: Categorías sembradas en el onboarding

**Files:**
- Modify: `backend/src/services/onboardingService.ts`
- Test: `backend/tests/categories.test.ts`

**Interfaces:**
- Consumes: `applyOnboarding` existente.
- Produces: `ensureDefaultCategories(userId): Promise<Account[]>` — upsert idempotente por `(userId, name)`, devuelve todas las cuentas `EXPENSE`/`INCOME` del usuario ordenadas por nombre. Lo usan `applyOnboarding` y `POST /categories/defaults` (Task 4).

**Decisión de implementación:** el spec propone extender `accountsForTemplate`, pero eso duplicaría la lista en dos lugares (plantilla y `ensureDefaultCategories`). Acá la lista vive una sola vez en `ensureDefaultCategories`, que `applyOnboarding` llama después de crear las cuentas de la plantilla. El resultado observable es el mismo y "Gastos operativos" / "Ingresos servicios" se conservan.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/categories.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: FAIL — hay 1 cuenta EXPENSE y 1 INCOME.

- [ ] **Step 3: Implementar el helper**

En `backend/src/services/onboardingService.ts`, arriba de `applyOnboarding`:

```ts
const DEFAULT_EXPENSE_CATEGORIES = [
  'Herramientas y software',
  'Internet y teléfono',
  'Equipamiento',
  'Impuestos y tasas',
  'Comisiones bancarias',
  'Otros gastos',
]

const DEFAULT_INCOME_CATEGORIES = ['Otros ingresos']

/** Idempotente: se puede llamar en el onboarding y de nuevo desde la app. */
export async function ensureDefaultCategories(userId: string) {
  const seeds = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ name, kind: AccountKind.EXPENSE })),
    ...DEFAULT_INCOME_CATEGORIES.map((name) => ({ name, kind: AccountKind.INCOME })),
  ]

  for (const seed of seeds) {
    await prisma.account.upsert({
      where: { userId_name: { userId, name: seed.name } },
      create: { userId, name: seed.name, kind: seed.kind, currency: null },
      update: {},
    })
  }

  return prisma.account.findMany({
    where: { userId, kind: { in: [AccountKind.EXPENSE, AccountKind.INCOME] } },
    orderBy: { name: 'asc' },
  })
}
```

En `applyOnboarding`, después del `await prisma.$transaction(...)` y antes del `return`:

```ts
  await ensureDefaultCategories(userId)
```

- [ ] **Step 4: Correr el test**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/onboardingService.ts backend/tests/categories.test.ts
git commit -m "feat: seed expense and income categories on onboarding"
```

---

### Task 3: `GET /categories`

**Files:**
- Create: `backend/src/routes/categories.ts`
- Modify: `backend/src/app.ts:21-27` (montaje del router)
- Modify: `backend/src/lib/serializers.ts` (`serializeCategory`)
- Test: `backend/tests/categories.test.ts`

**Interfaces:**
- Consumes: `ensureDefaultCategories` (Task 2).
- Produces:
  - `serializeCategory(account): { id: string; name: string; kind: 'EXPENSE' | 'INCOME' }`
  - `GET /categories?kind=EXPENSE|INCOME` → `Category[]`
  - `parseCategoryKind(value): AccountKind` y `SYSTEM_CATEGORY_NAMES`, usados por las Tasks 4-5.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/categories.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: FAIL — 404, la ruta no existe.

- [ ] **Step 3: Escribir el serializer**

En `backend/src/lib/serializers.ts`, sumar `Account` al import de `@prisma/client` y agregar:

```ts
export function serializeCategory(account: Account) {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
  }
}
```

- [ ] **Step 4: Escribir el router**

Crear `backend/src/routes/categories.ts`:

```ts
import { Router } from 'express'
import { AccountKind } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { serializeCategory } from '../lib/serializers'
import { requireAuth, AuthedRequest } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

/** Cuentas internas que el usuario no maneja como categoría. */
export const SYSTEM_CATEGORY_NAMES = ['Deudores por ventas', 'Diferencia de cambio']

const CATEGORY_KINDS = [AccountKind.EXPENSE, AccountKind.INCOME]

export function parseCategoryKind(value: unknown): AccountKind {
  if (value !== 'EXPENSE' && value !== 'INCOME') {
    throw new AppError(400, 'kind inválido (EXPENSE|INCOME)')
  }
  return value as AccountKind
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { kind } = req.query

    const kinds = kind === undefined ? CATEGORY_KINDS : [parseCategoryKind(kind)]

    const categories = await prisma.account.findMany({
      where: { userId, kind: { in: kinds }, name: { notIn: SYSTEM_CATEGORY_NAMES } },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    })

    res.json(categories.map(serializeCategory))
  })
)

export default router
```

En `backend/src/app.ts`, importar el router y montarlo junto a los otros:

```ts
  app.use('/categories', categoriesRouter)
```

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/categories.ts backend/src/app.ts backend/src/lib/serializers.ts backend/tests/categories.test.ts
git commit -m "feat: list categories by kind"
```

---

### Task 4: Alta de categorías y `POST /categories/defaults`

**Files:**
- Modify: `backend/src/routes/categories.ts`
- Test: `backend/tests/categories.test.ts`

**Interfaces:**
- Consumes: `parseCategoryKind` (Task 3), `ensureDefaultCategories` (Task 2).
- Produces: `POST /categories { name, kind }` → 201 `Category` (409 si el nombre se repite); `POST /categories/defaults` → 200 con la lista final.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/categories.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: FAIL — 404 en ambas rutas.

- [ ] **Step 3: Implementar**

En `backend/src/routes/categories.ts`, importar `ensureDefaultCategories` y agregar antes del `export default`:

```ts
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { name, kind } = req.body as { name?: unknown; kind?: unknown }

    if (typeof name !== 'string' || name.trim() === '') {
      throw new AppError(400, 'El nombre es requerido')
    }

    // Nombre repetido → P2002 → 409 desde asyncHandler.
    const category = await prisma.account.create({
      data: { userId, name: name.trim(), kind: parseCategoryKind(kind), currency: null },
    })

    res.status(201).json(serializeCategory(category))
  })
)

router.post(
  '/defaults',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const categories = await ensureDefaultCategories(userId)
    res.json(
      categories
        .filter((c) => !SYSTEM_CATEGORY_NAMES.includes(c.name))
        .map(serializeCategory)
    )
  })
)
```

`/defaults` va **antes** de cualquier ruta `/:id` para que Express no lo tome como un id.

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/categories.ts backend/tests/categories.test.ts
git commit -m "feat: create categories and pull the suggested set"
```

---

### Task 5: Renombrar y borrar categorías

**Files:**
- Modify: `backend/src/routes/categories.ts`
- Test: `backend/tests/categories.test.ts`

**Interfaces:**
- Consumes: lo de las Tasks 3-4.
- Produces: `PATCH /categories/:id { name }` → 200; `DELETE /categories/:id` → 204, o 400 si tiene movimientos / asientos, o 400 si es la última de su kind.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/categories.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: FAIL — 404 en `PATCH` y `DELETE`.

- [ ] **Step 3: Implementar**

En `backend/src/routes/categories.ts`, importar `paramId` de `../lib/params` y agregar:

```ts
async function findOwnedCategory(userId: string, id: string) {
  const category = await prisma.account.findFirst({
    where: { id, userId, kind: { in: CATEGORY_KINDS }, name: { notIn: SYSTEM_CATEGORY_NAMES } },
  })
  if (!category) throw new AppError(404, 'Categoría no encontrada')
  return category
}

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const category = await findOwnedCategory(userId, paramId(req.params.id))
    const { name } = req.body as { name?: unknown }

    if (typeof name !== 'string' || name.trim() === '') {
      throw new AppError(400, 'El nombre es requerido')
    }

    const updated = await prisma.account.update({
      where: { id: category.id },
      data: { name: name.trim() },
    })
    res.json(serializeCategory(updated))
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const category = await findOwnedCategory(userId, paramId(req.params.id))

    const movementCount = await prisma.movement.count({
      where: { categoryAccountId: category.id },
    })
    // Los movimientos viejos (previos al backfill) solo aparecen en el ledger.
    const entryCount = await prisma.ledgerEntry.count({ where: { accountId: category.id } })
    if (movementCount > 0 || entryCount > 0) {
      throw new AppError(400, 'No se puede borrar una categoría con movimientos')
    }

    const sameKindCount = await prisma.account.count({
      where: { userId, kind: category.kind, name: { notIn: SYSTEM_CATEGORY_NAMES } },
    })
    if (sameKindCount <= 1) {
      throw new AppError(400, 'No se puede borrar la última categoría de este tipo')
    }

    await prisma.account.delete({ where: { id: category.id } })
    res.status(204).send()
  })
)
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/categories.ts backend/tests/categories.test.ts
git commit -m "feat: rename and delete categories with guarded deletion"
```

---

### Task 6: El movimiento usa la categoría como contrapartida

**Files:**
- Modify: `backend/src/services/ledgerService.ts:13-70`
- Modify: `backend/src/routes/movements.ts` (POST)
- Test: `backend/tests/categories.test.ts`

**Interfaces:**
- Consumes: `categoryAccountId` (Task 1), categorías (Tasks 2-4).
- Produces:
  - `createLedgerForMovement(tx, { ..., categoryAccountId?: string | null })` — si viene, es la contrapartida; si no, cae al default actual.
  - `resolveCategoryAccountId(userId, movementType, categoryId): Promise<string | null>` en `movements.ts`, reusado por la Task 7.
  - `POST /movements` acepta `categoryId`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/categories.test.ts`:

```ts
describe('POST /movements con categoría', () => {
  it('el asiento apunta a la categoría elegida', async () => {
    const { token, wallets } = await setupUser()
    const categories = await request(app).get('/categories?kind=EXPENSE').set(auth(token))
    const category = (categories.body as { id: string; name: string }[])[0]

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: wallets[0].id,
        type: 'expense',
        amount: 1000,
        description: 'Licencia anual',
        categoryId: category.id,
      })

    expect(res.status).toBe(201)
    expect(res.body.category).toEqual({ id: category.id, name: category.name })

    const entries = await prisma.ledgerEntry.findMany({ where: { movementId: res.body.id } })
    expect(entries.map((e) => e.accountId)).toContain(category.id)
    expect(entries.reduce((sum, e) => sum + Number(e.change), 0)).toBe(0)
  })

  it('categoría de kind equivocado → 400', async () => {
    const { token, wallets } = await setupUser()
    const income = await request(app).get('/categories?kind=INCOME').set(auth(token))

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: wallets[0].id,
        type: 'expense',
        amount: 100,
        description: 'Mal categorizado',
        categoryId: (income.body as { id: string }[])[0].id,
      })

    expect(res.status).toBe(400)
  })

  it('categoría de otro usuario → 404', async () => {
    const owner = await setupUser()
    const intruder = await setupUser()
    const categories = await request(app).get('/categories?kind=EXPENSE').set(auth(owner.token))

    const res = await request(app)
      .post('/movements')
      .set(auth(intruder.token))
      .send({
        walletId: intruder.wallets[0].id,
        type: 'expense',
        amount: 100,
        description: 'Ajena',
        categoryId: (categories.body as { id: string }[])[0].id,
      })

    expect(res.status).toBe(404)
  })

  it('transferencia con categoryId → 400', async () => {
    const { token, wallets } = await setupUser()
    const categories = await request(app).get('/categories?kind=EXPENSE').set(auth(token))
    const ars = wallets.filter((w) => w.currency === 'ARS')
    const destino = ars[1] ?? (await request(app)
      .post('/wallets')
      .set(auth(token))
      .send({ name: 'Otra ARS', currency: 'ARS' })).body

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars[0].id,
        toWalletId: destino.id,
        type: 'transfer',
        amount: 100,
        description: 'Pase interno',
        categoryId: (categories.body as { id: string }[])[0].id,
      })

    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: FAIL — el `categoryId` se ignora: el asiento apunta a "Gastos operativos" y los casos de error devuelven 201.

- [ ] **Step 3: Aceptar la categoría en el ledger**

En `backend/src/services/ledgerService.ts`, sumar el campo al tipo de `params`:

```ts
    toWalletAccountId?: string | null
    categoryAccountId?: string | null
```

y usarlo como contrapartida:

```ts
  if (params.type === MovementType.income) {
    const incomeAccountId =
      params.categoryAccountId ?? (await getDefaultIncomeAccountId(tx, params.userId))
```

```ts
  } else if (params.type === MovementType.expense) {
    const expenseAccountId =
      params.categoryAccountId ?? (await getDefaultExpenseAccountId(tx, params.userId))
```

- [ ] **Step 4: Validar y persistir en el POST**

En `backend/src/routes/movements.ts`, sumar `AccountKind` al import de `@prisma/client` y agregar el helper junto a `parseMovementType`:

```ts
async function resolveCategoryAccountId(
  userId: string,
  movementType: MovementType,
  categoryId: unknown
): Promise<string | null> {
  if (categoryId === undefined || categoryId === null) return null
  if (typeof categoryId !== 'string') throw new AppError(400, 'categoryId inválido')
  if (movementType === MovementType.transfer) {
    throw new AppError(400, 'Las transferencias no llevan categoría')
  }

  const category = await prisma.account.findFirst({ where: { id: categoryId, userId } })
  if (!category) throw new AppError(404, 'Categoría no encontrada')

  const expected =
    movementType === MovementType.expense ? AccountKind.EXPENSE : AccountKind.INCOME
  if (category.kind !== expected) {
    throw new AppError(400, 'La categoría no corresponde al tipo de movimiento')
  }

  return category.id
}
```

En el handler `POST /`, leer `categoryId` del body y resolverlo después de validar la billetera:

```ts
    const categoryAccountId = await resolveCategoryAccountId(userId, movementType, categoryId)
```

sumarlo al `create`:

```ts
          categoryAccountId,
```

y pasarlo a `createLedgerForMovement`:

```ts
        categoryAccountId,
```

- [ ] **Step 5: Correr toda la suite**

Run: `cd backend && npm test`
Expected: PASS — auth, exchange rates, wallets-clients y categories (16 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ledgerService.ts backend/src/routes/movements.ts backend/tests/categories.test.ts
git commit -m "feat: post expenses and income against the chosen category"
```

---

### Task 7: Cambiar la categoría de un movimiento

**Files:**
- Modify: `backend/src/routes/movements.ts` (PATCH)
- Test: `backend/tests/categories.test.ts`

**Interfaces:**
- Consumes: `resolveCategoryAccountId` y `createLedgerForMovement` (Task 6).
- Produces: `PATCH /movements/:id { categoryId }` regenera el asiento en una transacción. Monto, tipo y billetera siguen sin poder editarse.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/categories.test.ts`:

```ts
describe('PATCH /movements/:id cambiando categoría', () => {
  it('regenera el asiento contra la categoría nueva y sigue balanceado', async () => {
    const { token, wallets } = await setupUser()
    const categories = await request(app).get('/categories?kind=EXPENSE').set(auth(token))
    const [primera, segunda] = categories.body as { id: string; name: string }[]

    const created = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: wallets[0].id,
        type: 'expense',
        amount: 1000,
        description: 'Licencia anual',
        categoryId: primera.id,
      })

    const res = await request(app)
      .patch(`/movements/${created.body.id}`)
      .set(auth(token))
      .send({ categoryId: segunda.id })

    expect(res.status).toBe(200)
    expect(res.body.category.id).toBe(segunda.id)

    const entries = await prisma.ledgerEntry.findMany({ where: { movementId: created.body.id } })
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.accountId)).toContain(segunda.id)
    expect(entries.map((e) => e.accountId)).not.toContain(primera.id)
    expect(entries.reduce((sum, e) => sum + Number(e.change), 0)).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: FAIL — el `PATCH` ignora `categoryId`, `res.body.category.id` sigue siendo la primera.

- [ ] **Step 3: Implementar**

En `backend/src/routes/movements.ts`, en el handler `PATCH /:id`, leer `categoryId` del body:

```ts
    const { description, date, clientId, categoryId } = req.body as Record<string, unknown>
```

y, después de armar `data` y antes del `prisma.movement.update` actual:

```ts
    if (categoryId !== undefined) {
      const categoryAccountId = await resolveCategoryAccountId(userId, existing.type, categoryId)

      const movement = await prisma.$transaction(async (tx) => {
        const updated = await tx.movement.update({
          where: { id: existing.id },
          data: {
            ...data,
            categoryAccount: categoryAccountId
              ? { connect: { id: categoryAccountId } }
              : { disconnect: true },
          },
        })

        // Monto, tipo y billetera no cambian: alcanza con reescribir las dos patas.
        await tx.ledgerEntry.deleteMany({ where: { movementId: updated.id } })
        await createLedgerForMovement(tx, {
          userId,
          movementId: updated.id,
          type: updated.type,
          amount: updated.amount,
          currency: updated.currency,
          walletAccountId: existing.wallet.accountId,
          categoryAccountId,
        })

        return tx.movement.findUniqueOrThrow({
          where: { id: updated.id },
          include: movementInclude,
        })
      })

      res.json(serializeMovement(movement))
      return
    }
```

Nota: este camino no cubre `transfer` porque `resolveCategoryAccountId` ya rechaza con 400 antes de llegar acá.

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/movements.ts backend/tests/categories.test.ts
git commit -m "feat: change a movement's category and rebuild its ledger entries"
```

---

### Task 8: Filtro `categoryId` en la lista de movimientos

**Files:**
- Modify: `backend/src/routes/movements.ts:37-60` (`GET /`)
- Test: `backend/tests/categories.test.ts`

**Interfaces:**
- Consumes: `categoryAccountId` (Task 1).
- Produces: `GET /movements?categoryId=…`, usado por el filtro de la app (Task 13).

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/categories.test.ts`:

```ts
describe('GET /movements?categoryId', () => {
  it('devuelve solo los movimientos de esa categoría', async () => {
    const { token, wallets } = await setupUser()
    const categories = await request(app).get('/categories?kind=EXPENSE').set(auth(token))
    const [primera, segunda] = categories.body as { id: string }[]

    for (const [categoryId, description] of [
      [primera.id, 'Gasto A'],
      [segunda.id, 'Gasto B'],
    ] as const) {
      await request(app)
        .post('/movements')
        .set(auth(token))
        .send({
          walletId: wallets[0].id,
          type: 'expense',
          amount: 100,
          description,
          categoryId,
        })
    }

    const res = await request(app).get(`/movements?categoryId=${segunda.id}`).set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].description).toBe('Gasto B')
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: FAIL — devuelve los 2 movimientos, el filtro se ignora.

- [ ] **Step 3: Implementar**

En `backend/src/routes/movements.ts`, en el `GET /`:

```ts
    const { walletId, clientId, categoryId, type, from, to } = req.query
```

```ts
    if (typeof categoryId === 'string') where.categoryAccountId = categoryId
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/movements.ts backend/tests/categories.test.ts
git commit -m "feat: filter movements by category"
```

---

### Task 9: `GET /reports/by-category`

**Files:**
- Create: `backend/src/services/reportService.ts`
- Modify: `backend/src/routes/reports.ts`
- Test: `backend/tests/categories.test.ts`

**Interfaces:**
- Consumes: `Movement.categoryAccount` y `Movement.exchangeRate`.
- Produces:
  - `toArs(amount, rateValue): number`
  - `sumByCategory(movements): { categoryId: string | null; name: string; total: number; percent: number }[]` — ordenado descendente, `percent` sobre el total. Lo reusa el spec de reportes mensuales (fase 6).
  - `GET /reports/by-category?month=YYYY-MM&type=expense|income`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/categories.test.ts`:

```ts
describe('GET /reports/by-category', () => {
  it('suma en ARS con el snapshot de cada movimiento y los percent dan 100', async () => {
    const { token, wallets } = await setupUser()
    const categories = await request(app).get('/categories?kind=EXPENSE').set(auth(token))
    const [primera, segunda] = categories.body as { id: string; name: string }[]
    const ars = wallets.find((w) => w.currency === 'ARS')!
    const usd = wallets.find((w) => w.currency === 'USD')!
    const month = new Date().toISOString().slice(0, 7)

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: ars.id,
        type: 'expense',
        amount: 1000,
        description: 'Gasto en pesos',
        categoryId: primera.id,
      })

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        walletId: usd.id,
        type: 'expense',
        amount: 10,
        description: 'Gasto en dólares',
        categoryId: segunda.id,
      })

    const res = await request(app)
      .get(`/reports/by-category?month=${month}&type=expense`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)

    const total = res.body.reduce((sum: number, r: { total: number }) => sum + r.total, 0)
    // El gasto en USD pesa mucho más: el snapshot lo convierte a ARS.
    expect(total).toBeGreaterThan(1000)
    expect(res.body[0].total).toBeGreaterThanOrEqual(res.body[1].total)

    const percent = res.body.reduce((sum: number, r: { percent: number }) => sum + r.percent, 0)
    expect(Math.round(percent)).toBe(100)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/categories.test.ts`
Expected: FAIL — 404, la ruta no existe.

- [ ] **Step 3: Escribir el service**

Crear `backend/src/services/reportService.ts`:

```ts
import { Prisma } from '@prisma/client'

type Numeric = Prisma.Decimal | number | string

/** El movimiento guarda el tipo de cambio del día en que ocurrió: se usa ese, no el de hoy. */
export function toArs(amount: Numeric, rateValue: Numeric): number {
  return Number(amount) * Number(rateValue)
}

export type CategoryTotal = {
  categoryId: string | null
  name: string
  total: number
  percent: number
}

export type CategorizedMovement = {
  categoryAccountId: string | null
  categoryAccount: { name: string } | null
  amount: Numeric
  exchangeRate: { value: Numeric }
}

export function sumByCategory(movements: CategorizedMovement[]): CategoryTotal[] {
  const totals = new Map<string, { categoryId: string | null; name: string; total: number }>()

  for (const movement of movements) {
    const key = movement.categoryAccountId ?? 'sin-categoria'
    const current = totals.get(key) ?? {
      categoryId: movement.categoryAccountId,
      name: movement.categoryAccount?.name ?? 'Sin categoría',
      total: 0,
    }
    current.total += toArs(movement.amount, movement.exchangeRate.value)
    totals.set(key, current)
  }

  const rows = [...totals.values()].sort((a, b) => b.total - a.total)
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0)

  return rows.map((row) => ({
    ...row,
    total: Math.round(row.total * 100) / 100,
    percent: grandTotal === 0 ? 0 : Math.round((row.total / grandTotal) * 10000) / 100,
  }))
}
```

- [ ] **Step 4: Escribir la ruta**

En `backend/src/routes/reports.ts`, sumar imports (`MovementType` de `@prisma/client`, `AppError`, `sumByCategory`) y agregar:

```ts
/** 'YYYY-MM' → [primer día del mes, primer día del siguiente), en UTC. */
function parseMonth(value: unknown): { from: Date; to: Date } {
  const now = new Date()
  const raw =
    typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
      ? value
      : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  const [year, month] = raw.split('-').map(Number)
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 1)),
  }
}

router.get(
  '/by-category',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { month, type } = req.query

    if (type !== undefined && type !== 'expense' && type !== 'income') {
      throw new AppError(400, 'type inválido (expense|income)')
    }
    const movementType = type === 'income' ? MovementType.income : MovementType.expense
    const { from, to } = parseMonth(month)

    const movements = await prisma.movement.findMany({
      where: { userId, type: movementType, date: { gte: from, lt: to } },
      select: {
        categoryAccountId: true,
        amount: true,
        categoryAccount: { select: { name: true } },
        exchangeRate: { select: { value: true } },
      },
    })

    res.json(sumByCategory(movements))
  })
)
```

- [ ] **Step 5: Correr toda la suite**

Run: `cd backend && npm test`
Expected: PASS (19 tests de categories + el resto).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/reportService.ts backend/src/routes/reports.ts backend/tests/categories.test.ts
git commit -m "feat: category totals report converted to ARS"
```

---

### Task 10: Pantalla de categorías (listado)

**Files:**
- Modify: `mobile/src/api/types.ts`
- Create: `mobile/app/categories.tsx`
- Modify: `mobile/app/_layout.tsx` (`Stack` raíz)
- Modify: `mobile/app/(tabs)/settings.tsx` (fila nueva)

**Interfaces:**
- Consumes: `GET /categories` (Task 3).
- Produces: `Category = { id, name, kind }` y `Movement.category`, usados por las Tasks 11-14; ruta `/categories` navegable desde Ajustes.

- [ ] **Step 1: Agregar los tipos**

En `mobile/src/api/types.ts`:

```ts
export type Category = {
  id: string
  name: string
  kind: 'EXPENSE' | 'INCOME'
}
```

y dentro de `Movement`, después de `client`:

```ts
  category?: { id: string; name: string } | null
```

- [ ] **Step 2: Registrar la ruta**

En `mobile/app/_layout.tsx`, junto a las de `wallets` y `clients`:

```tsx
            <Stack.Screen
              name="categories"
              options={{
                headerShown: true,
                title: 'Categorías',
                headerStyle: { backgroundColor: colors.bg },
                headerShadowVisible: false,
              }}
            />
```

En `mobile/app/(tabs)/settings.tsx`, agregar la fila al array `rows`:

```tsx
    { href: '/categories' as const, label: 'Categorías', count: categories.data?.length },
```

con su query, al lado de las de wallets y clients:

```tsx
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiRequest<Category[]>('/categories', { token: accessToken }),
    enabled: !!accessToken,
  })
```

y el import del tipo `Category`.

- [ ] **Step 3: Escribir el listado**

Crear `mobile/app/categories.tsx`:

```tsx
import { apiRequest } from '@/src/api/client'
import type { Category } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'

type Kind = 'EXPENSE' | 'INCOME'

export default function CategoriesScreen() {
  const { accessToken } = useAuth()
  const [kind, setKind] = useState<Kind>('EXPENSE')

  const categories = useQuery({
    queryKey: ['categories', kind],
    queryFn: () =>
      apiRequest<Category[]>(`/categories?kind=${kind}`, { token: accessToken }),
    enabled: !!accessToken,
  })

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        <View style={formStyles.rowWrap}>
          {(
            [
              { id: 'EXPENSE' as const, label: 'Gastos' },
              { id: 'INCOME' as const, label: 'Ingresos' },
            ] as const
          ).map((opt) => (
            <Pressable
              key={opt.id}
              style={[formStyles.chip, kind === opt.id && formStyles.chipActive]}
              onPress={() => setKind(opt.id)}
            >
              <Text
                style={[formStyles.chipText, kind === opt.id && formStyles.chipTextActive]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {categories.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={categories.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={categories.isFetching}
              onRefresh={() => categories.refetch()}
            />
          }
          ListEmptyComponent={<Text style={styles.empty}>Todavía no tenés categorías.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.row}>
              <Text style={styles.name}>{item.name}</Text>
            </Pressable>
          )}
        />
      )}

      <View style={styles.footer}>
        <Pressable style={formStyles.button}>
          <Text style={formStyles.buttonText}>Nueva categoría</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  filters: { paddingHorizontal: 16, paddingTop: 12 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.ink },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
})
```

- [ ] **Step 4: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. Ajustes → Categorías lista las 6 de gasto sembradas; el chip "Ingresos" muestra los rubros.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/types.ts mobile/app/categories.tsx mobile/app/_layout.tsx mobile/app/\(tabs\)/settings.tsx
git commit -m "feat(mobile): list expense and income categories"
```

---

### Task 11: Alta, edición y borrado de categorías

**Files:**
- Modify: `mobile/app/categories.tsx`

**Interfaces:**
- Consumes: `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` (Tasks 4-5).
- Produces: modal de alta/edición con borrado confirmado; los 400/409 del backend se muestran tal cual.

- [ ] **Step 1: Agregar estado y mutaciones**

Sumar imports (`Alert`, `Modal`, `TextInput`, `useMutation`, `useQueryClient`, `ApiError`) y dentro del componente:

```tsx
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const open = Boolean(editing) || creating

  function openCreate() {
    setEditing(null)
    setCreating(true)
    setName('')
    setError(null)
  }

  function openEdit(category: Category) {
    setCreating(false)
    setEditing(category)
    setName(category.name)
    setError(null)
  }

  function close() {
    setCreating(false)
    setEditing(null)
    setError(null)
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['categories'] })
  }

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiRequest<Category>(`/categories/${editing.id}`, {
            method: 'PATCH',
            token: accessToken,
            body: { name: name.trim() },
          })
        : apiRequest<Category>('/categories', {
            method: 'POST',
            token: accessToken,
            body: { name: name.trim(), kind },
          }),
    onSuccess: async () => {
      await refresh()
      close()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo guardar'),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/categories/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      await refresh()
      close()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo borrar'),
  })

  function submit() {
    setError(null)
    if (!name.trim()) {
      setError('Escribí un nombre')
      return
    }
    save.mutate()
  }

  function confirmRemove() {
    if (!editing) return
    Alert.alert('Borrar categoría', `¿Borrar "${editing.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => remove.mutate(editing.id) },
    ])
  }
```

La query key es `['categories', kind]`, y `invalidateQueries({ queryKey: ['categories'] })` invalida ambas variantes por prefijo.

- [ ] **Step 2: Conectar el botón y las filas**

Fila: `onPress={() => openEdit(item)}`. Footer: `onPress={openCreate}`.

- [ ] **Step 3: Renderizar el modal**

Antes del `</View>` que cierra el `container`:

```tsx
      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {editing ? 'Editar categoría' : `Nueva categoría de ${kind === 'EXPENSE' ? 'gasto' : 'ingreso'}`}
            </Text>

            <Text style={formStyles.label}>Nombre</Text>
            <TextInput
              style={formStyles.input}
              placeholder="Ej. Herramientas y software"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
            />

            {error ? <Text style={formStyles.error}>{error}</Text> : null}

            <Pressable style={formStyles.button} onPress={submit} disabled={save.isPending}>
              {save.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={formStyles.buttonText}>Guardar</Text>
              )}
            </Pressable>

            {editing ? (
              <Pressable onPress={confirmRemove} disabled={remove.isPending}>
                <Text style={styles.delete}>Borrar categoría</Text>
              </Pressable>
            ) : null}

            <Pressable onPress={close}>
              <Text style={styles.cancel}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
```

Agregar los estilos, con los mismos valores que en `mobile/app/wallets.tsx`:

```ts
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  delete: { color: colors.danger, textAlign: 'center', paddingVertical: 8, fontWeight: '600' },
  cancel: { color: colors.muted, textAlign: 'center', paddingVertical: 8 },
```

- [ ] **Step 4: Chequear tipos y probar los caminos de error**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. En el simulador: crear "Publicidad", renombrarla, intentar crearla de nuevo (mensaje del 409), intentar borrar una que tiene movimientos (`No se puede borrar una categoría con movimientos`).

- [ ] **Step 5: Commit**

```bash
git add mobile/app/categories.tsx
git commit -m "feat(mobile): create, rename and delete categories"
```

---

### Task 12: Elegir categoría al cargar un movimiento

**Files:**
- Modify: `mobile/app/(tabs)/new-movement.tsx`

**Interfaces:**
- Consumes: `GET /categories?kind=…`, `POST /categories`, `POST /movements` con `categoryId`.
- Produces: chips de categoría con alta inline, calcados del patrón de "Nuevo cliente" que ya está en esa pantalla.

- [ ] **Step 1: Agregar la query y el estado**

Sumar `Category` al import de tipos y, debajo de la query `clients`:

```tsx
  const categoryKind = type === 'expense' ? 'EXPENSE' : 'INCOME'

  const categories = useQuery({
    queryKey: ['categories', categoryKind],
    queryFn: () =>
      apiRequest<Category[]>(`/categories?kind=${categoryKind}`, { token: accessToken }),
    enabled: !!accessToken && type !== 'transfer',
  })

  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  const createCategory = useMutation({
    mutationFn: (name: string) =>
      apiRequest<Category>('/categories', {
        method: 'POST',
        token: accessToken,
        body: { name, kind: categoryKind },
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['categories'] })
      setCategoryId(created.id)
      setNewCategoryName('')
      setShowNewCategory(false)
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'No se pudo crear la categoría')
    },
  })

  function submitNewCategory() {
    setError(null)
    const name = newCategoryName.trim()
    if (!name) {
      setError('Escribí el nombre de la categoría')
      return
    }
    createCategory.mutate(name)
  }
```

En `selectType`, limpiar la categoría al cambiar de tipo (la lista depende del kind):

```tsx
    setCategoryId(null)
    setShowNewCategory(false)
    setNewCategoryName('')
```

- [ ] **Step 2: Renderizar los chips**

Insertar después del bloque de cliente y antes del de "Monto":

```tsx
      {type !== 'transfer' ? (
        <>
          <Text style={styles.label}>Categoría</Text>
          <View style={styles.rowWrap}>
            {(categories.data ?? []).map((c) => (
              <Pressable
                key={c.id}
                style={[styles.chip, categoryId === c.id && styles.chipActive]}
                onPress={() => setCategoryId(c.id)}
              >
                <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.chip, showNewCategory && styles.chipActive]}
              onPress={() => setShowNewCategory((v) => !v)}
            >
              <Text style={[styles.chipText, showNewCategory && styles.chipTextActive]}>
                Nueva categoría
              </Text>
            </Pressable>
          </View>
          {showNewCategory ? (
            <View style={styles.newClientRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Nombre de la categoría"
                placeholderTextColor={colors.muted}
                value={newCategoryName}
                onChangeText={setNewCategoryName}
              />
              <Pressable
                style={styles.smallButton}
                onPress={submitNewCategory}
                disabled={createCategory.isPending}
              >
                {createCategory.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Agregar</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}
```

- [ ] **Step 3: Mandar y validar la categoría**

En el `body` de la mutación `create`, después de `clientId`:

```ts
          categoryId: type !== 'transfer' ? (categoryId ?? undefined) : undefined,
```

En `submit()`, después de la validación del monto:

```ts
    if (type !== 'transfer' && !categoryId) {
      setError('Elegí una categoría')
      return
    }
```

En `onSuccess` de `create`, limpiar también la categoría:

```ts
      setCategoryId(null)
```

- [ ] **Step 4: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. En el simulador: cargar un gasto eligiendo categoría; crear una desde el formulario y verla quedar seleccionada; al pasar a "Transferencia" el bloque desaparece.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(tabs\)/new-movement.tsx
git commit -m "feat(mobile): pick or create a category when adding a movement"
```

---

### Task 13: Categoría en la lista de movimientos

**Files:**
- Modify: `mobile/app/(tabs)/movements.tsx`

**Interfaces:**
- Consumes: `Movement.category` (Task 10) y `GET /movements?categoryId` (Task 8).
- Produces: categoría en la línea meta y fila de chips de filtro por categoría.

- [ ] **Step 1: Agregar el filtro**

Sumar `Category` al import de tipos y, junto a los otros filtros:

```tsx
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiRequest<Category[]>('/categories', { token: accessToken }),
    enabled: !!accessToken,
  })
```

En la query de movimientos, sumar la key y el parámetro:

```tsx
    queryKey: ['movements', { type: typeFilter, walletId: walletFilter, categoryId: categoryFilter }],
```

```tsx
      if (categoryFilter) params.set('categoryId', categoryFilter)
```

y en `hasFilters`:

```tsx
  const hasFilters = typeFilter !== 'all' || walletFilter !== null || categoryFilter !== null
```

- [ ] **Step 2: Renderizar los chips de categoría**

Después del bloque de chips de billetera, dentro de `styles.filters`:

```tsx
        <Text style={[styles.filterLabel, { marginTop: 10 }]}>Categoría</Text>
        <View style={styles.chipRow}>
          <Pressable
            style={[styles.chip, categoryFilter === null && styles.chipActive]}
            onPress={() => setCategoryFilter(null)}
          >
            <Text style={[styles.chipText, categoryFilter === null && styles.chipTextActive]}>
              Todas
            </Text>
          </Pressable>
          {(categories.data ?? []).map((c) => (
            <Pressable
              key={c.id}
              style={[styles.chip, categoryFilter === c.id && styles.chipActive]}
              onPress={() => setCategoryFilter(c.id)}
            >
              <Text style={[styles.chipText, categoryFilter === c.id && styles.chipTextActive]}>
                {c.name}
              </Text>
            </Pressable>
          ))}
        </View>
```

- [ ] **Step 3: Mostrar la categoría en la línea meta**

En `renderItem`, junto a `clientSuffix`:

```ts
            const categorySuffix = item.category?.name ? ` · ${item.category.name}` : ''
```

y sumarlo al `<Text style={styles.meta}>`:

```tsx
                    {typeLabel[item.type]} · {item.wallet?.name ?? item.currency}
                    {categorySuffix}
                    {clientSuffix}
```

- [ ] **Step 4: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. En el simulador: los gastos muestran `Gasto · Efectivo ARS · Herramientas y software`; filtrar por una categoría deja solo sus movimientos.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(tabs\)/movements.tsx
git commit -m "feat(mobile): show and filter movements by category"
```

---

### Task 14: Bloque "En qué se te fue" en Inicio

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `GET /reports/by-category?month=YYYY-MM&type=expense` (Task 9).
- Produces: bloque con las 5 categorías top del mes y barras proporcionales, sin librerías nuevas.

- [ ] **Step 1: Agregar la query**

Dentro del componente, junto a las otras queries:

```tsx
  const month = new Date().toISOString().slice(0, 7)

  const byCategory = useQuery({
    queryKey: ['by-category', month],
    queryFn: () =>
      apiRequest<{ categoryId: string | null; name: string; total: number; percent: number }[]>(
        `/reports/by-category?month=${month}&type=expense`,
        { token: accessToken }
      ),
    enabled: !!accessToken,
  })

  const topCategories = (byCategory.data ?? []).slice(0, 5)
```

Sumar `byCategory.refetch()` a `onRefresh` y `byCategory` a sus dependencias.

- [ ] **Step 2: Renderizar el bloque**

Después del bloque de "Tus billeteras" y antes de "Últimos movimientos":

```tsx
          {topCategories.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>En qué se te fue</Text>
              <View style={styles.categoryCard}>
                {topCategories.map((row) => (
                  <View key={row.categoryId ?? row.name} style={styles.categoryRow}>
                    <View style={styles.categoryHeader}>
                      <Text style={styles.categoryName} numberOfLines={1}>
                        {row.name}
                      </Text>
                      <Text style={styles.categoryTotal}>{formatAmount(row.total, 'ARS')}</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.max(row.percent, 2)}%` }]} />
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}
```

Agregar los estilos:

```ts
  categoryCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
    marginBottom: 24,
  },
  categoryRow: { gap: 6 },
  categoryHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  categoryName: { flex: 1, fontSize: 14, color: colors.ink },
  categoryTotal: { fontSize: 14, fontWeight: '700', color: colors.ink },
  barTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    overflow: 'hidden',
  },
  barFill: { height: 8, borderRadius: 999, backgroundColor: colors.accent },
```

Los totales están en ARS: el backend ya convirtió cada movimiento con su snapshot.

- [ ] **Step 3: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. En el simulador, con dos o tres gastos categorizados del mes, aparece el bloque con barras proporcionales; sin gastos, no aparece.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): show where the month's money went by category"
```

---

### Task 15: Documentación y verificación end-to-end

**Files:**
- Modify: `README.md`
- Modify: `IMPLEMENTATION_PLAN.md` (fila 3 del roadmap)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Documentar los endpoints**

En `README.md`, en la tabla de endpoints, agregar:

```
| GET | `/categories?kind=EXPENSE\|INCOME` | Categorías de gasto y rubros de ingreso |
| POST | `/categories` | Crear categoría (409 si el nombre se repite) |
| POST | `/categories/defaults` | Traer el set sugerido (idempotente) |
| PATCH | `/categories/:id` | Renombrar |
| DELETE | `/categories/:id` | 400 si tiene movimientos o es la última del tipo |
| GET | `/reports/by-category?month=YYYY-MM&type=expense` | Totales por categoría en ARS |
```

- [ ] **Step 2: Marcar la fase 3 en el roadmap**

En `IMPLEMENTATION_PLAN.md`, en la fila 3 de "Orden de ejecución", cambiar el título a `[Categorías de gasto y rubros de ingreso](docs/superpowers/specs/03-categorias.md) ✅ implementada`.

- [ ] **Step 3: Verificación de backend**

```bash
docker compose up -d db
cd backend && npx prisma migrate dev && npm test
```

Expected: la migración `add_movement_category` aplica con su backfill; la suite entera en verde.

```bash
docker compose exec db psql -U monedapp_user -d monedapp -c \
  "select count(*) from movements m where m.\"categoryAccountId\" is null and m.type in ('expense','income') and exists (select 1 from ledger_entries le join accounts a on a.id = le.\"accountId\" where le.\"movementId\" = m.id and a.kind in ('EXPENSE','INCOME'));"
```

Expected: 0 — todo movimiento que tenía asiento categorizable quedó backfilleado.

Con el server arriba y un token válido:

```bash
TOKEN=... # accessToken de POST /auth/login
curl -s "localhost:8000/categories?kind=EXPENSE" -H "Authorization: Bearer $TOKEN"
curl -s "localhost:8000/reports/by-category?month=$(date +%Y-%m)&type=expense" -H "Authorization: Bearer $TOKEN"
```

Expected: el set sembrado en la primera; totales en ARS con `percent` sumando ~100 en la segunda.

- [ ] **Step 4: Verificación de app**

```bash
cd mobile && npx expo start --ios
```

Recorrido: cargar un gasto eligiendo categoría → crear una categoría desde el formulario y verla seleccionada → filtrar la lista de Movimientos por esa categoría → ver el bloque "En qué se te fue" en Inicio → Ajustes → Categorías: renombrar una y ver el error al intentar borrar una con movimientos.

- [ ] **Step 5: Commit**

```bash
git add README.md IMPLEMENTATION_PLAN.md
git commit -m "docs: document categories and the by-category report"
```
