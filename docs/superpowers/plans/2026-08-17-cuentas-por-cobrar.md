# Cuentas por cobrar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el freelancer pueda emitir una factura, ver quién le debe cuánto y desde cuándo, y registrar cobros parciales —incluso en otra moneda— con la diferencia de cambio resuelta sola.

**Architecture:** Dos tipos de movimiento nuevos, `invoice` y `collection`, con una cuenta de sistema "Deudores por ventas". La factura no toca ninguna billetera: acredita Deudores contra el rubro de ingreso, así `balance-by-wallet` no se mueve. El cobro debita la billetera, cancela el saldo en la moneda de la factura y manda el resto a "Diferencia de cambio". Para que un asiento así cierre, `LedgerEntry` gana `changeArs` y `assertBalanced` pasa a validar en ARS — hoy suma monedas distintas como si fueran comparables, que con un asiento multi-moneda se vuelve un bug silencioso. El estado de cada factura (pendiente / parcial / vencida / cobrada) se **deriva** del ledger, no se guarda.

**Tech Stack:** Node 22 · Express 5 · TypeScript · Prisma 7 + PostgreSQL · Vitest + supertest (Postgres real) · Expo (React Native) + expo-router + TanStack Query · StyleSheet nativo.

**Spec:** [docs/superpowers/specs/05-cuentas-por-cobrar.md](../specs/05-cuentas-por-cobrar.md)

**Rama:** `codex/f5-cuentas-por-cobrar`. Crear desde `main`. No reutilizar ramas de otras fases.

**Depende de:**
- **Fase 1** (cotización real) — sin ella los `changeArs` se calculan sobre cotizaciones inventadas. No bloquea.
- **Fase 2** (ABM) — `Client.phone` lo usa el recordatorio de WhatsApp. Si la fase 2 no está, la Task 1 agrega la columna.
- **Fase 3** (categorías) — el rubro de ingreso de la factura y la exclusión de las cuentas de sistema en `GET /categories`. La Task 2 lo cubre en los dos escenarios.
- **Fase 4** (Mercado Pago) — la pantalla `mobile/app/movement/[id].tsx` se reusa para el detalle de factura. Si la fase 4 no está, la Task 12 la crea.

## Global Constraints

- La factura **no** tiene billetera: `Movement.walletId` pasa a nullable y la validación por tipo vive en la ruta. `income`/`expense`/`transfer`/`collection` la exigen; `invoice` la prohíbe.
- Una factura nunca mueve `GET /reports/balance-by-wallet`: sus dos patas van a Deudores y a la cuenta de ingreso, ninguna es cuenta de billetera.
- **`assertBalanced` cambia de criterio**: suma 0 en ARS (`changeArs`) **siempre**, y suma 0 por moneda **salvo** que el asiento incluya la cuenta "Diferencia de cambio". Ese es el único asiento multi-moneda del sistema.
- `changeArs` es **NOT NULL** después del backfill: todo asiento nuevo lo escribe.
- Las cuentas de sistema son exactamente **"Deudores por ventas"** (`ASSET`, sin `currency`) y **"Diferencia de cambio"** (`INCOME`). No se listan nunca como categorías.
- El enum `MovementType` se amplía en una migración **aparte y anterior** a la que usa los valores nuevos: Postgres no deja usar un valor de enum recién agregado en la misma transacción, y Prisma corre cada migración en una.
- Un cobro nunca puede exceder el saldo pendiente: 400 `'El cobro supera el saldo pendiente'`.
- Borrar una factura con cobros → 400. Borrar un cobro revierte solo su propio asiento.
- El saldo aplicado de cada cobro se **deriva del ledger** (la pata sobre Deudores, en la moneda de la factura), no se guarda en una columna nueva.
- Montos redondeados a 2 decimales antes de construir cualquier `Prisma.Decimal`.
- Estilo del backend: `asyncHandler`, `AppError`, `paramId`, serializers de `backend/src/lib/serializers.ts`. Sin librerías nuevas.
- La app no tiene suite de tests: las tasks de mobile se verifican con `npx tsc --noEmit` más una pasada manual.
- **Commits en inglés**, formato `tipo: mensaje` (`feat:`, `fix:`, `test:`, `docs:`), como todo el historial del repo. `.cursor/rules/push-after-task.mdc` además pide commitear y pushear al terminar cada task, sin esperar que lo pidan.

---

### Task 1: Schema de cuentas por cobrar

**Files:**
- Modify: `backend/prisma/schema.prisma` (enum `MovementType`, models `Movement`, `LedgerEntry`, `Client`)
- Create: `backend/prisma/migrations/<timestamp>_add_receivable_movement_types/migration.sql`
- Create: `backend/prisma/migrations/<timestamp>_add_receivables/migration.sql`
- Create: `backend/tests/receivables.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `MovementType.invoice` / `.collection`, `Movement.walletId` nullable, `Movement.dueDate`, `Movement.invoiceId` con auto-relación `InvoiceCollections`, `LedgerEntry.changeArs` (NOT NULL, backfilleado), `Client.phone`. Los consumen todas las tasks siguientes.

- [ ] **Step 1: Levantar la DB y escribir el test que falla**

```bash
docker compose up -d db
```

Crear `backend/tests/receivables.test.ts`:

```ts
import 'dotenv/config'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/prisma/prisma'

const app = createApp()

function uniqueEmail() {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

/** Usuario registrado + onboarding + un cliente listo para facturar. */
export async function setupUser() {
  const registered = await request(app)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: 'password123' })
  const token = registered.body.accessToken as string

  await request(app)
    .post('/users/me/onboarding')
    .set(auth(token))
    .send({ templateId: 'freelancer_software' })

  const wallets = await request(app).get('/wallets').set(auth(token))
  const client = await request(app)
    .post('/clients')
    .set(auth(token))
    .send({ name: 'Estudio Contable' })

  return {
    token,
    wallets: wallets.body as { id: string; name: string; currency: string }[],
    client: client.body as { id: string; name: string },
  }
}

describe('schema de cobrables', () => {
  it('un movimiento sin billetera se puede guardar y todo asiento tiene changeArs', async () => {
    const { token, client, wallets } = await setupUser()
    const { resolveExchangeRateId } = await import('../src/services/exchangeRateService')
    const user = await prisma.user.findFirstOrThrow({
      where: { clients: { some: { id: client.id } } },
    })

    const movement = await prisma.movement.create({
      data: {
        userId: user.id,
        walletId: null,
        clientId: client.id,
        type: 'invoice',
        amount: 1000,
        currency: 'USD',
        exchangeRateId: await resolveExchangeRateId('USD', new Date(Date.UTC(2026, 7, 14))),
        description: 'Sprint 12',
        date: new Date(Date.UTC(2026, 7, 14)),
        dueDate: new Date(Date.UTC(2026, 8, 14)),
      },
    })

    expect(movement.walletId).toBeNull()
    expect(movement.dueDate?.toISOString()).toBe('2026-09-14T00:00:00.000Z')

    // Un movimiento normal deja asientos con changeArs poblado.
    const income = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: wallets[0].id, type: 'income', amount: 500, description: 'Cobro' })
    const entries = await prisma.ledgerEntry.findMany({
      where: { movementId: income.body.id },
    })
    expect(entries.every((e) => e.changeArs !== null)).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/receivables.test.ts`
Expected: FAIL — `'invoice'` no es un `MovementType` válido y `walletId` no acepta `null`.

- [ ] **Step 3: Migración del enum, sola**

En `backend/prisma/schema.prisma`:

```prisma
enum MovementType {
  income
  expense
  transfer
  invoice
  collection
}
```

```bash
cd backend && npx prisma migrate dev --create-only --name add_receivable_movement_types
```

Editar el SQL para que contenga **únicamente**:

```sql
ALTER TYPE "MovementType" ADD VALUE 'invoice';
ALTER TYPE "MovementType" ADD VALUE 'collection';
```

```bash
npx prisma migrate dev
```

- [ ] **Step 4: Segunda migración con las columnas**

En `model Movement`:

```prisma
  walletId       String?
  dueDate        DateTime?    @db.Date
  invoiceId      String?
```

```prisma
  wallet      Wallet?    @relation(fields: [walletId], references: [id])
  invoice     Movement?  @relation("InvoiceCollections", fields: [invoiceId], references: [id])
  collections Movement[] @relation("InvoiceCollections")
```

```prisma
  @@index([invoiceId])
```

En `model LedgerEntry`:

```prisma
  changeArs Decimal @db.Decimal(18, 2)
```

En `model Client`, si la fase 2 todavía no lo agregó:

```prisma
  phone String?
```

```bash
npx prisma migrate dev --create-only --name add_receivables
```

Al SQL generado hay que **corregirle el orden** de `changeArs`: Prisma la genera `NOT NULL` sin default y la migración falla si ya hay filas. Dejar el bloque así:

```sql
ALTER TABLE "ledger_entries" ADD COLUMN "changeArs" DECIMAL(18,2);

UPDATE "ledger_entries" le
SET "changeArs" = ROUND(le.change * er.value, 2)
FROM "movements" m
JOIN "exchange_rates" er ON er.id = m."exchangeRateId"
WHERE le."movementId" = m.id;

ALTER TABLE "ledger_entries" ALTER COLUMN "changeArs" SET NOT NULL;
```

El resto del SQL (walletId nullable, `dueDate`, `invoiceId`, FK e índice) queda como lo generó Prisma.

```bash
npx prisma migrate dev
npx prisma generate
```

- [ ] **Step 5: Correr el test y verificar el backfill**

Run: `cd backend && npx tsc --noEmit && npx vitest run tests/receivables.test.ts`
Expected: FAIL todavía en la parte de `changeArs` (el service aún no lo escribe) pero PASS en la creación de la factura. Es esperado: la Task 3 cierra la segunda mitad.

```bash
docker compose exec db psql -U monedapp_user -d monedapp -c \
  'select count(*) from ledger_entries where "changeArs" is null;'
```

Expected: 0.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/tests/receivables.test.ts
git commit -m "feat: add receivable movement types and ARS-valued ledger entries"
```

---

### Task 2: Cuentas de sistema

**Files:**
- Modify: `backend/src/services/onboardingService.ts`
- Modify: `backend/src/routes/categories.ts` (solo si la fase 3 está implementada)
- Test: `backend/tests/receivables.test.ts`

**Interfaces:**
- Consumes: `applyOnboarding` existente.
- Produces:
  - `RECEIVABLES_ACCOUNT_NAME = 'Deudores por ventas'`, `FX_DIFFERENCE_ACCOUNT_NAME = 'Diferencia de cambio'`
  - `ensureSystemAccounts(userId): Promise<{ receivablesAccountId: string; fxDifferenceAccountId: string }>` — idempotente por `@@unique([userId, name])`. Lo llaman `applyOnboarding` y la creación de la primera factura, para que los usuarios ya onboardeados no queden afuera.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/receivables.test.ts`:

```ts
describe('cuentas de sistema', () => {
  it('el onboarding las crea y llamarlas de nuevo no duplica', async () => {
    const { ensureSystemAccounts } = await import('../src/services/onboardingService')
    const { client } = await setupUser()
    const user = await prisma.user.findFirstOrThrow({
      where: { clients: { some: { id: client.id } } },
    })

    const first = await ensureSystemAccounts(user.id)
    const second = await ensureSystemAccounts(user.id)

    expect(second).toEqual(first)

    const accounts = await prisma.account.findMany({
      where: { userId: user.id, name: { in: ['Deudores por ventas', 'Diferencia de cambio'] } },
    })
    expect(accounts).toHaveLength(2)
    expect(accounts.find((a) => a.name === 'Deudores por ventas')?.kind).toBe('ASSET')
    expect(accounts.find((a) => a.name === 'Diferencia de cambio')?.kind).toBe('INCOME')
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/receivables.test.ts`
Expected: FAIL — `ensureSystemAccounts is not a function`.

- [ ] **Step 3: Implementar**

En `backend/src/services/onboardingService.ts`:

```ts
export const RECEIVABLES_ACCOUNT_NAME = 'Deudores por ventas'
export const FX_DIFFERENCE_ACCOUNT_NAME = 'Diferencia de cambio'

/** Idempotente: la corre el onboarding y también la primera factura de un usuario viejo. */
export async function ensureSystemAccounts(userId: string) {
  const receivables = await prisma.account.upsert({
    where: { userId_name: { userId, name: RECEIVABLES_ACCOUNT_NAME } },
    create: { userId, name: RECEIVABLES_ACCOUNT_NAME, kind: AccountKind.ASSET, currency: null },
    update: {},
  })

  const fxDifference = await prisma.account.upsert({
    where: { userId_name: { userId, name: FX_DIFFERENCE_ACCOUNT_NAME } },
    create: { userId, name: FX_DIFFERENCE_ACCOUNT_NAME, kind: AccountKind.INCOME, currency: null },
    update: {},
  })

  return { receivablesAccountId: receivables.id, fxDifferenceAccountId: fxDifference.id }
}
```

En `applyOnboarding`, después del `$transaction` y antes del `return`:

```ts
  await ensureSystemAccounts(userId)
```

- [ ] **Step 4: Excluirlas de las categorías**

Si la fase 3 está implementada, `backend/src/routes/categories.ts` ya tiene:

```ts
export const SYSTEM_CATEGORY_NAMES = ['Deudores por ventas', 'Diferencia de cambio']
```

Confirmar que los nombres coinciden **exactamente** con las constantes de arriba y, si difieren, importarlas desde `onboardingService` en vez de repetir los strings:

```ts
import { FX_DIFFERENCE_ACCOUNT_NAME, RECEIVABLES_ACCOUNT_NAME } from '../services/onboardingService'

export const SYSTEM_CATEGORY_NAMES = [RECEIVABLES_ACCOUNT_NAME, FX_DIFFERENCE_ACCOUNT_NAME]
```

Si la fase 3 **no** está, saltear este step: no hay `GET /categories` del que excluirlas todavía.

- [ ] **Step 5: Correr el test**

Run: `cd backend && npx vitest run tests/receivables.test.ts`
Expected: PASS en el caso de cuentas de sistema.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/onboardingService.ts backend/src/routes/categories.ts backend/tests/receivables.test.ts
git commit -m "feat: provision receivables and fx-difference system accounts"
```

---

### Task 3: `changeArs` en el ledger y balance en ARS

**Files:**
- Modify: `backend/src/services/ledgerService.ts`
- Test: `backend/tests/receivables.test.ts`

**Interfaces:**
- Consumes: `LedgerEntry.changeArs` (Task 1), `FX_DIFFERENCE_ACCOUNT_NAME` (Task 2).
- Produces:
  - `type LedgerEntryInput = { accountId: string; change: number; currency: Currency; changeArs: number }`
  - `assertBalanced(entries, opts?: { allowsMultiCurrency?: boolean })` — suma 0 en ARS siempre; suma 0 por moneda salvo asiento multi-moneda.
  - `createLedgerForMovement` sigue con la misma firma pública y ahora resuelve el valor de la cotización desde `exchangeRateId` para escribir `changeArs`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/receivables.test.ts`:

```ts
describe('changeArs en asientos normales', () => {
  it('un ingreso en USD deja changeArs = monto × cotización y suma 0 en ARS', async () => {
    const { token, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!

    const created = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ walletId: usd.id, type: 'income', amount: 100, description: 'Cobro USD' })

    expect(created.status).toBe(201)

    const entries = await prisma.ledgerEntry.findMany({ where: { movementId: created.body.id } })
    const rate = await prisma.exchangeRate.findUniqueOrThrow({
      where: { id: created.body.exchangeRateId },
    })

    expect(entries).toHaveLength(2)
    expect(entries.reduce((sum, e) => sum + Number(e.changeArs), 0)).toBe(0)
    const walletEntry = entries.find((e) => Number(e.change) > 0)!
    expect(Number(walletEntry.changeArs)).toBe(Math.round(100 * Number(rate.value) * 100) / 100)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/receivables.test.ts`
Expected: FAIL — el `createMany` no manda `changeArs` y Postgres rechaza el NOT NULL.

- [ ] **Step 3: Implementar**

Reescribir `backend/src/services/ledgerService.ts`:

```ts
import { Currency, MovementType, Prisma } from '@prisma/client'
import { AppError } from '../lib/errors'
import { getDefaultExpenseAccountId, getDefaultIncomeAccountId } from './onboardingService'

type Tx = Prisma.TransactionClient

export type LedgerEntryInput = {
  accountId: string
  change: number
  currency: Currency
  changeArs: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * El ARS es la única unidad comparable entre patas: sumar montos de monedas
 * distintas (como se hacía antes) es un bug silencioso en cuanto aparece un
 * asiento multi-moneda, que es exactamente lo que trae el cobro con diferencia
 * de cambio.
 */
export function assertBalanced(
  entries: LedgerEntryInput[],
  opts: { allowsMultiCurrency?: boolean } = {}
) {
  const totalArs = entries.reduce((sum, e) => sum + e.changeArs, 0)
  if (round2(totalArs) !== 0) {
    throw new AppError(500, 'Asiento desbalanceado')
  }

  if (opts.allowsMultiCurrency) return

  const byCurrency = new Map<Currency, number>()
  for (const entry of entries) {
    byCurrency.set(entry.currency, (byCurrency.get(entry.currency) ?? 0) + entry.change)
  }
  for (const total of byCurrency.values()) {
    if (round2(total) !== 0) {
      throw new AppError(500, 'Asiento desbalanceado')
    }
  }
}

export async function writeEntries(
  tx: Tx,
  movementId: string,
  entries: LedgerEntryInput[],
  opts: { allowsMultiCurrency?: boolean } = {}
) {
  assertBalanced(entries, opts)

  await tx.ledgerEntry.createMany({
    data: entries.map((e) => ({
      movementId,
      accountId: e.accountId,
      change: e.change,
      changeArs: e.changeArs,
      currency: e.currency,
    })),
  })
}

export async function createLedgerForMovement(
  tx: Tx,
  params: {
    userId: string
    movementId: string
    type: MovementType
    amount: Prisma.Decimal
    currency: Currency
    exchangeRateId: string
    walletAccountId: string
    toWalletAccountId?: string | null
    categoryAccountId?: string | null
  }
) {
  const amount = Number(params.amount)
  if (!(amount > 0)) {
    throw new AppError(400, 'El monto debe ser mayor a 0')
  }

  const rate = await tx.exchangeRate.findUniqueOrThrow({ where: { id: params.exchangeRateId } })
  const rateValue = Number(rate.value)
  const arsOf = (value: number) => round2(value * rateValue)

  const entries: LedgerEntryInput[] = []

  if (params.type === MovementType.income) {
    const incomeAccountId =
      params.categoryAccountId ?? (await getDefaultIncomeAccountId(tx, params.userId))
    entries.push(
      {
        accountId: params.walletAccountId,
        change: amount,
        currency: params.currency,
        changeArs: arsOf(amount),
      },
      {
        accountId: incomeAccountId,
        change: -amount,
        currency: params.currency,
        changeArs: -arsOf(amount),
      }
    )
  } else if (params.type === MovementType.expense) {
    const expenseAccountId =
      params.categoryAccountId ?? (await getDefaultExpenseAccountId(tx, params.userId))
    entries.push(
      {
        accountId: expenseAccountId,
        change: amount,
        currency: params.currency,
        changeArs: arsOf(amount),
      },
      {
        accountId: params.walletAccountId,
        change: -amount,
        currency: params.currency,
        changeArs: -arsOf(amount),
      }
    )
  } else if (params.type === MovementType.transfer) {
    if (!params.toWalletAccountId) {
      throw new AppError(400, 'Transferencia requiere billetera destino')
    }
    if (params.toWalletAccountId === params.walletAccountId) {
      throw new AppError(400, 'Las billeteras de origen y destino deben ser distintas')
    }
    entries.push(
      {
        accountId: params.toWalletAccountId,
        change: amount,
        currency: params.currency,
        changeArs: arsOf(amount),
      },
      {
        accountId: params.walletAccountId,
        change: -amount,
        currency: params.currency,
        changeArs: -arsOf(amount),
      }
    )
  }

  await writeEntries(tx, params.movementId, entries)
}
```

Si `createLedgerForMovement` todavía no recibía `exchangeRateId` (venía sin él en el core), agregarlo en los dos call sites: `backend/src/routes/movements.ts` (POST y, si la fase 3 está, el PATCH que regenera el asiento) y `backend/src/services/mercadopago/mpIngestionService.ts` si la fase 4 está. Los dos ya tienen la variable a mano.

- [ ] **Step 4: Correr toda la suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: PASS — los tests viejos siguen verdes porque las firmas públicas no cambiaron.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/ledgerService.ts backend/src/routes/movements.ts backend/tests/receivables.test.ts
git commit -m "feat: balance ledger entries in ARS with changeArs"
```

---

### Task 4: Emitir facturas

**Files:**
- Modify: `backend/src/services/ledgerService.ts` (asiento de `invoice`)
- Modify: `backend/src/routes/movements.ts` (`POST`)
- Test: `backend/tests/receivables.test.ts`

**Interfaces:**
- Consumes: `ensureSystemAccounts` (Task 2), `writeEntries` (Task 3).
- Produces:
  - `createInvoiceLedger(tx, { userId, movementId, amount, currency, exchangeRateId, categoryAccountId? })`
  - `POST /movements { type: 'invoice', clientId, amount, currency, dueDate, description, categoryId? }` → 201.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/receivables.test.ts`:

```ts
describe('POST /movements type invoice', () => {
  it('emite la factura sin tocar los saldos de billetera', async () => {
    const { token, client } = await setupUser()
    const before = await request(app).get('/reports/balance-by-wallet').set(auth(token))

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-09-14',
        description: 'Sprint 12',
      })

    expect(res.status).toBe(201)
    expect(res.body.walletId).toBeNull()
    expect(res.body.dueDate).toContain('2026-09-14')

    const after = await request(app).get('/reports/balance-by-wallet').set(auth(token))
    expect(after.body).toEqual(before.body)

    const entries = await prisma.ledgerEntry.findMany({ where: { movementId: res.body.id } })
    expect(entries).toHaveLength(2)
    expect(entries.reduce((sum, e) => sum + Number(e.changeArs), 0)).toBe(0)

    const accounts = await prisma.account.findMany({
      where: { id: { in: entries.map((e) => e.accountId) } },
    })
    expect(accounts.map((a) => a.name)).toContain('Deudores por ventas')
  })

  it('factura sin cliente → 400', async () => {
    const { token } = await setupUser()

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'invoice', amount: 1000, currency: 'USD', dueDate: '2026-09-14', description: 'X' })

    expect(res.status).toBe(400)
  })

  it('factura con walletId → 400', async () => {
    const { token, client, wallets } = await setupUser()

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        walletId: wallets[0].id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-09-14',
        description: 'X',
      })

    expect(res.status).toBe(400)
  })

  it('factura sin moneda → 400', async () => {
    const { token, client } = await setupUser()

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'invoice', clientId: client.id, amount: 1000, dueDate: '2026-09-14', description: 'X' })

    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/receivables.test.ts`
Expected: FAIL — el `POST` exige `walletId` para cualquier tipo.

- [ ] **Step 3: Escribir el asiento**

En `backend/src/services/ledgerService.ts`, agregar:

```ts
export async function createInvoiceLedger(
  tx: Tx,
  params: {
    userId: string
    movementId: string
    amount: Prisma.Decimal
    currency: Currency
    exchangeRateId: string
    categoryAccountId?: string | null
  }
) {
  const amount = Number(params.amount)
  if (!(amount > 0)) throw new AppError(400, 'El monto debe ser mayor a 0')

  const { receivablesAccountId } = await ensureSystemAccounts(params.userId)
  const incomeAccountId =
    params.categoryAccountId ?? (await getDefaultIncomeAccountId(tx, params.userId))

  const rate = await tx.exchangeRate.findUniqueOrThrow({ where: { id: params.exchangeRateId } })
  const ars = round2(amount * Number(rate.value))

  // La factura no toca ninguna billetera: por eso balance-by-wallet no se mueve.
  await writeEntries(tx, params.movementId, [
    { accountId: receivablesAccountId, change: amount, currency: params.currency, changeArs: ars },
    { accountId: incomeAccountId, change: -amount, currency: params.currency, changeArs: -ars },
  ])
}
```

y sumar `ensureSystemAccounts` al import de `./onboardingService`.

- [ ] **Step 4: Ramificar el `POST`**

En `backend/src/routes/movements.ts`, al principio del handler `POST /`, después de parsear `movementType`, desviar el tipo `invoice` a su propia función y dejar el camino existente intacto:

```ts
    if (movementType === MovementType.invoice) {
      await createInvoiceMovement(req, res, userId)
      return
    }
```

y arriba, junto a los otros helpers del archivo:

```ts
async function createInvoiceMovement(req: Request, res: Response, userId: string) {
  const { clientId, walletId, amount, currency, description, date, dueDate, categoryId } =
    req.body as Record<string, unknown>

  if (walletId !== undefined && walletId !== null) {
    throw new AppError(400, 'Una factura no lleva billetera')
  }
  if (typeof clientId !== 'string') throw new AppError(400, 'clientId es requerido en una factura')
  if (typeof description !== 'string' || description.trim() === '') {
    throw new AppError(400, 'description es requerida')
  }
  if (typeof currency !== 'string' || !(currency in Currency)) {
    throw new AppError(400, 'currency es requerida en una factura (ARS|USD|USDT)')
  }
  const amountNum = Number(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new AppError(400, 'amount debe ser un número mayor a 0')
  }

  const client = await prisma.client.findFirst({ where: { id: clientId, userId } })
  if (!client) throw new AppError(404, 'Cliente no encontrado')

  const movementDate = parseDate(date ?? new Date().toISOString())
  const due = dueDate === undefined || dueDate === null ? null : parseDate(dueDate)
  const categoryAccountId = await resolveCategoryAccountId(userId, MovementType.income, categoryId)
  const exchangeRateId = await resolveExchangeRateId(currency as Currency, movementDate)

  const movement = await prisma.$transaction(async (tx) => {
    const created = await tx.movement.create({
      data: {
        userId,
        walletId: null,
        clientId,
        type: MovementType.invoice,
        amount: new Prisma.Decimal(amountNum),
        currency: currency as Currency,
        exchangeRateId,
        description: description.trim(),
        date: movementDate,
        dueDate: due,
        categoryAccountId,
      },
    })

    await createInvoiceLedger(tx, {
      userId,
      movementId: created.id,
      amount: created.amount,
      currency: created.currency,
      exchangeRateId,
      categoryAccountId,
    })

    return tx.movement.findUniqueOrThrow({ where: { id: created.id }, include: movementInclude })
  })

  res.status(201).json(serializeMovement(movement))
}
```

Si la fase 3 no está implementada, `resolveCategoryAccountId` no existe: borrar esa línea y pasar `categoryAccountId: null`. Sumar los imports de `Request`/`Response` de express y de `createInvoiceLedger`.

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx tsc --noEmit && npx vitest run tests/receivables.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ledgerService.ts backend/src/routes/movements.ts backend/tests/receivables.test.ts
git commit -m "feat: issue invoices against the receivables account"
```

---

### Task 5: Registrar cobros

**Files:**
- Modify: `backend/src/services/ledgerService.ts` (asiento de `collection`)
- Modify: `backend/src/routes/movements.ts` (`POST`)
- Test: `backend/tests/receivables.test.ts`

**Interfaces:**
- Consumes: `ensureSystemAccounts` (Task 2), `writeEntries` (Task 3), `createInvoiceLedger` (Task 4).
- Produces:
  - `outstandingForInvoice(tx, invoice): Promise<number>` — saldo pendiente en la moneda de la factura, derivado de las patas sobre Deudores.
  - `createCollectionLedger(tx, { userId, movementId, invoice, walletAccountId, amount, currency, exchangeRateId })`
  - `POST /movements { type: 'collection', invoiceId, walletId, amount, date? }` → 201, 400 si excede el saldo.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/receivables.test.ts`:

```ts
describe('POST /movements type collection', () => {
  async function issueInvoice(token: string, clientId: string, amount = 1000, currency = 'USD') {
    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId,
        amount,
        currency,
        dueDate: '2026-09-14',
        description: 'Sprint 12',
      })
    return res.body as { id: string }
  }

  it('un cobro acredita la billetera y baja el saldo', async () => {
    const { token, client, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!
    const invoice = await issueInvoice(token, client.id, 1000, 'USD')

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.id, walletId: usd.id, amount: 400 })

    expect(res.status).toBe(201)

    const balances = await request(app).get('/reports/balance-by-wallet').set(auth(token))
    const usdBalance = (balances.body as { wallet: { id: string }; balance: string }[]).find(
      (b) => b.wallet.id === usd.id
    )!
    expect(Number(usdBalance.balance)).toBe(400)

    const entries = await prisma.ledgerEntry.findMany({ where: { movementId: res.body.id } })
    expect(entries.reduce((sum, e) => sum + Number(e.changeArs), 0)).toBe(0)
  })

  it('un cobro que excede el saldo → 400', async () => {
    const { token, client, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!
    const invoice = await issueInvoice(token, client.id, 1000, 'USD')

    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.id, walletId: usd.id, amount: 1500 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('El cobro supera el saldo pendiente')
  })

  it('factura USD cobrada en ARS deja una pata en Diferencia de cambio y suma 0 en ARS', async () => {
    const { token, client, wallets } = await setupUser()
    const ars = wallets.find((w) => w.currency === 'ARS')!
    const invoice = await issueInvoice(token, client.id, 1000, 'USD')
    const invoiceRow = await prisma.movement.findUniqueOrThrow({ where: { id: invoice.id } })
    const invoiceRate = await prisma.exchangeRate.findUniqueOrThrow({
      where: { id: invoiceRow.exchangeRateId },
    })

    // Cobrar en ARS un poco menos de lo facturado: la diferencia es pérdida de cambio.
    const cobrado = Math.round(Number(invoiceRate.value) * 1000 * 0.95)
    const res = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.id, walletId: ars.id, amount: cobrado })

    expect(res.status).toBe(201)

    const entries = await prisma.ledgerEntry.findMany({ where: { movementId: res.body.id } })
    expect(entries).toHaveLength(3)
    expect(entries.reduce((sum, e) => sum + Number(e.changeArs), 0)).toBe(0)

    const accounts = await prisma.account.findMany({
      where: { id: { in: entries.map((e) => e.accountId) } },
    })
    expect(accounts.map((a) => a.name)).toContain('Diferencia de cambio')
  })

  it('cobro sin billetera o sin factura → 400', async () => {
    const { token, client, wallets } = await setupUser()
    const invoice = await issueInvoice(token, client.id)

    const sinWallet = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.id, amount: 100 })
    const sinInvoice = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', walletId: wallets[0].id, amount: 100 })

    expect(sinWallet.status).toBe(400)
    expect(sinInvoice.status).toBe(400)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/receivables.test.ts`
Expected: FAIL — `collection` cae en el camino genérico y no arma el asiento de tres patas.

- [ ] **Step 3: Escribir el asiento**

En `backend/src/services/ledgerService.ts`:

```ts
/**
 * El saldo pendiente sale del ledger, no de una columna: cada cobro deja una pata
 * negativa sobre Deudores en la moneda de la factura.
 */
export async function outstandingForInvoice(
  tx: Tx,
  invoice: { id: string; userId: string; amount: Prisma.Decimal }
): Promise<number> {
  const { receivablesAccountId } = await ensureSystemAccounts(invoice.userId)

  const applied = await tx.ledgerEntry.aggregate({
    where: {
      accountId: receivablesAccountId,
      movement: { invoiceId: invoice.id },
    },
    _sum: { change: true },
  })

  return round2(Number(invoice.amount) + Number(applied._sum.change ?? 0))
}

export async function createCollectionLedger(
  tx: Tx,
  params: {
    userId: string
    movementId: string
    invoice: { id: string; userId: string; amount: Prisma.Decimal; currency: Currency; exchangeRateId: string }
    walletAccountId: string
    amount: Prisma.Decimal
    currency: Currency
    exchangeRateId: string
  }
) {
  const collected = Number(params.amount)
  if (!(collected > 0)) throw new AppError(400, 'El monto debe ser mayor a 0')

  const { receivablesAccountId, fxDifferenceAccountId } = await ensureSystemAccounts(params.userId)

  const collectionRate = await tx.exchangeRate.findUniqueOrThrow({
    where: { id: params.exchangeRateId },
  })
  const invoiceRate = await tx.exchangeRate.findUniqueOrThrow({
    where: { id: params.invoice.exchangeRateId },
  })

  const collectedArs = round2(collected * Number(collectionRate.value))
  // Cuánto de la deuda cancela, en la moneda de la factura, usando ambos snapshots.
  const appliedRaw =
    params.currency === params.invoice.currency
      ? collected
      : collectedArs / Number(invoiceRate.value)

  const outstanding = await outstandingForInvoice(tx, params.invoice)
  const applied = round2(Math.min(appliedRaw, outstanding))

  if (round2(appliedRaw) > round2(outstanding + 0.01)) {
    throw new AppError(400, 'El cobro supera el saldo pendiente')
  }

  const appliedArs = round2(applied * Number(invoiceRate.value))
  const fxDifference = round2(appliedArs - collectedArs)

  const entries: LedgerEntryInput[] = [
    {
      accountId: params.walletAccountId,
      change: collected,
      currency: params.currency,
      changeArs: collectedArs,
    },
    {
      accountId: receivablesAccountId,
      change: -applied,
      currency: params.invoice.currency,
      changeArs: -appliedArs,
    },
  ]

  if (fxDifference !== 0) {
    entries.push({
      accountId: fxDifferenceAccountId,
      change: fxDifference,
      currency: Currency.ARS,
      changeArs: fxDifference,
    })
  }

  // Único asiento del sistema con patas en monedas distintas: balancea solo en ARS.
  await writeEntries(tx, params.movementId, entries, {
    allowsMultiCurrency: params.currency !== params.invoice.currency,
  })
}
```

- [ ] **Step 4: Ramificar el `POST`**

En `backend/src/routes/movements.ts`, junto al desvío de `invoice`:

```ts
    if (movementType === MovementType.collection) {
      await createCollectionMovement(req, res, userId)
      return
    }
```

y el handler:

```ts
async function createCollectionMovement(req: Request, res: Response, userId: string) {
  const { invoiceId, walletId, amount, description, date } = req.body as Record<string, unknown>

  if (typeof invoiceId !== 'string') throw new AppError(400, 'invoiceId es requerido en un cobro')
  if (typeof walletId !== 'string') throw new AppError(400, 'walletId es requerido en un cobro')
  const amountNum = Number(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new AppError(400, 'amount debe ser un número mayor a 0')
  }

  const invoice = await prisma.movement.findFirst({
    where: { id: invoiceId, userId, type: MovementType.invoice },
  })
  if (!invoice) throw new AppError(404, 'Factura no encontrada')

  const wallet = await prisma.wallet.findFirst({ where: { id: walletId, userId } })
  if (!wallet) throw new AppError(404, 'Billetera no encontrada')

  const movementDate = parseDate(date ?? new Date().toISOString())
  const exchangeRateId = await resolveExchangeRateId(wallet.currency, movementDate)

  const movement = await prisma.$transaction(async (tx) => {
    const created = await tx.movement.create({
      data: {
        userId,
        walletId: wallet.id,
        clientId: invoice.clientId,
        invoiceId: invoice.id,
        type: MovementType.collection,
        amount: new Prisma.Decimal(amountNum),
        currency: wallet.currency,
        exchangeRateId,
        description:
          typeof description === 'string' && description.trim() !== ''
            ? description.trim()
            : `Cobro ${invoice.description}`,
        date: movementDate,
      },
    })

    await createCollectionLedger(tx, {
      userId,
      movementId: created.id,
      invoice,
      walletAccountId: wallet.accountId,
      amount: created.amount,
      currency: created.currency,
      exchangeRateId,
    })

    return tx.movement.findUniqueOrThrow({ where: { id: created.id }, include: movementInclude })
  })

  res.status(201).json(serializeMovement(movement))
}
```

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx tsc --noEmit && npx vitest run tests/receivables.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ledgerService.ts backend/src/routes/movements.ts backend/tests/receivables.test.ts
git commit -m "feat: register collections with automatic fx difference"
```

---

### Task 6: Borrado protegido de facturas

**Files:**
- Modify: `backend/src/routes/movements.ts` (`DELETE /:id`)
- Test: `backend/tests/receivables.test.ts`

**Interfaces:**
- Consumes: la auto-relación `InvoiceCollections` (Task 1).
- Produces: `DELETE /movements/:id` de una factura con cobros → 400; sin cobros o de un cobro → 204.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/receivables.test.ts`:

```ts
describe('DELETE /movements/:id de facturas', () => {
  it('con cobros → 400; borrar el cobro primero la libera', async () => {
    const { token, client, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!
    const invoice = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-09-14',
        description: 'Sprint 12',
      })
    const collection = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.body.id, walletId: usd.id, amount: 400 })

    const blocked = await request(app)
      .delete(`/movements/${invoice.body.id}`)
      .set(auth(token))
    expect(blocked.status).toBe(400)
    expect(blocked.body.error).toBe('No se puede borrar una factura con cobros')

    expect((await request(app).delete(`/movements/${collection.body.id}`).set(auth(token))).status).toBe(204)
    expect((await request(app).delete(`/movements/${invoice.body.id}`).set(auth(token))).status).toBe(204)
  })

  it('factura de otro usuario → 404', async () => {
    const owner = await setupUser()
    const intruder = await setupUser()
    const invoice = await request(app)
      .post('/movements')
      .set(auth(owner.token))
      .send({
        type: 'invoice',
        clientId: owner.client.id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-09-14',
        description: 'Sprint 12',
      })

    const res = await request(app)
      .delete(`/movements/${invoice.body.id}`)
      .set(auth(intruder.token))

    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/receivables.test.ts`
Expected: FAIL — el `DELETE` borra la factura y sus cobros quedan huérfanos (o revienta por FK).

- [ ] **Step 3: Implementar**

En `backend/src/routes/movements.ts`, en el handler `DELETE /:id`, después de validar `existing`:

```ts
    if (existing.type === MovementType.invoice) {
      const collectionCount = await prisma.movement.count({ where: { invoiceId: existing.id } })
      if (collectionCount > 0) {
        throw new AppError(400, 'No se puede borrar una factura con cobros')
      }
    }
```

Borrar un cobro no necesita nada nuevo: sus `LedgerEntry` cascadean y el saldo de la factura, que se deriva del ledger, vuelve solo.

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx vitest run tests/receivables.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/movements.ts backend/tests/receivables.test.ts
git commit -m "fix: block deleting invoices that already have collections"
```

---

### Task 7: `GET /receivables`

**Files:**
- Create: `backend/src/services/receivablesService.ts`
- Create: `backend/src/routes/receivables.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/receivables.test.ts`

**Interfaces:**
- Consumes: `outstandingForInvoice` (Task 5).
- Produces:
  - `type ReceivableStatus = 'pending' | 'partial' | 'overdue' | 'paid'`
  - `listReceivables(userId, filters: { status?: ReceivableStatus; clientId?: string }): Promise<Receivable[]>` con `{ id, client, amount, currency, collected, outstanding, status, dueDate, daysOverdue, collections }`
  - `GET /receivables?status=&clientId=`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/receivables.test.ts`:

```ts
describe('GET /receivables', () => {
  it('refleja pendiente, parcial y cobrada', async () => {
    const { token, client, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!
    const invoice = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2099-01-01',
        description: 'Sprint 12',
      })

    const pending = await request(app).get('/receivables').set(auth(token))
    expect(pending.status).toBe(200)
    expect(pending.body[0]).toMatchObject({
      id: invoice.body.id,
      outstanding: 1000,
      collected: 0,
      status: 'pending',
    })
    expect(pending.body[0].client.name).toBe('Estudio Contable')

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.body.id, walletId: usd.id, amount: 400 })

    const partial = await request(app).get('/receivables').set(auth(token))
    expect(partial.body[0]).toMatchObject({ outstanding: 600, collected: 400, status: 'partial' })
    expect(partial.body[0].collections).toHaveLength(1)

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.body.id, walletId: usd.id, amount: 600 })

    const paid = await request(app).get('/receivables').set(auth(token))
    expect(paid.body[0]).toMatchObject({ outstanding: 0, status: 'paid' })
  })

  it('una factura vencida e impaga trae daysOverdue > 0', async () => {
    const { token, client } = await setupUser()
    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 500,
        currency: 'ARS',
        date: '2026-01-10',
        dueDate: '2026-02-10',
        description: 'Vieja',
      })

    const res = await request(app).get('/receivables?status=overdue').set(auth(token))

    expect(res.body).toHaveLength(1)
    expect(res.body[0].status).toBe('overdue')
    expect(res.body[0].daysOverdue).toBeGreaterThan(0)
  })

  it('filtra por cliente', async () => {
    const { token, client } = await setupUser()
    const otro = await request(app).post('/clients').set(auth(token)).send({ name: 'Otro' })
    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 100,
        currency: 'ARS',
        dueDate: '2099-01-01',
        description: 'A',
      })

    const res = await request(app).get(`/receivables?clientId=${otro.body.id}`).set(auth(token))

    expect(res.body).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/receivables.test.ts`
Expected: FAIL — 404, la ruta no existe.

- [ ] **Step 3: Escribir el service**

Crear `backend/src/services/receivablesService.ts`:

```ts
import { MovementType, Prisma } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { ensureSystemAccounts } from './onboardingService'

export type ReceivableStatus = 'pending' | 'partial' | 'overdue' | 'paid'

const DAY_MS = 24 * 60 * 60 * 1000

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function deriveStatus(params: {
  amount: number
  outstanding: number
  dueDate: Date | null
}): ReceivableStatus {
  if (params.outstanding <= 0.01) return 'paid'
  if (params.dueDate && params.dueDate.getTime() < startOfToday().getTime()) return 'overdue'
  return params.outstanding < params.amount ? 'partial' : 'pending'
}

export async function listReceivables(
  userId: string,
  filters: { status?: string; clientId?: string } = {}
) {
  const { receivablesAccountId } = await ensureSystemAccounts(userId)

  const where: Prisma.MovementWhereInput = { userId, type: MovementType.invoice }
  if (filters.clientId) where.clientId = filters.clientId

  const invoices = await prisma.movement.findMany({
    where,
    include: {
      client: { select: { id: true, name: true, phone: true } },
      collections: {
        select: { id: true, amount: true, currency: true, date: true, walletId: true },
        orderBy: { date: 'asc' },
      },
    },
    orderBy: [{ dueDate: 'asc' }, { date: 'asc' }],
  })

  // Una sola consulta al ledger para todas las facturas: la pata sobre Deudores
  // de cada cobro dice cuánto canceló, en la moneda de la factura.
  const applied = await prisma.ledgerEntry.groupBy({
    by: ['movementId'],
    where: {
      accountId: receivablesAccountId,
      movement: { invoiceId: { in: invoices.map((i) => i.id) } },
    },
    _sum: { change: true },
  })

  const appliedByCollection = new Map(
    applied.map((row) => [row.movementId, Number(row._sum.change ?? 0)])
  )

  const today = startOfToday()

  const rows = invoices.map((invoice) => {
    const amount = round2(Number(invoice.amount))
    const collected = round2(
      -invoice.collections.reduce(
        (sum, c) => sum + (appliedByCollection.get(c.id) ?? 0),
        0
      )
    )
    const outstanding = round2(amount - collected)
    const status = deriveStatus({ amount, outstanding, dueDate: invoice.dueDate })
    const daysOverdue =
      status === 'overdue' && invoice.dueDate
        ? Math.floor((today.getTime() - invoice.dueDate.getTime()) / DAY_MS)
        : 0

    return {
      id: invoice.id,
      description: invoice.description,
      client: invoice.client,
      amount,
      currency: invoice.currency,
      date: invoice.date,
      dueDate: invoice.dueDate,
      collected,
      outstanding,
      status,
      daysOverdue,
      collections: invoice.collections,
    }
  })

  return filters.status ? rows.filter((row) => row.status === filters.status) : rows
}
```

- [ ] **Step 4: Escribir la ruta**

Crear `backend/src/routes/receivables.ts`:

```ts
import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { listReceivables } from '../services/receivablesService'

const router = Router()
router.use(requireAuth)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { status, clientId } = req.query

    res.json(
      await listReceivables(userId, {
        status: typeof status === 'string' ? status : undefined,
        clientId: typeof clientId === 'string' ? clientId : undefined,
      })
    )
  })
)

export default router
```

En `backend/src/app.ts`:

```ts
  app.use('/receivables', receivablesRouter)
```

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx tsc --noEmit && npx vitest run tests/receivables.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/receivablesService.ts backend/src/routes/receivables.ts backend/src/app.ts backend/tests/receivables.test.ts
git commit -m "feat: list receivables with derived status and aging"
```

---

### Task 8: `GET /receivables/summary`

**Files:**
- Modify: `backend/src/services/receivablesService.ts`
- Modify: `backend/src/routes/receivables.ts`
- Test: `backend/tests/receivables.test.ts`

**Interfaces:**
- Consumes: `listReceivables` (Task 7).
- Produces: `receivablesSummary(userId): Promise<{ byCurrency: Record<string, number>; totalArs: number; overdueArs: number; aging: { '0-30': number; '31-60': number; '61+': number } }>` y `GET /receivables/summary`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/receivables.test.ts`:

```ts
describe('GET /receivables/summary', () => {
  it('agrupa por moneda y por antigüedad', async () => {
    const { token, client } = await setupUser()

    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 500,
        currency: 'ARS',
        dueDate: '2099-01-01',
        description: 'Al día',
      })
    await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 100,
        currency: 'USD',
        date: '2026-01-10',
        dueDate: '2026-02-10',
        description: 'Vencida hace mucho',
      })

    const res = await request(app).get('/receivables/summary').set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.byCurrency.ARS).toBe(500)
    expect(res.body.byCurrency.USD).toBe(100)
    expect(res.body.totalArs).toBeGreaterThan(500)
    expect(res.body.overdueArs).toBeGreaterThan(0)
    expect(res.body.aging['61+']).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/receivables.test.ts`
Expected: FAIL — 404 (o cae en `GET /` con `status=summary`, según el orden de las rutas).

- [ ] **Step 3: Implementar**

En `backend/src/services/receivablesService.ts`:

```ts
export async function receivablesSummary(userId: string) {
  const rows = await listReceivables(userId)
  const pending = rows.filter((row) => row.status !== 'paid')

  const invoiceIds = pending.map((row) => row.id)
  const rates = await prisma.movement.findMany({
    where: { id: { in: invoiceIds } },
    select: { id: true, exchangeRate: { select: { value: true } } },
  })
  const rateById = new Map(rates.map((r) => [r.id, Number(r.exchangeRate.value)]))

  const byCurrency: Record<string, number> = {}
  const aging = { '0-30': 0, '31-60': 0, '61+': 0 }
  let totalArs = 0
  let overdueArs = 0

  for (const row of pending) {
    byCurrency[row.currency] = round2((byCurrency[row.currency] ?? 0) + row.outstanding)

    // Se usa el snapshot de la factura: es la cotización a la que se devengó.
    const ars = round2(row.outstanding * (rateById.get(row.id) ?? 1))
    totalArs = round2(totalArs + ars)

    if (row.status === 'overdue') {
      overdueArs = round2(overdueArs + ars)
      const bucket = row.daysOverdue <= 30 ? '0-30' : row.daysOverdue <= 60 ? '31-60' : '61+'
      aging[bucket] = round2(aging[bucket] + ars)
    }
  }

  return { byCurrency, totalArs, overdueArs, aging }
}
```

En `backend/src/routes/receivables.ts`, **antes** del `GET /` para que Express no lo tome como filtro:

```ts
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    res.json(await receivablesSummary(userId))
  })
)
```

- [ ] **Step 4: Correr toda la suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/receivablesService.ts backend/src/routes/receivables.ts backend/tests/receivables.test.ts
git commit -m "feat: add receivables summary with aging buckets"
```

---

### Task 9: `dueDate` e `invoiceId` en la serialización

**Files:**
- Modify: `backend/src/lib/serializers.ts`
- Modify: `backend/src/routes/movements.ts` (`movementInclude`)
- Test: `backend/tests/receivables.test.ts`

**Interfaces:**
- Consumes: los campos de la Task 1.
- Produces: `serializeMovement` con `dueDate`, `invoiceId` y `walletId` nullable. Lo consumen las pantallas de la app.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/receivables.test.ts`:

```ts
describe('serializeMovement con cobrables', () => {
  it('la factura y el cobro exponen dueDate e invoiceId', async () => {
    const { token, client, wallets } = await setupUser()
    const usd = wallets.find((w) => w.currency === 'USD')!
    const invoice = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({
        type: 'invoice',
        clientId: client.id,
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-09-14',
        description: 'Sprint 12',
      })
    const collection = await request(app)
      .post('/movements')
      .set(auth(token))
      .send({ type: 'collection', invoiceId: invoice.body.id, walletId: usd.id, amount: 400 })

    expect(invoice.body.dueDate).toContain('2026-09-14')
    expect(invoice.body.invoiceId).toBeNull()
    expect(collection.body.invoiceId).toBe(invoice.body.id)

    const list = await request(app).get('/movements?type=invoice').set(auth(token))
    expect(list.body[0].dueDate).toContain('2026-09-14')
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/receivables.test.ts`
Expected: FAIL — `dueDate` es `undefined`.

- [ ] **Step 3: Implementar**

En `backend/src/lib/serializers.ts`, en el objeto que devuelve `serializeMovement`, junto a `date`:

```ts
    dueDate: movement.dueDate,
    invoiceId: movement.invoiceId,
```

`walletId` ya se emite; ahora puede venir `null` y el tipo lo refleja solo (viene de `Movement`).

- [ ] **Step 4: Correr toda la suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/serializers.ts backend/tests/receivables.test.ts
git commit -m "feat: expose dueDate and invoiceId on serialized movements"
```

---

### Task 10: Emitir factura desde la app

**Files:**
- Modify: `mobile/src/api/types.ts`
- Modify: `mobile/app/(tabs)/new-movement.tsx`

**Interfaces:**
- Consumes: `POST /movements` con `type: 'invoice'` (Task 4).
- Produces: `Receivable`, `ReceivablesSummary` en types; `Movement` con `dueDate`, `invoiceId` y `walletId` nullable; cuarto chip "Factura" en el formulario.

- [ ] **Step 1: Agregar los tipos**

En `mobile/src/api/types.ts`, en `Movement`:

```ts
  type: 'income' | 'expense' | 'transfer' | 'invoice' | 'collection'
  walletId: string | null
  dueDate?: string | null
  invoiceId?: string | null
```

y los tipos nuevos:

```ts
export type ReceivableStatus = 'pending' | 'partial' | 'overdue' | 'paid'

export type Receivable = {
  id: string
  description: string
  client: { id: string; name: string; phone: string | null } | null
  amount: number
  currency: string
  date: string
  dueDate: string | null
  collected: number
  outstanding: number
  status: ReceivableStatus
  daysOverdue: number
  collections: { id: string; amount: string | number; currency: string; date: string }[]
}

export type ReceivablesSummary = {
  byCurrency: Record<string, number>
  totalArs: number
  overdueArs: number
  aging: { '0-30': number; '31-60': number; '61+': number }
}
```

- [ ] **Step 2: Sumar el chip "Factura"**

En `mobile/app/(tabs)/new-movement.tsx`, ampliar el tipo local y la fila de chips:

```tsx
type MovementType = 'income' | 'expense' | 'transfer' | 'invoice'
```

```tsx
        {(['income', 'expense', 'transfer', 'invoice'] as MovementType[]).map((t) => (
```

```tsx
              {t === 'income'
                ? 'Ingreso'
                : t === 'expense'
                  ? 'Gasto'
                  : t === 'transfer'
                    ? 'Transferencia'
                    : 'Factura'}
```

- [ ] **Step 3: Adaptar el formulario al tipo factura**

Agregar estado:

```tsx
  const [invoiceCurrency, setInvoiceCurrency] = useState('ARS')
  const [dueDate, setDueDate] = useState('')
```

La factura no lleva billetera sino moneda, así que el bloque de billetera se condiciona y aparece uno nuevo:

```tsx
      {type === 'invoice' ? (
        <>
          <Text style={styles.label}>Moneda</Text>
          <View style={styles.rowWrap}>
            {['ARS', 'USD', 'USDT'].map((c) => (
              <Pressable
                key={c}
                style={[styles.chip, invoiceCurrency === c && styles.chipActive]}
                onPress={() => setInvoiceCurrency(c)}
              >
                <Text
                  style={[styles.chipText, invoiceCurrency === c && styles.chipTextActive]}
                >
                  {c}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Vence el</Text>
          <TextInput
            style={styles.input}
            placeholder="2026-09-14"
            placeholderTextColor={colors.muted}
            value={dueDate}
            onChangeText={setDueDate}
          />
        </>
      ) : null}
```

y el bloque de billetera pasa a renderizarse solo cuando `type !== 'invoice'`. El selector de cliente, que hoy aparece solo en `income`, ahora también en `invoice`: cambiar esa condición a `type === 'income' || type === 'invoice'`.

- [ ] **Step 4: Mandar el body correcto y validar**

En la mutación `create`, el body pasa a depender del tipo:

```ts
      body:
        type === 'invoice'
          ? {
              type: 'invoice',
              clientId,
              amount: Number(amount),
              currency: invoiceCurrency,
              dueDate,
              description,
              date: new Date().toISOString().slice(0, 10),
            }
          : {
              walletId: selectedWalletId,
              toWalletId: type === 'transfer' ? toWalletId : undefined,
              clientId: type === 'income' && clientId ? clientId : undefined,
              type,
              amount: Number(amount),
              description,
              date: new Date().toISOString().slice(0, 10),
            },
```

En `submit()`, antes de mutar:

```ts
    if (type === 'invoice') {
      if (!clientId) {
        setError('Elegí un cliente para la factura')
        return
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        setError('Escribí el vencimiento como 2026-09-14')
        return
      }
    } else if (!selectedWalletId) {
      setError('Elegí una billetera')
      return
    }
```

reemplazando el chequeo de billetera que hoy corre siempre.

En `onSuccess`, invalidar también las cobrables:

```ts
      await queryClient.invalidateQueries({ queryKey: ['receivables'] })
```

- [ ] **Step 5: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. En el simulador: el chip "Factura" pide cliente, moneda y vencimiento; guardar devuelve 201 y los saldos de billetera no se mueven.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/api/types.ts mobile/app/\(tabs\)/new-movement.tsx
git commit -m "feat(mobile): issue invoices from the new movement form"
```

---

### Task 11: Pantalla "Te deben"

**Files:**
- Create: `mobile/app/receivables.tsx`
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `GET /receivables?status=` (Task 7) y `GET /receivables/summary` (Task 8).
- Produces: ruta `/receivables` con filtros por estado, y la tarjeta "Te deben" en Inicio, arriba de "Tus billeteras".

- [ ] **Step 1: Registrar la ruta**

En `mobile/app/_layout.tsx`, dentro del `<Stack>`:

```tsx
            <Stack.Screen
              name="receivables"
              options={{
                headerShown: true,
                title: 'Te deben',
                headerStyle: { backgroundColor: colors.bg },
                headerShadowVisible: false,
              }}
            />
```

- [ ] **Step 2: Escribir la pantalla**

Crear `mobile/app/receivables.tsx`:

```tsx
import { apiRequest } from '@/src/api/client'
import type { Receivable, ReceivableStatus } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
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

type Filter = 'all' | ReceivableStatus

const statusLabel: Record<ReceivableStatus, string> = {
  pending: 'Pendiente',
  partial: 'Cobro parcial',
  overdue: 'Vencida',
  paid: 'Cobrada',
}

export default function ReceivablesScreen() {
  const { accessToken } = useAuth()
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')

  const receivables = useQuery({
    queryKey: ['receivables', filter],
    queryFn: () =>
      apiRequest<Receivable[]>(`/receivables${filter === 'all' ? '' : `?status=${filter}`}`, {
        token: accessToken,
      }),
    enabled: !!accessToken,
  })

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        {(
          [
            { id: 'all' as const, label: 'Todas' },
            { id: 'pending' as const, label: 'Pendientes' },
            { id: 'overdue' as const, label: 'Vencidas' },
            { id: 'paid' as const, label: 'Cobradas' },
          ] as const
        ).map((opt) => (
          <Pressable
            key={opt.id}
            style={[styles.chip, filter === opt.id && styles.chipActive]}
            onPress={() => setFilter(opt.id)}
          >
            <Text style={[styles.chipText, filter === opt.id && styles.chipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {receivables.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={receivables.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={receivables.isFetching}
              onRefresh={() => receivables.refetch()}
            />
          }
          ListEmptyComponent={<Text style={styles.empty}>No hay facturas para mostrar.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/movement/${item.id}`)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.client?.name ?? 'Sin cliente'}</Text>
                <Text style={styles.meta}>
                  {item.description} · {statusLabel[item.status]}
                </Text>
                {item.status === 'overdue' ? (
                  <Text style={styles.overdue}>{item.daysOverdue} días de atraso</Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.amount}>
                  {formatAmount(item.outstanding, item.currency)}
                </Text>
                <Text style={styles.meta}>de {formatAmount(item.amount, item.currency)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16, paddingBottom: 4 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.ink, fontSize: 13 },
  chipTextActive: { color: colors.accent, fontWeight: '600' },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  overdue: { fontSize: 13, color: colors.danger, marginTop: 4, fontWeight: '600' },
  amount: { fontSize: 15, fontWeight: '700', color: colors.ink },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
})
```

- [ ] **Step 3: Tarjeta "Te deben" en Inicio**

En `mobile/app/(tabs)/index.tsx`, sumar la query y la tarjeta arriba del bloque "Tus billeteras":

```tsx
  const receivables = useQuery({
    queryKey: ['receivables-summary'],
    queryFn: () =>
      apiRequest<ReceivablesSummary>('/receivables/summary', { token: accessToken }),
    enabled: !!accessToken,
  })
```

```tsx
          {receivables.data && receivables.data.totalArs > 0 ? (
            <Pressable style={styles.owedCard} onPress={() => router.push('/receivables')}>
              <Text style={styles.sectionLabelInline}>Te deben</Text>
              <Text style={styles.owedTotal}>{formatAmount(receivables.data.totalArs, 'ARS')}</Text>
              {receivables.data.overdueArs > 0 ? (
                <Text style={styles.owedOverdue}>
                  {formatAmount(receivables.data.overdueArs, 'ARS')} vencido
                </Text>
              ) : null}
            </Pressable>
          ) : null}
```

con los estilos:

```ts
  owedCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 24,
    gap: 6,
  },
  owedTotal: { fontSize: 24, fontWeight: '700', color: colors.ink },
  owedOverdue: { color: colors.danger, fontWeight: '600' },
```

y sumar `receivables.refetch()` a `onRefresh`.

- [ ] **Step 4: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. Inicio muestra "Te deben" con el total y el vencido en rojo; tocarla abre la lista, que filtra por estado.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/receivables.tsx mobile/app/_layout.tsx mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): add receivables screen and home summary card"
```

---

### Task 12: Registrar cobro desde el detalle

**Files:**
- Modify: `mobile/app/movement/[id].tsx` (o crearlo si la fase 4 no está)
- Modify: `mobile/app/_layout.tsx` (solo si hay que crear la ruta)

**Interfaces:**
- Consumes: `GET /movements/:id`, `GET /receivables` (para el saldo), `POST /movements` con `type: 'collection'` (Task 5).
- Produces: bloque de cobros en el detalle de una factura, con el monto precargado en el saldo pendiente.

**Reuso:** el spec de Mercado Pago ya define `mobile/app/movement/[id].tsx` para editar y confirmar movimientos importados. Se le agrega el bloque de factura, **no** se escribe una segunda pantalla de detalle. Si la fase 4 no está implementada, crear el archivo con lo mínimo (query del movimiento + este bloque) y registrar la ruta `movement/[id]` en el `Stack` raíz como en la Task 11.

- [ ] **Step 1: Traer el estado de la factura**

En `mobile/app/movement/[id].tsx`, junto a la query del movimiento:

```tsx
  const receivable = useQuery({
    queryKey: ['receivables', 'detail', id],
    queryFn: async () => {
      const rows = await apiRequest<Receivable[]>('/receivables', { token: accessToken })
      return rows.find((row) => row.id === id) ?? null
    },
    enabled: !!accessToken && movement.data?.type === 'invoice',
  })
```

- [ ] **Step 2: Agregar el formulario de cobro**

```tsx
  const [collectWalletId, setCollectWalletId] = useState<string | null>(null)
  const [collectAmount, setCollectAmount] = useState('')

  const wallets = useQuery({
    queryKey: ['wallets'],
    queryFn: () => apiRequest<Wallet[]>('/wallets', { token: accessToken }),
    enabled: !!accessToken && movement.data?.type === 'invoice',
  })

  // El monto arranca precargado con el saldo: cobrar todo es el caso común.
  useEffect(() => {
    if (receivable.data && collectAmount === '') {
      setCollectAmount(String(receivable.data.outstanding))
    }
  }, [receivable.data, collectAmount])

  const collect = useMutation({
    mutationFn: () =>
      apiRequest('/movements', {
        method: 'POST',
        token: accessToken,
        body: {
          type: 'collection',
          invoiceId: id,
          walletId: collectWalletId,
          amount: Number(collectAmount),
          date: new Date().toISOString().slice(0, 10),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['receivables'] })
      await queryClient.invalidateQueries({ queryKey: ['receivables-summary'] })
      await queryClient.invalidateQueries({ queryKey: ['movements'] })
      await queryClient.invalidateQueries({ queryKey: ['balance-by-wallet'] })
      setCollectAmount('')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo registrar el cobro'),
  })
```

y el bloque visual, solo para facturas:

```tsx
      {movement.data.type === 'invoice' && receivable.data ? (
        <>
          <Text style={formStyles.label}>
            Saldo pendiente: {formatAmount(receivable.data.outstanding, receivable.data.currency)}
          </Text>

          {receivable.data.collections.length > 0 ? (
            <View style={{ gap: 4 }}>
              {receivable.data.collections.map((c) => (
                <Text key={c.id} style={styles.meta}>
                  {new Date(c.date).toLocaleDateString('es-AR')} ·{' '}
                  {formatAmount(c.amount, c.currency)}
                </Text>
              ))}
            </View>
          ) : null}

          {receivable.data.status !== 'paid' ? (
            <>
              <Text style={formStyles.label}>Cobrar en</Text>
              <View style={formStyles.rowWrap}>
                {(wallets.data ?? []).map((w) => (
                  <Pressable
                    key={w.id}
                    style={[formStyles.chip, collectWalletId === w.id && formStyles.chipActive]}
                    onPress={() => setCollectWalletId(w.id)}
                  >
                    <Text
                      style={[
                        formStyles.chipText,
                        collectWalletId === w.id && formStyles.chipTextActive,
                      ]}
                    >
                      {w.name}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                style={formStyles.input}
                keyboardType="decimal-pad"
                value={collectAmount}
                onChangeText={setCollectAmount}
                placeholderTextColor={colors.muted}
              />

              <Pressable
                style={formStyles.button}
                onPress={() => {
                  setError(null)
                  if (!collectWalletId) {
                    setError('Elegí la billetera del cobro')
                    return
                  }
                  collect.mutate()
                }}
                disabled={collect.isPending}
              >
                {collect.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={formStyles.buttonText}>Registrar cobro</Text>
                )}
              </Pressable>
            </>
          ) : null}
        </>
      ) : null}
```

- [ ] **Step 3: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. Abrir una factura desde "Te deben", registrar un cobro parcial y ver bajar el saldo y subir el de la billetera sin reiniciar.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/movement/\[id\].tsx mobile/app/_layout.tsx
git commit -m "feat(mobile): register collections from the invoice detail"
```

---

### Task 13: Recordatorio por WhatsApp

**Files:**
- Modify: `mobile/app/movement/[id].tsx`

**Interfaces:**
- Consumes: `Receivable.client.phone` (Task 7).
- Produces: botón "Recordar por WhatsApp" con el texto armado; sin teléfono, abre `wa.me` sin número para elegir contacto.

- [ ] **Step 1: Escribir el helper y el botón**

En `mobile/app/movement/[id].tsx`, sumar `import * as Linking from 'expo-linking'` (ya instalado, sin dependencia nueva) y:

```tsx
  function remindOnWhatsApp() {
    const row = receivable.data
    if (!row) return

    const monto = formatAmount(row.outstanding, row.currency)
    const atraso = row.daysOverdue > 0 ? ` (${row.daysOverdue} días de atraso)` : ''
    const mensaje = `Hola ${row.client?.name ?? ''}, te paso el recordatorio de la factura "${row.description}": queda pendiente ${monto}${atraso}. ¡Gracias!`

    // Sin teléfono, wa.me sin número deja elegir el contacto en la app.
    const phone = (row.client?.phone ?? '').replace(/[^\d]/g, '')
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`)
  }
```

y el botón, dentro del bloque de factura, debajo de "Registrar cobro":

```tsx
              <Pressable onPress={remindOnWhatsApp}>
                <Text style={styles.remind}>Recordar por WhatsApp</Text>
              </Pressable>
```

con el estilo:

```ts
  remind: { color: colors.accent, textAlign: 'center', paddingVertical: 10, fontWeight: '600' },
```

- [ ] **Step 2: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. Con un cliente con teléfono, el botón abre WhatsApp con el texto armado; sin teléfono, abre el selector de contacto.

- [ ] **Step 3: Commit**

```bash
git add mobile/app/movement/\[id\].tsx
git commit -m "feat(mobile): remind clients about unpaid invoices over WhatsApp"
```

---

### Task 14: Documentación y verificación end-to-end

**Files:**
- Modify: `README.md`
- Modify: `IMPLEMENTATION_PLAN.md` (fila 5 del roadmap)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Documentar los endpoints**

En `README.md`, en la tabla de endpoints:

```
| POST | `/movements` con `type: "invoice"` | Emite una factura (sin billetera, con cliente y vencimiento) |
| POST | `/movements` con `type: "collection"` | Registra un cobro contra una factura |
| GET | `/receivables?status=&clientId=` | Facturas con saldo, estado y días de atraso |
| GET | `/receivables/summary` | Totales por moneda, total ARS y tramos de antigüedad |
```

Agregar además la nota de que `LedgerEntry.changeArs` es lo que permite balancear un cobro en otra moneda, y que borrar una factura con cobros está bloqueado.

- [ ] **Step 2: Marcar la fase 5 en el roadmap**

En `IMPLEMENTATION_PLAN.md`, fila 5 de "Orden de ejecución": `[Cuentas por cobrar](docs/superpowers/specs/05-cuentas-por-cobrar.md) ✅ implementada`.

- [ ] **Step 3: Verificación de backend**

```bash
docker compose up -d db
cd backend && npx prisma migrate dev && npm test
```

Expected: las dos migraciones aplican en orden (enum primero) y la suite entera queda verde.

```bash
docker compose exec db psql -U monedapp_user -d monedapp -c \
  'select count(*) from ledger_entries where "changeArs" is null;'
```

Expected: 0.

Con el server arriba y un token válido:

```bash
TOKEN=... # accessToken de POST /auth/login
curl -s -X POST localhost:8000/movements -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"invoice","clientId":"<id>","amount":1000,"currency":"USD","dueDate":"2026-07-01","description":"Sprint 12"}'
curl -s localhost:8000/receivables -H "Authorization: Bearer $TOKEN"
curl -s localhost:8000/receivables/summary -H "Authorization: Bearer $TOKEN"
```

Expected: la factura devuelve 201 con `walletId: null`; `balance-by-wallet` no cambia; `/receivables` muestra `outstanding: 1000` y `status: "overdue"` con `daysOverdue` coherente.

Cobrar en ARS y verificar el asiento de tres patas:

```bash
docker compose exec db psql -U monedapp_user -d monedapp -c \
  'select a.name, le.change, le."changeArs" from ledger_entries le join accounts a on a.id = le."accountId" where le."movementId" = '"'"'<id-del-cobro>'"'"';'
```

Expected: tres filas, una en "Diferencia de cambio", y `changeArs` sumando 0.

- [ ] **Step 4: Verificación de app**

```bash
cd mobile && npx expo start --ios
```

Recorrido: cargar una factura desde Nuevo movimiento → ver "Te deben" en Inicio → abrir el detalle → registrar un cobro parcial y ver bajar el saldo → tocar "Recordar por WhatsApp" y verificar el texto.

- [ ] **Step 5: Commit**

```bash
git add README.md IMPLEMENTATION_PLAN.md
git commit -m "docs: document receivables, collections and fx differences"
```
