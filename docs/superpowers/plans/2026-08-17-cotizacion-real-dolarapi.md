# Cotización real (dolarapi) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el tipo de cambio stub por cotizaciones reales (oficial/blue/MEP/cripto) con caché en DB, cascada de fallback que nunca falla, y selector de cotización en la app al cargar movimientos en moneda no-ARS.

**Architecture:** Todo el I/O de red vive en un módulo nuevo `fxProvider.ts` (sin Prisma), para que `exchangeRateService.ts` quede testeable con `fetch` mockeado. El service conserva sus firmas públicas actuales y pasa a resolver cada cotización por cascada: API real → última fila en DB → constante stub, registrando cuál se usó en `source`. La app lee `GET /exchange-rates` y manda `exchangeRateType` al crear el movimiento.

**Tech Stack:** Node 22 · Express 5 · TypeScript · Prisma 7 + PostgreSQL · Vitest + supertest (Postgres real) · Expo (React Native) + TanStack Query.

**Spec:** [docs/superpowers/specs/01-cotizacion-real-dolarapi.md](../specs/01-cotizacion-real-dolarapi.md)

**Rama:** `codex/f1-cotizacion-real` (implementada y mergeada a `main`). Crear desde `main`. No reutilizar ramas de otras fases.

## Global Constraints

- El movimiento **nunca** falla por falta de cotización: la cascada siempre termina en un valor (`stub` como último recurso).
- Las firmas públicas de `exchangeRateService.ts` se mantienen: `ensureRateForDate`, `getRates`, `resolveExchangeRateId`, `parseExchangeRateType`. Las consumen `routes/movements.ts` y `routes/exchangeRates.ts`.
- `ExchangeRate.value` sigue existiendo y queda **igual a `sell`** (venta), para no romper lectores actuales. `buy`/`sell` son nullable.
- **Dos migraciones separadas, no una.** Postgres no permite usar un valor de enum recién agregado en la misma transacción que lo agrega, y Prisma corre cada migración en una transacción.
- Mapeo fijo tipo → casa de dolarapi: `{ oficial:'oficial', blue:'blue', mep:'bolsa', cripto:'cripto' }`.
- Default de cotización por moneda: `USDT → cripto`, resto → `blue`. `ARS` no consulta la red nunca (valor fijo 1, `source: 'fixed'`).
- Config por env con defaults: `FX_BASE_URL=https://dolarapi.com/v1/dolares`, `FX_HISTORICAL_BASE_URL=https://api.argentinadatos.com/v1/cotizaciones/dolares`, `FX_TIMEOUT_MS=4000`, `FX_ENABLED=true`. Con `FX_ENABLED=false` no se toca la red.
- Los valores `source` válidos son exactamente: `dolarapi`, `argentinadatos`, `db-fallback`, `stub`, `fixed`.
- La UI nunca menciona asientos contables ni Debe/Haber.
- Fuera de alcance: conversión a ARS en ledger y reportes, job de refresco programado, casas `tarjeta`/CCL/mayorista.
- Comandos: backend desde `backend/` (`npm test`, `npx prisma migrate dev`), app desde `mobile/`.
- **Commits en inglés**, formato `tipo: mensaje` (`feat:`, `fix:`, `test:`, `docs:`), como todo el historial del repo. `.cursor/rules/push-after-task.mdc` además pide commitear y pushear al terminar cada task, sin esperar que lo pidan.

---

### Task 1: Enum `cripto` + columnas `buy`/`sell`

**Files:**
- Modify: `backend/prisma/schema.prisma:28-32` (enum) y `:115-129` (model ExchangeRate)
- Create: `backend/prisma/migrations/<timestamp>_add_cripto_exchange_rate_type/migration.sql`
- Create: `backend/prisma/migrations/<timestamp>_add_exchange_rate_buy_sell/migration.sql`
- Modify: `backend/src/services/exchangeRateService.ts` (STUB_RATES + mensaje de `parseExchangeRateType`)
- Test: `backend/tests/exchangeRates.test.ts` (ya existe con un test)

**Interfaces:**
- Consumes: nada.
- Produces: `ExchangeRateType.cripto` disponible en `@prisma/client`; `ExchangeRate.buy` y `ExchangeRate.sell` (`Decimal?`); `STUB_RATES` con las 4 claves.

- [ ] **Step 1: Levantar la DB local**

```bash
docker compose up -d db
```

- [ ] **Step 2: Correr el test que ya existe y verlo fallar**

Run: `cd backend && npx vitest run tests/exchangeRates.test.ts`
Expected: FAIL — `parseExchangeRateType('cripto')` tira `AppError 400 'Tipo de cotización inválido (oficial|blue|mep)'`.

- [ ] **Step 3: Agregar el valor de enum y las columnas al schema**

En `backend/prisma/schema.prisma`:

```prisma
enum ExchangeRateType {
  oficial
  blue
  mep
  cripto
}
```

```prisma
model ExchangeRate {
  id        String           @id @default(cuid())
  date      DateTime         @db.Date
  type      ExchangeRateType
  currency  Currency
  value     Decimal          @db.Decimal(18, 6)
  buy       Decimal?         @db.Decimal(18, 6)
  sell      Decimal?         @db.Decimal(18, 6)
  source    String
  createdAt DateTime         @default(now())

  movements Movement[]

  @@unique([date, type, currency])
  @@index([currency, date])
  @@map("exchange_rates")
}
```

- [ ] **Step 4: Generar las dos migraciones, en dos pasos**

Primero solo el enum (revertir temporalmente `buy`/`sell` del schema no hace falta si se usa `--create-only`, pero el orden sí importa):

```bash
cd backend
npx prisma migrate dev --create-only --name add_cripto_exchange_rate_type
```

Editar el SQL generado para que contenga **únicamente**:

```sql
ALTER TYPE "ExchangeRateType" ADD VALUE 'cripto';
```

Aplicarla:

```bash
npx prisma migrate dev
```

Luego la segunda, que trae las columnas:

```bash
npx prisma migrate dev --name add_exchange_rate_buy_sell
```

Su SQL debe quedar:

```sql
ALTER TABLE "exchange_rates" ADD COLUMN "buy" DECIMAL(18,6);
ALTER TABLE "exchange_rates" ADD COLUMN "sell" DECIMAL(18,6);
```

- [ ] **Step 5: Sumar `cripto` al stub y al mensaje de error**

En `backend/src/services/exchangeRateService.ts`:

```ts
const STUB_RATES: Record<ExchangeRateType, number> = {
  oficial: 980,
  blue: 1280,
  mep: 1210,
  cripto: 1300,
}
```

```ts
export function parseExchangeRateType(value: unknown): ExchangeRateType {
  if (value === undefined || value === null) return ExchangeRateType.blue
  if (typeof value !== 'string' || !(value in ExchangeRateType)) {
    throw new AppError(400, 'Tipo de cotización inválido (oficial|blue|mep|cripto)')
  }
  return value as ExchangeRateType
}
```

- [ ] **Step 6: Correr los tests**

Run: `cd backend && npm test`
Expected: PASS — auth + el test de `cripto`.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/services/exchangeRateService.ts backend/tests/exchangeRates.test.ts
git commit -m "feat: add cripto exchange-rate type and buy/sell columns"
```

---

### Task 2: `fxProvider.fetchLiveRate`

**Files:**
- Create: `backend/src/services/fxProvider.ts`
- Test: `backend/tests/fxProvider.test.ts`

**Interfaces:**
- Consumes: `ExchangeRateType` de `@prisma/client`.
- Produces:
  - `type FxQuote = { buy: number; sell: number; source: 'dolarapi' | 'argentinadatos' }`
  - `CASA_BY_TYPE: Record<ExchangeRateType, string>`
  - `fetchLiveRate(type: ExchangeRateType): Promise<FxQuote | null>`

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/fxProvider.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CASA_BY_TYPE, fetchLiveRate } from '../src/services/fxProvider'

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response
}

describe('fxProvider.fetchLiveRate', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
    process.env.FX_BASE_URL = 'https://fx.test/v1/dolares'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.FX_BASE_URL
  })

  it('mapea mep a la casa bolsa', () => {
    expect(CASA_BY_TYPE.mep).toBe('bolsa')
    expect(CASA_BY_TYPE.cripto).toBe('cripto')
  })

  it('respuesta ok → {buy, sell, source: dolarapi} y pega a la casa correcta', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ compra: 1500, venta: 1530, casa: 'blue' })
    )
    vi.stubGlobal('fetch', fetchMock)

    const quote = await fetchLiveRate('blue')

    expect(quote).toEqual({ buy: 1500, sell: 1530, source: 'dolarapi' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://fx.test/v1/dolares/blue')
  })

  it('venta no numérica → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: null })))

    expect(await fetchLiveRate('blue')).toBeNull()
  })

  it('fetch que rechaza → null, no lanza', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    expect(await fetchLiveRate('oficial')).toBeNull()
  })

  it('FX_ENABLED=false → null sin tocar la red', async () => {
    process.env.FX_ENABLED = 'false'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchLiveRate('blue')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/fxProvider.test.ts`
Expected: FAIL — `Cannot find module '../src/services/fxProvider'`.

- [ ] **Step 3: Implementar el provider**

Crear `backend/src/services/fxProvider.ts`:

```ts
import { ExchangeRateType } from '@prisma/client'

export type FxQuote = {
  buy: number
  sell: number
  source: 'dolarapi' | 'argentinadatos'
}

export const CASA_BY_TYPE: Record<ExchangeRateType, string> = {
  oficial: 'oficial',
  blue: 'blue',
  mep: 'bolsa',
  cripto: 'cripto',
}

/** Se lee en cada llamada: los tests cambian el env entre casos. */
function fxConfig() {
  return {
    baseUrl: process.env.FX_BASE_URL ?? 'https://dolarapi.com/v1/dolares',
    historicalBaseUrl:
      process.env.FX_HISTORICAL_BASE_URL ??
      'https://api.argentinadatos.com/v1/cotizaciones/dolares',
    timeoutMs: Number(process.env.FX_TIMEOUT_MS ?? 4000),
    enabled: process.env.FX_ENABLED !== 'false',
  }
}

function parseQuote(data: unknown): { buy: number; sell: number } | null {
  if (typeof data !== 'object' || data === null) return null
  const { compra, venta } = data as Record<string, unknown>
  const buy = Number(compra)
  const sell = Number(venta)
  if (!Number.isFinite(sell) || sell <= 0) return null
  return { buy: Number.isFinite(buy) ? buy : sell, sell }
}

async function getQuote(url: string, timeoutMs: number): Promise<{ buy: number; sell: number } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return parseQuote(await res.json())
  } catch {
    return null
  }
}

export async function fetchLiveRate(type: ExchangeRateType): Promise<FxQuote | null> {
  const { baseUrl, timeoutMs, enabled } = fxConfig()
  if (!enabled) return null

  const quote = await getQuote(`${baseUrl}/${CASA_BY_TYPE[type]}`, timeoutMs)
  return quote ? { ...quote, source: 'dolarapi' } : null
}
```

- [ ] **Step 4: Correr el test**

Run: `cd backend && npx vitest run tests/fxProvider.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/fxProvider.ts backend/tests/fxProvider.test.ts
git commit -m "feat: add fxProvider with live dolarapi quotes"
```

---

### Task 3: `fxProvider.fetchHistoricalRate`

**Files:**
- Modify: `backend/src/services/fxProvider.ts`
- Test: `backend/tests/fxProvider.test.ts`

**Interfaces:**
- Consumes: `getQuote`, `fxConfig`, `CASA_BY_TYPE` de la Task 2.
- Produces: `fetchHistoricalRate(type: ExchangeRateType, date: Date): Promise<FxQuote | null>` — path `{historicalBaseUrl}/{casa}/{yyyy}/{MM}/{dd}` en UTC, `source: 'argentinadatos'`.

- [ ] **Step 1: Escribir el test que falla**

Agregar en `backend/tests/fxProvider.test.ts`, y sumar `fetchHistoricalRate` al import:

```ts
describe('fxProvider.fetchHistoricalRate', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
    process.env.FX_HISTORICAL_BASE_URL = 'https://hist.test/v1/cotizaciones/dolares'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.FX_HISTORICAL_BASE_URL
  })

  it('arma el path yyyy/MM/dd en UTC y devuelve source argentinadatos', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ compra: 1490, venta: 1530, fecha: '2026-07-18' })
    )
    vi.stubGlobal('fetch', fetchMock)

    const quote = await fetchHistoricalRate('blue', new Date(Date.UTC(2026, 6, 18)))

    expect(quote).toEqual({ buy: 1490, sell: 1530, source: 'argentinadatos' })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://hist.test/v1/cotizaciones/dolares/blue/2026/07/18'
    )
  })

  it('404 → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response))

    expect(await fetchHistoricalRate('mep', new Date(Date.UTC(2026, 0, 5)))).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/fxProvider.test.ts`
Expected: FAIL — `fetchHistoricalRate is not a function`.

- [ ] **Step 3: Implementar**

Agregar al final de `backend/src/services/fxProvider.ts`:

```ts
export async function fetchHistoricalRate(
  type: ExchangeRateType,
  date: Date
): Promise<FxQuote | null> {
  const { historicalBaseUrl, timeoutMs, enabled } = fxConfig()
  if (!enabled) return null

  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')

  const quote = await getQuote(
    `${historicalBaseUrl}/${CASA_BY_TYPE[type]}/${yyyy}/${mm}/${dd}`,
    timeoutMs
  )
  return quote ? { ...quote, source: 'argentinadatos' } : null
}
```

- [ ] **Step 4: Correr el test**

Run: `cd backend && npx vitest run tests/fxProvider.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/fxProvider.ts backend/tests/fxProvider.test.ts
git commit -m "feat: add historical argentinadatos quotes to fxProvider"
```

---

### Task 4: Defaults y tipos por moneda

**Files:**
- Modify: `backend/src/services/exchangeRateService.ts`
- Test: `backend/tests/exchangeRates.test.ts`

**Interfaces:**
- Consumes: `Currency`, `ExchangeRateType` de `@prisma/client`.
- Produces:
  - `defaultTypeForCurrency(currency: Currency): ExchangeRateType`
  - `typesForCurrency(currency: Currency): ExchangeRateType[]`

- [ ] **Step 1: Escribir el test que falla**

Reemplazar el contenido de `backend/tests/exchangeRates.test.ts` por:

```ts
import { describe, expect, it } from 'vitest'
import { Currency } from '@prisma/client'
import {
  defaultTypeForCurrency,
  parseExchangeRateType,
  typesForCurrency,
} from '../src/services/exchangeRateService'

describe('exchange rates', () => {
  it('accepts cripto as a movement exchange-rate type', () => {
    expect(parseExchangeRateType('cripto')).toBe('cripto')
  })

  it('default por moneda: USDT → cripto, USD → blue', () => {
    expect(defaultTypeForCurrency(Currency.USDT)).toBe('cripto')
    expect(defaultTypeForCurrency(Currency.USD)).toBe('blue')
  })

  it('tipos por moneda', () => {
    expect(typesForCurrency(Currency.USD)).toEqual(['oficial', 'blue', 'mep'])
    expect(typesForCurrency(Currency.USDT)).toEqual(['cripto'])
    expect(typesForCurrency(Currency.ARS)).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/exchangeRates.test.ts`
Expected: FAIL — `defaultTypeForCurrency is not a function`.

- [ ] **Step 3: Implementar**

Agregar en `backend/src/services/exchangeRateService.ts`, arriba de `ensureRateForDate`:

```ts
export function defaultTypeForCurrency(currency: Currency): ExchangeRateType {
  return currency === Currency.USDT ? ExchangeRateType.cripto : ExchangeRateType.blue
}

export function typesForCurrency(currency: Currency): ExchangeRateType[] {
  if (currency === Currency.ARS) return []
  if (currency === Currency.USDT) return [ExchangeRateType.cripto]
  return [ExchangeRateType.oficial, ExchangeRateType.blue, ExchangeRateType.mep]
}
```

- [ ] **Step 4: Correr el test**

Run: `cd backend && npx vitest run tests/exchangeRates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/exchangeRateService.ts backend/tests/exchangeRates.test.ts
git commit -m "feat: add per-currency default and rate list"
```

---

### Task 5: Cascada — ARS fijo y cache hit

**Files:**
- Modify: `backend/src/services/exchangeRateService.ts` (reescribir `ensureRateForDate`)
- Test: `backend/tests/exchangeRates.test.ts`

**Interfaces:**
- Consumes: `defaultTypeForCurrency` (Task 4), `fetchLiveRate` / `fetchHistoricalRate` (Tasks 2-3).
- Produces:
  - `ensureRateForDate(date: Date, currency: Currency, type?: ExchangeRateType)` — `type` default `defaultTypeForCurrency(currency)`.
  - Helper interno `upsertRate(d, type, currency, { buy, sell, source })` que escribe `value = sell`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/exchangeRates.test.ts` (sumar imports `beforeEach`, `afterEach`, `vi`, `ensureRateForDate`, y `prisma` desde `../src/prisma/prisma`; también `import 'dotenv/config'` como primera línea del archivo):

```ts
function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response
}

function todayUtc() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

describe('ensureRateForDate — cascada', () => {
  beforeEach(async () => {
    process.env.FX_ENABLED = 'true'
    // 'oficial' no lo usa ningún movimiento de los tests: se puede limpiar sin romper FKs.
    await prisma.exchangeRate.deleteMany({
      where: { currency: Currency.USD, type: 'oficial', date: todayUtc() },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ARS → value 1, source fixed, sin tocar la red', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const rate = await ensureRateForDate(todayUtc(), Currency.ARS)

    expect(Number(rate.value)).toBe(1)
    expect(Number(rate.sell)).toBe(1)
    expect(rate.source).toBe('fixed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetch ok → source dolarapi y value === sell', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: 1530 })))

    const rate = await ensureRateForDate(todayUtc(), Currency.USD, 'oficial')

    expect(rate.source).toBe('dolarapi')
    expect(Number(rate.buy)).toBe(1500)
    expect(Number(rate.sell)).toBe(1530)
    expect(Number(rate.value)).toBe(1530)
  })

  it('segunda llamada con misma fecha y tipo no vuelve a pegarle a la red', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: 1530 })))
    await ensureRateForDate(todayUtc(), Currency.USD, 'oficial')

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cached = await ensureRateForDate(todayUtc(), Currency.USD, 'oficial')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(Number(cached.value)).toBe(1530)
    expect(cached.source).toBe('dolarapi')
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/exchangeRates.test.ts`
Expected: FAIL — ARS devuelve `source: 'stub'` y `sell` es `null`; el caso `dolarapi` devuelve `stub`.

- [ ] **Step 3: Reescribir `ensureRateForDate` con los dos primeros escalones**

En `backend/src/services/exchangeRateService.ts`, importar el provider y reemplazar `ensureRateForDate`:

```ts
import { fetchHistoricalRate, fetchLiveRate, type FxQuote } from './fxProvider'

async function upsertRate(
  d: Date,
  type: ExchangeRateType,
  currency: Currency,
  values: { buy: number; sell: number; source: string }
) {
  const data = {
    value: new Prisma.Decimal(values.sell),
    buy: new Prisma.Decimal(values.buy),
    sell: new Prisma.Decimal(values.sell),
    source: values.source,
  }

  return prisma.exchangeRate.upsert({
    where: { date_type_currency: { date: d, type, currency } },
    create: { date: d, type, currency, ...data },
    update: data,
  })
}

export async function ensureRateForDate(
  date: Date,
  currency: Currency,
  type: ExchangeRateType = defaultTypeForCurrency(currency)
) {
  const d = dateOnly(date)

  // 1. ARS no cotiza contra sí mismo.
  if (currency === Currency.ARS) {
    return upsertRate(d, type, Currency.ARS, { buy: 1, sell: 1, source: 'fixed' })
  }

  // 2. Caché: cualquier fila que no sea stub ya sirve.
  const cached = await prisma.exchangeRate.findUnique({
    where: { date_type_currency: { date: d, type, currency } },
  })
  if (cached && cached.source !== 'stub') return cached

  // 3. Red: hoy → cotización actual; fecha pasada → histórica.
  const isToday = d.getTime() >= dateOnly(new Date()).getTime()
  const quote: FxQuote | null = isToday
    ? await fetchLiveRate(type)
    : await fetchHistoricalRate(type, d)

  if (quote) {
    return upsertRate(d, type, currency, {
      buy: quote.buy,
      sell: quote.sell,
      source: quote.source,
    })
  }

  // 4. y 5. (fallback DB y stub) llegan en la Task 6.
  return upsertRate(d, type, currency, {
    buy: STUB_RATES[type],
    sell: STUB_RATES[type],
    source: 'stub',
  })
}
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx vitest run tests/exchangeRates.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/exchangeRateService.ts backend/tests/exchangeRates.test.ts
git commit -m "feat: resolve exchange rates from the live API with DB cache"
```

---

### Task 6: Cascada — fallback a DB y stub

**Files:**
- Modify: `backend/src/services/exchangeRateService.ts`
- Test: `backend/tests/exchangeRates.test.ts`

**Interfaces:**
- Consumes: `upsertRate`, `ensureRateForDate` (Task 5).
- Produces: `ensureRateForDate` completo — con `source: 'db-fallback'` cuando hay una fila anterior no-stub de esa moneda y tipo, y `source: 'stub'` si tampoco hay.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/exchangeRates.test.ts`:

```ts
/** Fecha pasada única, para que cada corrida escriba filas propias. */
function uniquePastDate() {
  const daysFrom2000 = 1 + Math.floor(Math.random() * 7000)
  return new Date(Date.UTC(2000, 0, daysFrom2000))
}

describe('ensureRateForDate — fallbacks', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sin red + fila previa en DB → db-fallback con el valor previo', async () => {
    const previous = uniquePastDate()
    const target = new Date(previous.getTime() + 86_400_000)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 900, venta: 950 })))
    await ensureRateForDate(previous, Currency.USD, 'mep')

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))
    const rate = await ensureRateForDate(target, Currency.USD, 'mep')

    expect(rate.source).toBe('db-fallback')
    expect(Number(rate.value)).toBe(950)
    expect(Number(rate.buy)).toBe(900)
  })

  it('sin red y sin filas previas → stub', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    // 1970: no hay ninguna fila anterior posible en la tabla.
    const rate = await ensureRateForDate(new Date(Date.UTC(1970, 0, 2)), Currency.USD, 'mep')

    expect(rate.source).toBe('stub')
    expect(Number(rate.value)).toBe(1210)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/exchangeRates.test.ts`
Expected: FAIL — el primer caso devuelve `source: 'stub'` en vez de `db-fallback`.

- [ ] **Step 3: Implementar el escalón 4**

En `backend/src/services/exchangeRateService.ts`, reemplazar el bloque de comentario `// 4. y 5. ...` y el `upsertRate` de stub por:

```ts
  // 4. Última cotización conocida de esa moneda y tipo (nunca una stub).
  const previous = await prisma.exchangeRate.findFirst({
    where: { currency, type, date: { lt: d }, source: { not: 'stub' } },
    orderBy: { date: 'desc' },
  })

  if (previous) {
    return upsertRate(d, type, currency, {
      buy: Number(previous.buy ?? previous.value),
      sell: Number(previous.sell ?? previous.value),
      source: 'db-fallback',
    })
  }

  // 5. Último recurso: constante, para que el movimiento nunca falle.
  return upsertRate(d, type, currency, {
    buy: STUB_RATES[type],
    sell: STUB_RATES[type],
    source: 'stub',
  })
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx vitest run tests/exchangeRates.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/exchangeRateService.ts backend/tests/exchangeRates.test.ts
git commit -m "feat: complete rate cascade with DB and stub fallbacks"
```

---

### Task 7: `getRates` en paralelo y por moneda

**Files:**
- Modify: `backend/src/services/exchangeRateService.ts:52-64` (`getRates` y `resolveExchangeRateId`)
- Test: `backend/tests/exchangeRates.test.ts`

**Interfaces:**
- Consumes: `typesForCurrency` (Task 4), `ensureRateForDate` (Tasks 5-6).
- Produces: `getRates(currency, date)` devuelve **solo** los tipos de esa moneda, resueltos con `Promise.all`; `resolveExchangeRateId(currency, date, type?)` usa el default por moneda.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/exchangeRates.test.ts` (sumar `getRates` al import):

```ts
describe('getRates', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: 1530 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('USD → oficial, blue y mep', async () => {
    const rates = await getRates(Currency.USD, uniquePastDate())
    expect(rates.map((r) => r.type).sort()).toEqual(['blue', 'mep', 'oficial'])
  })

  it('USDT → solo cripto', async () => {
    const rates = await getRates(Currency.USDT, uniquePastDate())
    expect(rates.map((r) => r.type)).toEqual(['cripto'])
  })

  it('ARS → una fila fija en 1', async () => {
    const rates = await getRates(Currency.ARS, uniquePastDate())
    expect(rates).toHaveLength(1)
    expect(Number(rates[0].value)).toBe(1)
    expect(rates[0].source).toBe('fixed')
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/exchangeRates.test.ts`
Expected: FAIL — `getRates(USD)` devuelve 4 tipos (incluye `cripto`) y `ARS` devuelve 4 filas.

- [ ] **Step 3: Implementar**

Reemplazar `getRates` y `resolveExchangeRateId` en `backend/src/services/exchangeRateService.ts`:

```ts
export async function getRates(currency: Currency, date: Date) {
  const d = dateOnly(date)
  const types = typesForCurrency(currency)

  // ARS no tiene tipos: se devuelve la fila fija para que la app tenga algo que mostrar.
  if (types.length === 0) {
    return [await ensureRateForDate(d, currency, ExchangeRateType.blue)]
  }

  return Promise.all(types.map((type) => ensureRateForDate(d, currency, type)))
}

export async function resolveExchangeRateId(
  currency: Currency,
  date: Date,
  type: ExchangeRateType = defaultTypeForCurrency(currency)
): Promise<string> {
  const rate = await ensureRateForDate(date, currency, type)
  return rate.id
}
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npm test`
Expected: PASS — auth + los 11 tests de exchange rates + fxProvider.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/exchangeRateService.ts backend/tests/exchangeRates.test.ts
git commit -m "feat: getRates returns only each currency's types, in parallel"
```

---

### Task 8: `GET /exchange-rates` con `buy`/`sell`

**Files:**
- Modify: `backend/src/routes/exchangeRates.ts:26-36`
- Test: `backend/tests/exchangeRates.test.ts`

**Interfaces:**
- Consumes: `getRates` (Task 7).
- Produces: respuesta `{ id, date, type, currency, value, buy, sell, source }[]`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/exchangeRates.test.ts` (sumar `import request from 'supertest'` y `import { createApp } from '../src/app'`, y `const app = createApp()`):

```ts
async function registerUser() {
  const email = `fx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
  const res = await request(app).post('/auth/register').send({ email, password: 'password123' })
  return res.body.accessToken as string
}

describe('GET /exchange-rates', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: 1530 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('USD → 3 tipos con buy y sell', async () => {
    const token = await registerUser()
    const date = uniquePastDate().toISOString().slice(0, 10)

    const res = await request(app)
      .get(`/exchange-rates?currency=USD&date=${date}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    expect(Number(res.body[0].buy)).toBe(1500)
    expect(Number(res.body[0].sell)).toBe(1530)
    expect(res.body[0].source).toBe('argentinadatos')
  })

  it('USDT → solo cripto', async () => {
    const token = await registerUser()
    const date = uniquePastDate().toISOString().slice(0, 10)

    const res = await request(app)
      .get(`/exchange-rates?currency=USDT&date=${date}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.map((r: { type: string }) => r.type)).toEqual(['cripto'])
  })
})
```

Nota: `supertest` levanta el mismo proceso, así que el `fetch` stubbeado también aplica al provider.

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/exchangeRates.test.ts`
Expected: FAIL — `res.body[0].buy` es `undefined`.

- [ ] **Step 3: Implementar**

En `backend/src/routes/exchangeRates.ts`, en el `res.json(...)`:

```ts
    res.json(
      rates.map((r) => ({
        id: r.id,
        date: r.date,
        type: r.type,
        currency: r.currency,
        value: r.value,
        buy: r.buy,
        sell: r.sell,
        source: r.source,
      }))
    )
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx vitest run tests/exchangeRates.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/exchangeRates.ts backend/tests/exchangeRates.test.ts
git commit -m "feat: expose buy and sell in GET /exchange-rates"
```

---

### Task 9: Movimientos — default por moneda y snapshot serializado

**Files:**
- Modify: `backend/src/routes/movements.ts:18-21` (`movementInclude`) y `:86` (parseo de `exchangeRateType`)
- Modify: `backend/src/lib/serializers.ts:23-52` (`serializeMovement`)
- Test: `backend/tests/exchangeRates.test.ts`

**Interfaces:**
- Consumes: `defaultTypeForCurrency`, `parseExchangeRateType`, `resolveExchangeRateId`.
- Produces: `serializeMovement` agrega `exchangeRate?: { id, type, value, buy, sell, source, date }`; `POST /movements` sin `exchangeRateType` usa el default de la moneda de la billetera.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/exchangeRates.test.ts`:

```ts
describe('POST /movements con cotización', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: 1530 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function setup() {
    const token = await registerUser()
    await request(app)
      .post('/users/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ templateId: 'freelancer_software' })
    const wallets = await request(app).get('/wallets').set('Authorization', `Bearer ${token}`)
    return { token, wallets: wallets.body as { id: string; currency: string }[] }
  }

  it('wallet USDT sin exchangeRateType → cripto por default', async () => {
    const { token, wallets } = await setup()
    const usdt = wallets.find((w) => w.currency === 'USDT')
    if (!usdt) return // la plantilla puede no traer billetera USDT

    const res = await request(app)
      .post('/movements')
      .set('Authorization', `Bearer ${token}`)
      .send({ walletId: usdt.id, type: 'income', amount: 100, description: 'Pago cripto' })

    expect(res.status).toBe(201)
    expect(res.body.exchangeRate.type).toBe('cripto')
  })

  it('wallet USD con exchangeRateType mep → snapshot mep en la respuesta', async () => {
    const { token, wallets } = await setup()
    const usd = wallets.find((w) => w.currency === 'USD')!

    const res = await request(app)
      .post('/movements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        walletId: usd.id,
        type: 'income',
        amount: 200,
        description: 'Cobro cliente',
        exchangeRateType: 'mep',
      })

    expect(res.status).toBe(201)
    expect(res.body.exchangeRate.type).toBe('mep')
    expect(Number(res.body.exchangeRate.sell)).toBeGreaterThan(0)

    const list = await request(app).get('/movements').set('Authorization', `Bearer ${token}`)
    expect(list.body[0].exchangeRate.type).toBe('mep')
  })
})
```

La ruta de onboarding es `POST /users/me/onboarding` con `{ templateId }` (el router se monta sin prefijo, `app.ts:22`). La plantilla `freelancer_software` crea billeteras ARS y USD, no USDT — por eso el primer test hace `return` si no la encuentra.

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/exchangeRates.test.ts`
Expected: FAIL — `res.body.exchangeRate` es `undefined`.

- [ ] **Step 3: Incluir y serializar el snapshot**

En `backend/src/routes/movements.ts`:

```ts
const movementInclude = {
  wallet: { select: { id: true, name: true, currency: true } },
  client: { select: { id: true, name: true } },
  exchangeRate: {
    select: { id: true, type: true, value: true, buy: true, sell: true, source: true, date: true },
  },
} as const
```

En `backend/src/lib/serializers.ts`:

```ts
export function serializeMovement(
  movement: Movement & {
    wallet?: { id: string; name: string; currency: string }
    client?: { id: string; name: string } | null
    exchangeRate?: {
      id: string
      type: string
      value: unknown
      buy: unknown
      sell: unknown
      source: string
      date: Date
    } | null
  }
) {
```

y dentro del objeto devuelto, después de `client`:

```ts
    exchangeRate: movement.exchangeRate
      ? {
          id: movement.exchangeRate.id,
          type: movement.exchangeRate.type,
          value: movement.exchangeRate.value,
          buy: movement.exchangeRate.buy,
          sell: movement.exchangeRate.sell,
          source: movement.exchangeRate.source,
          date: movement.exchangeRate.date,
        }
      : undefined,
```

- [ ] **Step 4: Usar el default por moneda al crear**

En `backend/src/routes/movements.ts`, mover el parseo del tipo para que dependa de la billetera. Reemplazar la línea `const rateType = parseExchangeRateType(exchangeRateType)` (queda antes del `findFirst` de wallet) por nada, y después de validar `wallet` agregar:

```ts
    const rateType =
      exchangeRateType === undefined || exchangeRateType === null
        ? defaultTypeForCurrency(wallet.currency)
        : parseExchangeRateType(exchangeRateType)
```

Actualizar el import:

```ts
import {
  defaultTypeForCurrency,
  parseExchangeRateType,
  resolveExchangeRateId,
} from '../services/exchangeRateService'
```

Verificar que el `POST` devuelva el movimiento con `movementInclude` (si el `create` no incluye la relación, releer el movimiento con `findUnique({ where: { id }, include: movementInclude })` antes de responder).

- [ ] **Step 5: Correr toda la suite**

Run: `cd backend && npm test`
Expected: PASS — auth, fxProvider y exchange rates.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/movements.ts backend/src/lib/serializers.ts backend/tests/exchangeRates.test.ts
git commit -m "feat: per-currency rate default and snapshot in movement responses"
```

---

### Task 10: Seed con cotizaciones reales

**Files:**
- Modify: `backend/prisma/seed.ts:9-40`

**Interfaces:**
- Consumes: `getRates` (Task 7).
- Produces: seed que escribe cotizaciones reales del día para USD y USDT, con aviso por consola cuando cae al fallback.

- [ ] **Step 1: Reemplazar el loop de stub por `getRates`**

En `backend/prisma/seed.ts`, borrar la constante `STUB` y el doble loop de upsert de cotizaciones, y dejar:

```ts
import { getRates } from '../src/services/exchangeRateService'
```

```ts
  for (const currency of [Currency.USD, Currency.USDT] as const) {
    const rates = await getRates(currency, today)
    for (const rate of rates) {
      const estimada = rate.source === 'stub' || rate.source === 'db-fallback'
      console.log(
        `${currency} ${rate.type}: ${rate.value} (${rate.source})${estimada ? ' — estimada' : ''}`
      )
    }
  }

  await getRates(Currency.ARS, today)
```

El resto del seed (plantillas, cuentas, wallets) no se toca. Si el seed usaba `d` en vez de `today`, usar la misma variable de fecha ya normalizada a UTC que había.

- [ ] **Step 2: Correr el seed contra la DB local**

```bash
cd backend && npm run db:seed
```

Expected: imprime una línea por tipo (`USD oficial: 1234.50 (dolarapi)`, etc.).

- [ ] **Step 3: Verificar el fallback**

```bash
cd backend && FX_ENABLED=false npm run db:seed
```

Expected: sin errores; las líneas dicen `(db-fallback)` o `(stub)` y terminan en `— estimada`.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/seed.ts
git commit -m "feat: seed with live rates and fallback notice"
```

---

### Task 11: Tipos de la app

**Files:**
- Modify: `mobile/src/api/types.ts:41-58`

**Interfaces:**
- Consumes: la respuesta de `GET /exchange-rates` (Task 8) y `serializeMovement` (Task 9).
- Produces: `ExchangeRate` y `Movement.exchangeRate` para las Tasks 12-13.

- [ ] **Step 1: Agregar los tipos**

En `mobile/src/api/types.ts`:

```ts
export type ExchangeRate = {
  id: string
  date: string
  type: 'oficial' | 'blue' | 'mep' | 'cripto'
  currency: string
  value: string | number
  buy: string | number | null
  sell: string | number | null
  source: 'dolarapi' | 'argentinadatos' | 'db-fallback' | 'stub' | 'fixed'
}
```

y dentro de `Movement`, después de `client`:

```ts
  exchangeRate?: ExchangeRate
```

- [ ] **Step 2: Chequear tipos**

Run: `cd mobile && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/api/types.ts
git commit -m "feat(mobile): type the exchange rate on movements"
```

---

### Task 12: Selector de cotización al cargar un movimiento

**Files:**
- Modify: `mobile/app/(tabs)/new-movement.tsx`

**Interfaces:**
- Consumes: `ExchangeRate` (Task 11), `GET /exchange-rates?currency&date` (Task 8), `POST /movements` con `exchangeRateType` (Task 9).
- Produces: pantalla que manda `exchangeRateType` cuando la billetera no es ARS.

- [ ] **Step 1: Agregar la query de cotizaciones**

Sumar `ExchangeRate` al import de tipos y, debajo de la query `clients`:

```ts
  const [rateType, setRateType] = useState<string | null>(null)

  const selectedWallet = useMemo(
    () => (wallets.data ?? []).find((w) => w.id === selectedWalletId) ?? null,
    [wallets.data, selectedWalletId]
  )
  const currency = selectedWallet?.currency ?? 'ARS'
  const today = new Date().toISOString().slice(0, 10)

  const rates = useQuery({
    queryKey: ['exchange-rates', currency, today],
    queryFn: () =>
      apiRequest<ExchangeRate[]>(`/exchange-rates?currency=${currency}&date=${today}`, {
        token: accessToken,
      }),
    enabled: !!accessToken && currency !== 'ARS',
  })

  // Si cambia la billetera, el tipo elegido puede no existir para la nueva moneda.
  const activeRate =
    (rates.data ?? []).find((r) => r.type === rateType) ?? rates.data?.[0] ?? null
```

`selectedWallet` usa `selectedWalletId`, así que va **después** de la línea `const selectedWalletId = ...`.

- [ ] **Step 2: Renderizar los chips y el equivalente en ARS**

Insertar entre el bloque de "Monto" y el de "Descripción":

```tsx
      {currency !== 'ARS' && (rates.data ?? []).length > 0 ? (
        <>
          <Text style={styles.label}>Cotización</Text>
          <View style={styles.rowWrap}>
            {(rates.data ?? []).map((r) => (
              <Pressable
                key={r.id}
                style={[styles.chip, activeRate?.id === r.id && styles.chipActive]}
                onPress={() => setRateType(r.type)}
              >
                <Text
                  style={[styles.chipText, activeRate?.id === r.id && styles.chipTextActive]}
                >
                  {r.type} {Number(r.sell ?? r.value).toLocaleString('es-AR', {
                    maximumFractionDigits: 0,
                  })}
                </Text>
              </Pressable>
            ))}
          </View>
          {activeRate && Number(amount) > 0 ? (
            <Text style={styles.hint}>
              ≈ {formatAmount(Number(amount) * Number(activeRate.sell ?? activeRate.value), 'ARS')}
              {activeRate.source === 'db-fallback' || activeRate.source === 'stub'
                ? ' · cotización estimada'
                : ''}
            </Text>
          ) : null}
        </>
      ) : null}
```

Sumar el import `import { formatAmount } from '@/src/lib/format'` y el estilo:

```ts
  hint: {
    color: colors.muted,
    fontSize: 13,
  },
```

- [ ] **Step 3: Mandar el tipo elegido en el POST**

En el `body` de la mutación `create`, después de `date`:

```ts
          exchangeRateType: currency !== 'ARS' ? (activeRate?.type ?? undefined) : undefined,
```

- [ ] **Step 4: Chequear tipos y probar en el simulador**

```bash
cd mobile && npx tsc --noEmit
npx expo start --ios
```

Expected: con el backend corriendo (`docker compose up -d db` + `cd backend && npm run dev`), al elegir una billetera USD aparecen 3 chips de cotización; al escribir un monto aparece el equivalente en ARS; guardar devuelve 201.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(tabs\)/new-movement.tsx
git commit -m "feat(mobile): pick a rate and preview the ARS equivalent when adding a movement"
```

---

### Task 13: Cotización usada en la lista de movimientos

**Files:**
- Modify: `mobile/app/(tabs)/movements.tsx:122-147`

**Interfaces:**
- Consumes: `Movement.exchangeRate` (Task 11).
- Produces: subtítulo con tipo y valor del snapshot en items no-ARS.

- [ ] **Step 1: Agregar el subtítulo**

Dentro de `renderItem`, después de la línea de `clientSuffix`:

```ts
            const rate = item.currency !== 'ARS' ? item.exchangeRate : undefined
            const rateLabel = rate
              ? `${rate.type} ${Number(rate.sell ?? rate.value).toLocaleString('es-AR', {
                  maximumFractionDigits: 0,
                })}`
              : null
```

y debajo del `<Text style={styles.meta}>` existente:

```tsx
                  {rateLabel ? <Text style={styles.meta}>{rateLabel}</Text> : null}
```

- [ ] **Step 2: Chequear tipos y ver la lista**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. En el simulador, un movimiento en USD muestra `blue 1530` bajo la descripción; uno en ARS no muestra nada nuevo.

- [ ] **Step 3: Commit**

```bash
git add mobile/app/\(tabs\)/movements.tsx
git commit -m "feat(mobile): show the rate used on each movement"
```

---

### Task 14: Documentación y verificación end-to-end

**Files:**
- Modify: `.env.example`
- Modify: `README.md:82,86`
- Modify: `IMPLEMENTATION_PLAN.md` (fila 1 del roadmap)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Sumar las variables de FX a `.env.example`**

Agregar al final de `.env.example`:

```
# Cotizaciones (dolarapi + argentinadatos). FX_ENABLED=false apaga la red y usa fallback.
FX_BASE_URL=https://dolarapi.com/v1/dolares
FX_HISTORICAL_BASE_URL=https://api.argentinadatos.com/v1/cotizaciones/dolares
FX_TIMEOUT_MS=4000
FX_ENABLED=true
```

- [ ] **Step 2: Actualizar el README**

En `README.md:82`, reemplazar la descripción del endpoint:

```
| GET | `/exchange-rates?currency=USD&date=YYYY-MM-DD` | Cotización real (oficial/blue/mep/cripto) con caché y fallback |
```

En `README.md:86`, sacar `cotización real` de la lista de lo que queda fuera de alcance.

- [ ] **Step 3: Marcar la fase 1 en el roadmap**

En `IMPLEMENTATION_PLAN.md`, en la fila 1 de la tabla "Orden de ejecución", cambiar el título de la fase a `[Cotización real (dolarapi)](docs/superpowers/specs/01-cotizacion-real-dolarapi.md) ✅ implementada` y dejar el resto igual.

- [ ] **Step 4: Verificación completa**

```bash
docker compose up -d db
cd backend && npx prisma migrate dev && npm run db:seed && npm test
```

Expected: las dos migraciones aplican en orden, el seed imprime cotizaciones reales, la suite pasa entera.

Con el server arriba (`npm run dev`) y un token válido:

```bash
TOKEN=... # accessToken de POST /auth/login
curl -s "http://localhost:8000/exchange-rates?currency=USD" -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:8000/exchange-rates?currency=USD&date=2026-07-18" -H "Authorization: Bearer $TOKEN"
```

Expected: la primera con `"source":"dolarapi"` y valores cercanos al mercado; la segunda con `"source":"argentinadatos"` y blue ≈ 1530.

```bash
cd backend && FX_ENABLED=false npm run dev
curl -s "http://localhost:8000/exchange-rates?currency=USD&date=2026-01-15" -H "Authorization: Bearer $TOKEN"
```

Expected: `"source":"db-fallback"` o `"stub"`, nunca un 5xx.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md IMPLEMENTATION_PLAN.md
git commit -m "docs: document the live exchange-rate configuration"
```
