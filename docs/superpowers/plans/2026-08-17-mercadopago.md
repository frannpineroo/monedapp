# Integración Mercado Pago — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el usuario conecte su cuenta de Mercado Pago una vez y los pagos aprobados entren solos como movimientos (ingreso bruto + gasto de comisión) en una billetera "Mercado Pago" autoprovista, marcados para revisar, sin tocar el ledger a mano.

**Architecture:** OAuth `authorization_code` + PKCE con el **backend** como `redirect_uri` (MP exige HTTPS estático) y rebote al deep link `monedapp://`. Los tokens viajan cifrados con AES-256-GCM dentro del campo `credentials` de `Integration`, que hoy existe y no tiene ni un call site. Los webhooks se verifican con HMAC-SHA256 sobre un manifiesto (el body **no** se firma), se deduplican en `IntegrationWebhookEvent` y se procesan **sincrónicamente**: un error transitorio devuelve 500 y MP reintenta gratis. Todo el I/O de red pasa por `httpClient.fetch`, una costura mutable que los tests reemplazan.

**Tech Stack:** Node 22 (`fetch` y `crypto` nativos, cero dependencias nuevas) · Express 5 · TypeScript · Prisma 7 + PostgreSQL · Vitest + supertest · Expo SDK 57 (`expo-web-browser` y `expo-linking` ya instalados) + TanStack Query.

**Spec:** [docs/superpowers/specs/04-mercadopago.md](../specs/04-mercadopago.md)

**Rama:** `codex/f4-mercadopago`. Crear desde `main`. No reutilizar ramas de otras fases.

**Depende de:** nada bloqueante. Si la fase 1 ya está, los movimientos de MP heredan cotización real sin tocar código (siguen pidiendo `'blue'`). Si la fase 3 ya está, la comisión debería apuntar a "Comisiones bancarias" en vez de al default de gastos — anotado en la Task 10.

**Bloqueo conocido:** no hay URL HTTPS pública todavía, así que MP no puede llegar al callback ni al webhook. Todo se construye y se verifica con requests sintéticos firmados; el smoke real contra el sandbox de MP queda como Task 18, diferida.

## Global Constraints

- **Nunca** commitear `.env` ni `backend/.env` (ya están gitigonorados — verificar antes de cada commit). Las credenciales de MP no van a ningún log.
- `Integration.credentials` guarda **ciphertext** AES-256-GCM de `{accessToken, refreshToken, publicKey, scope, liveMode}`, formato `v1.<iv>.<tag>.<ct>`. `serializeIntegration` **nunca** emite `credentials`.
- Validación de env **lazy, por getter** (estilo `backend/src/lib/jwt.ts:4-7`): validar en el arranque rompería `npm test` y `npm run dev` para cualquiera que no tenga MP configurado.
- `redirect_uri` tiene que ser **byte-exacto** contra el registrado en MP. `monedapp://` no se le pasa nunca a MP: el backend redirige al deep link después.
- El `refresh_token` de MP **rota en cada refresh**: hay que persistir el nuevo o la conexión se muere.
- El body del webhook **no está firmado**: la firma cubre `id:{data.id};request-id:{x-request-id};ts:{ts};` con `data.id` **en minúsculas** tomado del **query string**, y los pares ausentes se **omiten** del manifiesto (no quedan vacíos). No hace falta `express.raw`.
- `timingSafeEqual` **tira** si los buffers miden distinto: chequear largo antes de comparar.
- Contrato de entrega de MP: responder 200/201 en menos de 22s. Firma inválida → 401. Evento desconocido o sin integración → **200** (un 4xx haría que MP reintente días un evento que nunca va a matchear). Falla transitoria → **500**, que es un reintento gratis.
- Idempotencia: `IntegrationWebhookEvent @@unique([provider, notificationId])` para reentregas, `Movement @@unique([userId, externalProvider, externalId])` para el mismo pago por dos vías. El `P2002` de ese índice se trata como **éxito**.
- Un reembolso o contracargo **nunca** modifica ni borra el movimiento original (borrarlo cascadearía sus `LedgerEntry`): se postea un asiento compensatorio.
- **Fecha**: MP devuelve `…T22:30:00.000-03:00`. Copiar `parseDate` de `movements.ts` (que usa `getUTCFullYear/Month/Date`) manda **todo pago de la tarde al día siguiente**. `argentineBusinessDate` resta 3h antes de truncar. Tiene test propio obligatorio.
- Montos redondeados a 2 decimales **antes** de construir el `Prisma.Decimal` (`assertBalanced` compara con aritmética float; el redondeo previo lo mantiene sano).
- Estilo del backend: rutas llaman a prisma directo, reglas en `src/services/`, validación inline tirando `AppError(400, 'mensaje en español')`, `asyncHandler` en cada handler. Sin librerías de validación.
- Estilo de la app: `useQuery`/`useMutation` inline en la pantalla, `StyleSheet.create` por pantalla con `colors` de `mobile/src/theme.ts`. **Sin dependencias nuevas**: `expo-web-browser` y `expo-linking` ya están instalados y `expo.scheme` ya es `"monedapp"`.
- Antes de escribir código de Expo, leer los docs versionados: https://docs.expo.dev/versions/v57.0.0/ (lo pide `mobile/AGENTS.md`).
- La app no tiene suite de tests: las tasks de mobile se verifican con `npx tsc --noEmit` más una pasada manual.
- **Commits en inglés**, formato `tipo: mensaje` (`feat:`, `fix:`, `test:`, `docs:`), como todo el historial del repo. `.cursor/rules/push-after-task.mdc` además pide commitear y pushear al terminar cada task, sin esperar que lo pidan.

---

### Task 1: Schema y migración de integraciones

**Files:**
- Modify: `backend/prisma/schema.prisma` (models `Movement`, `Wallet`, `Integration` + dos models nuevos)
- Create: `backend/prisma/migrations/<timestamp>_add_mercadopago_integration/migration.sql`
- Create: `backend/tests/integrationsMercadoPago.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `Movement.externalProvider/externalId/externalStatus/externalUpdatedAt/needsReview`, `Wallet.externalProvider`, `Integration.externalAccountId/tokenExpiresAt/lastError/lastWebhookAt`, y los models `IntegrationOAuthState` e `IntegrationWebhookEvent`. Los consumen todas las tasks siguientes.

- [ ] **Step 1: Levantar la DB y escribir el test que falla**

```bash
docker compose up -d db
```

Crear `backend/tests/integrationsMercadoPago.test.ts`:

```ts
import 'dotenv/config'

// Antes de importar createApp: los getters de env son lazy pero los tests necesitan valores.
process.env.MP_CLIENT_ID ??= 'test-client-id'
process.env.MP_CLIENT_SECRET ??= 'test-client-secret'
process.env.MP_REDIRECT_URI ??= 'https://monedapp.test/integrations/mercadopago/callback'
process.env.MP_WEBHOOK_SECRET ??= 'test-secret'
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/prisma/prisma'

const app = createApp()

function uniqueEmail() {
  return `mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
}

export async function registerAndOnboard() {
  const registered = await request(app)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: 'password123' })
  const token = registered.body.accessToken as string
  const userId = (
    await prisma.user.findUniqueOrThrow({ where: { email: registered.body.user.email } })
  ).id

  await request(app)
    .post('/users/me/onboarding')
    .set('Authorization', `Bearer ${token}`)
    .send({ templateId: 'freelancer_software' })

  return { token, userId }
}

describe('schema de integraciones', () => {
  it('el índice de dedupe rechaza dos movimientos con el mismo externalId', async () => {
    const { userId, token } = await registerAndOnboard()
    const wallets = await request(app).get('/wallets').set('Authorization', `Bearer ${token}`)
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { id: (wallets.body as { id: string }[])[0].id },
    })
    // No se puede asumir que la tabla de cotizaciones tenga filas: el service las crea.
    const { resolveExchangeRateId } = await import('../src/services/exchangeRateService')
    const exchangeRateId = await resolveExchangeRateId(wallet.currency, new Date(Date.UTC(2026, 7, 14)))

    const base = {
      userId,
      walletId: wallet.id,
      type: 'income' as const,
      amount: 1000,
      currency: wallet.currency,
      exchangeRateId,
      description: 'Cobro MP',
      date: new Date(Date.UTC(2026, 7, 14)),
      externalProvider: 'mercadopago',
      externalId: 'dedupe-1',
      needsReview: true,
    }

    await prisma.movement.create({ data: base })
    await expect(prisma.movement.create({ data: base })).rejects.toMatchObject({ code: 'P2002' })
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: FAIL — `externalProvider` no existe en `MovementCreateInput`.

- [ ] **Step 3: Escribir el schema**

En `backend/prisma/schema.prisma`, en `model Movement` agregar los campos y los índices:

```prisma
  externalProvider  String?
  externalId        String?
  externalStatus    String?
  externalUpdatedAt DateTime?
  needsReview       Boolean   @default(false)

  @@unique([userId, externalProvider, externalId])
  @@index([userId, needsReview])
```

En `model Wallet`:

```prisma
  externalProvider String?

  @@unique([userId, externalProvider, currency])
```

En `model Integration`:

```prisma
  externalAccountId String?
  tokenExpiresAt    DateTime?
  lastError         String?
  lastWebhookAt     DateTime?

  @@unique([provider, externalAccountId])
```

Y los dos models nuevos, al final del archivo:

```prisma
model IntegrationOAuthState {
  id                String    @id @default(cuid())
  userId            String
  provider          String
  state             String    @unique
  codeVerifier      String
  mobileRedirectUri String
  expiresAt         DateTime
  consumedAt        DateTime?
  createdAt         DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("integration_oauth_states")
}

model IntegrationWebhookEvent {
  id             String   @id @default(cuid())
  provider       String
  notificationId String
  resourceId     String?
  status         String   @default("received")
  error          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([provider, notificationId])
  @@index([provider, status])
  @@map("integration_webhook_events")
}
```

En `model User`, sumar la back-relation:

```prisma
  oauthStates IntegrationOAuthState[]
```

- [ ] **Step 4: Generar la migración y revisar el SQL antes de aplicarla**

```bash
cd backend && npx prisma migrate dev --create-only --name add_mercadopago_integration
```

**Leer el SQL generado y buscar cualquier `DROP`.** Todos los campos son nullable o tienen default, así que no debería haber ninguno; si aparece, parar y revisar el schema. Nunca usar `db:push` (haría drift de `migration_lock.toml`).

```bash
npx prisma migrate dev
npx prisma generate
```

- [ ] **Step 5: Correr el test y el typecheck**

Run: `cd backend && npx tsc --noEmit && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: PASS.

Nota sobre `NULL`: en Postgres los `NULL` son distintos entre sí en un índice único, así que los movimientos manuales (con `externalProvider = NULL`) no colisionan nunca entre ellos.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/tests/integrationsMercadoPago.test.ts
git commit -m "feat: add integration schema for external payment providers"
```

---

### Task 2: Config de env y cifrado de credenciales

**Files:**
- Create: `backend/src/lib/env.ts`
- Create: `backend/src/lib/crypto.ts`
- Create: `backend/tests/crypto.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `AppError`.
- Produces:
  - `requiredEnv(name): string`, `mpConfig(): { clientId, clientSecret, redirectUri, webhookSecret, authBaseUrl, apiBaseUrl }`, `integrationsEncryptionKey(): Buffer`, `mobileDeepLinkScheme(): string`
  - `encryptSecret(plain: string): string`, `decryptSecret(payload: string): string`

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/crypto.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
})

describe('crypto de credenciales', () => {
  it('roundtrip', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/lib/crypto')
    const payload = JSON.stringify({ accessToken: 'APP_USR-123', refreshToken: 'TG-456' })

    expect(decryptSecret(encryptSecret(payload))).toBe(payload)
  })

  it('dos cifrados del mismo texto dan ciphertext distinto', async () => {
    const { encryptSecret } = await import('../src/lib/crypto')

    expect(encryptSecret('hola')).not.toBe(encryptSecret('hola'))
  })

  it('un tag manipulado no descifra', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/lib/crypto')
    const [version, iv, tag, ct] = encryptSecret('hola').split('.')
    const brokenTag = tag.slice(0, -2) + (tag.endsWith('AA') ? 'BB' : 'AA')

    expect(() => decryptSecret([version, iv, brokenTag, ct].join('.'))).toThrow()
  })

  it('una clave que no decodifica a 32 bytes es error de configuración', async () => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.from('corta').toString('base64')
    const { encryptSecret } = await import('../src/lib/crypto')

    expect(() => encryptSecret('hola')).toThrow(/32 bytes/)

    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/crypto.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/crypto'`.

- [ ] **Step 3: Escribir `env.ts`**

Crear `backend/src/lib/env.ts`:

```ts
import { AppError } from './errors'

/** Lazy a propósito: validar en el boot rompería `npm test` y `npm run dev` sin MP configurado. */
export function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new AppError(500, `Falta la variable de entorno ${name}`)
  }
  return value
}

export function mpConfig() {
  return {
    clientId: requiredEnv('MP_CLIENT_ID'),
    clientSecret: requiredEnv('MP_CLIENT_SECRET'),
    redirectUri: requiredEnv('MP_REDIRECT_URI'),
    webhookSecret: requiredEnv('MP_WEBHOOK_SECRET'),
    authBaseUrl: process.env.MP_AUTH_BASE_URL || 'https://auth.mercadopago.com.ar',
    apiBaseUrl: process.env.MP_API_BASE_URL || 'https://api.mercadopago.com',
  }
}

export function integrationsEncryptionKey(): Buffer {
  const key = Buffer.from(requiredEnv('INTEGRATIONS_ENCRYPTION_KEY'), 'base64')
  if (key.length !== 32) {
    throw new AppError(500, 'INTEGRATIONS_ENCRYPTION_KEY debe decodificar a 32 bytes')
  }
  return key
}

export function mobileDeepLinkScheme(): string {
  return process.env.MOBILE_DEEP_LINK_SCHEME || 'monedapp'
}
```

- [ ] **Step 4: Escribir `crypto.ts`**

Crear `backend/src/lib/crypto.ts`:

```ts
import crypto from 'crypto'
import { AppError } from './errors'
import { integrationsEncryptionKey } from './env'

/** Formato `v1.<iv>.<tag>.<ct>`: el prefijo reserva un camino de rotación de clave. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', integrationsEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])

  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split('.')
  if (version !== 'v1' || !iv || !tag || !ciphertext) {
    throw new AppError(500, 'Credencial con formato inválido')
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    integrationsEncryptionKey(),
    Buffer.from(iv, 'base64url')
  )
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
```

- [ ] **Step 5: Documentar las variables**

Agregar al final de `.env.example`:

```
# Mercado Pago (ver README para el alta de la aplicación)
MP_CLIENT_ID=
MP_CLIENT_SECRET=
MP_REDIRECT_URI=https://<host-publico>/integrations/mercadopago/callback
MP_WEBHOOK_SECRET=
MP_AUTH_BASE_URL=https://auth.mercadopago.com.ar
MP_API_BASE_URL=https://api.mercadopago.com
# openssl rand -base64 32 — tiene que decodificar a exactamente 32 bytes
INTEGRATIONS_ENCRYPTION_KEY=
MOBILE_DEEP_LINK_SCHEME=monedapp
```

Confirmar que `.env` y `backend/.env` siguen ignorados:

```bash
git check-ignore -v .env backend/.env
```

- [ ] **Step 6: Correr el test**

Run: `cd backend && npx vitest run tests/crypto.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/env.ts backend/src/lib/crypto.ts backend/tests/crypto.test.ts .env.example
git commit -m "feat: add lazy env config and AES-256-GCM credential encryption"
```

---

### Task 3: Cliente HTTP con reintentos

**Files:**
- Create: `backend/src/lib/httpClient.ts`
- Create: `backend/tests/httpClient.test.ts`

**Interfaces:**
- Consumes: `fetch` global de Node 22.
- Produces:
  - `class HttpError extends Error { status: number; body: unknown }`
  - `export const httpClient = { fetch }` — **costura mutable**: los tests la reemplazan en `beforeEach` y la restauran en `afterEach`. Es preferible a `vi.stubGlobal` porque sobrevive a capturas en tiempo de import.
  - `requestJson<T>(url, init?): Promise<T>` — timeout 10s, reintenta red/429/5xx con backoff, nunca en otros 4xx.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/httpClient.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError, httpClient, requestJson } from '../src/lib/httpClient'

const realFetch = httpClient.fetch

afterEach(() => {
  httpClient.fetch = realFetch
})

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('requestJson', () => {
  it('devuelve el JSON parseado', async () => {
    httpClient.fetch = vi.fn(async () => jsonResponse(200, { id: 1 })) as typeof fetch

    expect(await requestJson<{ id: number }>('https://mp.test/x')).toEqual({ id: 1 })
  })

  it('reintenta un 500 y devuelve el 200 siguiente', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    httpClient.fetch = fetchMock as unknown as typeof fetch

    expect(await requestJson('https://mp.test/x', { retryDelayMs: 0 })).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('no reintenta un 400 y tira HttpError con el body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(400, { message: 'invalid_grant' }))
    httpClient.fetch = fetchMock as unknown as typeof fetch

    await expect(requestJson('https://mp.test/x', { retryDelayMs: 0 })).rejects.toMatchObject({
      status: 400,
      body: { message: 'invalid_grant' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('agota los reintentos y propaga el último HttpError', async () => {
    httpClient.fetch = vi.fn(async () => jsonResponse(503, {})) as unknown as typeof fetch

    await expect(
      requestJson('https://mp.test/x', { retries: 1, retryDelayMs: 0 })
    ).rejects.toBeInstanceOf(HttpError)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/httpClient.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/httpClient'`.

- [ ] **Step 3: Implementar**

Crear `backend/src/lib/httpClient.ts`:

```ts
export class HttpError extends Error {
  constructor(
    public status: number,
    public body: unknown
  ) {
    super(`HTTP ${status}`)
    this.name = 'HttpError'
  }
}

/** Costura de test: los tests reemplazan `httpClient.fetch` en vez de pisar el global. */
export const httpClient = {
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
}

type RequestOptions = RequestInit & {
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
}

function isRetriable(status: number): boolean {
  return status === 429 || status >= 500
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 10_000, retries = 2, retryDelayMs = 500, ...init } = options
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await httpClient.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      })

      const text = await res.text()
      let body: unknown = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }

      if (res.ok) return body as T
      const error = new HttpError(res.status, body)
      if (!isRetriable(res.status)) throw error
      lastError = error
    } catch (error) {
      // Un 4xx no se reintenta nunca; los errores de red sí.
      if (error instanceof HttpError && !isRetriable(error.status)) throw error
      lastError = error
    }

    if (attempt < retries) {
      // Backoff con jitter, para no sincronizar reintentos entre usuarios.
      await sleep(retryDelayMs * 2 ** attempt + Math.floor(Math.random() * 100))
    }
  }

  throw lastError
}
```

- [ ] **Step 4: Correr el test**

Run: `cd backend && npx vitest run tests/httpClient.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/httpClient.ts backend/tests/httpClient.test.ts
git commit -m "feat: add retrying JSON http client with a test seam"
```

---

### Task 4: Verificación de firma del webhook

**Files:**
- Create: `backend/src/services/mercadopago/mpSignature.ts`
- Create: `backend/tests/mpSignature.test.ts`

**Interfaces:**
- Consumes: `crypto` de Node.
- Produces:
  - `buildManifest({ dataId?, requestId?, ts }): string`
  - `verifyWebhookSignature({ xSignature?, xRequestId?, dataId?, secret }): boolean`

- [ ] **Step 1: Escribir el test que falla**

Los vectores de abajo están calculados con `HMAC-SHA256('test-secret', manifiesto)` y son fijos: si el manifiesto cambia, el test rompe, que es exactamente lo que se quiere.

Crear `backend/tests/mpSignature.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildManifest, verifyWebhookSignature } from '../src/services/mercadopago/mpSignature'

const SECRET = 'test-secret'
const TS = '1704908010'
const REQUEST_ID = 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e'
const DATA_ID = '999999999'
const V1 = 'ded680a0c0854e6bb7f4a0a6b627d3e19f1e026b10cdde213c47a4c748d78841'
const V1_SIN_REQUEST_ID = 'a9169cce8d061b7fdc681944c4ace922f52dbe87cdc87e7ebad98b6d1997f159'

describe('mpSignature', () => {
  it('arma el manifiesto con el template exacto de MP', () => {
    expect(buildManifest({ dataId: DATA_ID, requestId: REQUEST_ID, ts: TS })).toBe(
      `id:${DATA_ID};request-id:${REQUEST_ID};ts:${TS};`
    )
  })

  it('omite los pares ausentes en vez de dejarlos vacíos', () => {
    expect(buildManifest({ dataId: DATA_ID, ts: TS })).toBe(`id:${DATA_ID};ts:${TS};`)
  })

  it('firma válida → true', () => {
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=${V1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      })
    ).toBe(true)
  })

  it('data.id en mayúsculas se normaliza y sigue validando', () => {
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=${V1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID.toUpperCase(),
        secret: SECRET,
      })
    ).toBe(true)
  })

  it('sin x-request-id usa el manifiesto corto', () => {
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=${V1_SIN_REQUEST_ID}`,
        dataId: DATA_ID,
        secret: SECRET,
      })
    ).toBe(true)
  })

  it('secreto equivocado → false', () => {
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=${V1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: 'otro-secreto',
      })
    ).toBe(false)
  })

  it('v1 de largo distinto devuelve false en vez de tirar', () => {
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=abc`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      })
    ).toBe(false)
  })

  it('header ausente o sin ts → false', () => {
    expect(verifyWebhookSignature({ dataId: DATA_ID, secret: SECRET })).toBe(false)
    expect(
      verifyWebhookSignature({ xSignature: `v1=${V1}`, dataId: DATA_ID, secret: SECRET })
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/mpSignature.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

Crear `backend/src/services/mercadopago/mpSignature.ts`:

```ts
import crypto from 'crypto'

/** Template verbatim de MP: los pares ausentes se omiten, no quedan vacíos. */
export function buildManifest(parts: { dataId?: string; requestId?: string; ts: string }): string {
  const segments: string[] = []
  if (parts.dataId) segments.push(`id:${parts.dataId.toLowerCase()};`)
  if (parts.requestId) segments.push(`request-id:${parts.requestId};`)
  segments.push(`ts:${parts.ts};`)
  return segments.join('')
}

function parseSignatureHeader(header: string): Map<string, string> {
  const pairs = new Map<string, string>()
  for (const chunk of header.split(',')) {
    const [key, ...rest] = chunk.trim().split('=')
    if (key && rest.length > 0) pairs.set(key.trim(), rest.join('=').trim())
  }
  return pairs
}

export function verifyWebhookSignature(input: {
  xSignature?: string
  xRequestId?: string
  dataId?: string
  secret: string
}): boolean {
  if (!input.xSignature) return false

  const pairs = parseSignatureHeader(input.xSignature)
  const ts = pairs.get('ts')
  const v1 = pairs.get('v1')
  if (!ts || !v1) return false

  const manifest = buildManifest({ dataId: input.dataId, requestId: input.xRequestId, ts })
  const expected = crypto.createHmac('sha256', input.secret).update(manifest).digest('hex')

  // timingSafeEqual tira si los largos difieren: chequear antes.
  if (expected.length !== v1.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
}
```

- [ ] **Step 4: Correr el test**

Run: `cd backend && npx vitest run tests/mpSignature.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/mercadopago/mpSignature.ts backend/tests/mpSignature.test.ts
git commit -m "feat: verify Mercado Pago webhook signatures"
```

---

### Task 5: Mapeo de pagos a movimientos

**Files:**
- Create: `backend/src/services/mercadopago/mpPaymentMapper.ts`
- Create: `backend/tests/mpPaymentMapper.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro, cero I/O).
- Produces:
  - `argentineBusinessDate(iso: string): Date`
  - `type MpPayment` y `type MpOutcome = { kind: 'post'; movements: MappedMovement[] } | { kind: 'reverse'; movements: MappedMovement[] } | { kind: 'skip'; reason: string } | { kind: 'unsupported_currency'; currency: string }`
  - `type MappedMovement = { externalId: string; type: 'income' | 'expense'; amount: number; currency: 'ARS' | 'USD'; description: string; date: Date; needsReview: boolean }`
  - `mapPaymentToOutcome(payment: MpPayment): MpOutcome`

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/mpPaymentMapper.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  argentineBusinessDate,
  mapPaymentToOutcome,
  type MpPayment,
} from '../src/services/mercadopago/mpPaymentMapper'

function payment(overrides: Partial<MpPayment> = {}): MpPayment {
  return {
    id: 123456789,
    status: 'approved',
    status_detail: 'accredited',
    transaction_amount: 10000,
    transaction_amount_refunded: 0,
    transaction_details: { net_received_amount: 9310 },
    currency_id: 'ARS',
    date_approved: '2026-08-14T22:30:00.000-03:00',
    date_last_updated: '2026-08-14T22:31:00.000-03:00',
    collector_id: 555,
    description: 'Pago servicio',
    external_reference: null,
    ...overrides,
  }
}

describe('argentineBusinessDate', () => {
  it('un pago de la noche no se corre al día siguiente', () => {
    expect(argentineBusinessDate('2026-08-14T22:30:00.000-03:00').toISOString()).toBe(
      '2026-08-14T00:00:00.000Z'
    )
  })

  it('un pago de la mañana queda en su día', () => {
    expect(argentineBusinessDate('2026-08-14T09:15:00.000-03:00').toISOString()).toBe(
      '2026-08-14T00:00:00.000Z'
    )
  })
})

describe('mapPaymentToOutcome', () => {
  it('approved sin reembolso → ingreso bruto + gasto de comisión', () => {
    const outcome = mapPaymentToOutcome(payment())

    expect(outcome.kind).toBe('post')
    if (outcome.kind !== 'post') return

    const [income, fee] = outcome.movements
    expect(income).toMatchObject({
      externalId: '123456789',
      type: 'income',
      amount: 10000,
      currency: 'ARS',
      description: 'Pago servicio',
      needsReview: true,
    })
    expect(fee).toMatchObject({
      externalId: '123456789:fee',
      type: 'expense',
      amount: 690,
      description: 'Comisión Mercado Pago',
      needsReview: false,
    })
  })

  it('sin comisión no emite el segundo movimiento', () => {
    const outcome = mapPaymentToOutcome(
      payment({ transaction_details: { net_received_amount: 10000 } })
    )

    expect(outcome.kind).toBe('post')
    if (outcome.kind !== 'post') return
    expect(outcome.movements).toHaveLength(1)
  })

  it('sin descripción cae a external_reference y después al default', () => {
    const conRef = mapPaymentToOutcome(
      payment({ description: null, external_reference: 'FACTURA-9' })
    )
    const sinNada = mapPaymentToOutcome(payment({ description: '  ', external_reference: null }))

    expect(conRef.kind === 'post' && conRef.movements[0].description).toBe('FACTURA-9')
    expect(sinNada.kind === 'post' && sinNada.movements[0].description).toBe('Cobro Mercado Pago')
  })

  it('refunded → asiento compensatorio', () => {
    const outcome = mapPaymentToOutcome(
      payment({ status: 'refunded', transaction_amount_refunded: 10000 })
    )

    expect(outcome.kind).toBe('reverse')
    if (outcome.kind !== 'reverse') return
    expect(outcome.movements[0]).toMatchObject({
      externalId: '123456789:reversal',
      type: 'expense',
      amount: 10000,
      description: 'Reembolso Mercado Pago',
      needsReview: true,
    })
  })

  it('charged_back usa su propia descripción', () => {
    const outcome = mapPaymentToOutcome(
      payment({ status: 'charged_back', transaction_amount_refunded: 10000 })
    )

    expect(outcome.kind === 'reverse' && outcome.movements[0].description).toBe(
      'Contracargo Mercado Pago'
    )
  })

  it('approved con reembolso parcial postea y revierte la diferencia', () => {
    const outcome = mapPaymentToOutcome(payment({ transaction_amount_refunded: 2500 }))

    expect(outcome.kind).toBe('post')
    if (outcome.kind !== 'post') return
    const reversal = outcome.movements.find((m) => m.externalId.endsWith(':reversal'))
    expect(reversal).toMatchObject({ type: 'expense', amount: 2500 })
  })

  it.each(['pending', 'in_process', 'authorized', 'in_mediation', 'rejected', 'cancelled'])(
    '%s → skip',
    (status) => {
      expect(mapPaymentToOutcome(payment({ status })).kind).toBe('skip')
    }
  )

  it('moneda no soportada no se postea', () => {
    const outcome = mapPaymentToOutcome(payment({ currency_id: 'BRL' }))

    expect(outcome).toEqual({ kind: 'unsupported_currency', currency: 'BRL' })
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/mpPaymentMapper.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

Crear `backend/src/services/mercadopago/mpPaymentMapper.ts`:

```ts
export type MpPayment = {
  id: number | string
  status: string
  status_detail?: string | null
  transaction_amount: number
  transaction_amount_refunded?: number | null
  transaction_details?: { net_received_amount?: number | null } | null
  currency_id: string
  date_approved?: string | null
  date_last_updated?: string | null
  collector_id?: number | string | null
  description?: string | null
  external_reference?: string | null
}

export type MappedMovement = {
  externalId: string
  type: 'income' | 'expense'
  amount: number
  currency: 'ARS' | 'USD'
  description: string
  date: Date
  needsReview: boolean
}

export type MpOutcome =
  | { kind: 'post'; movements: MappedMovement[] }
  | { kind: 'reverse'; movements: MappedMovement[] }
  | { kind: 'skip'; reason: string }
  | { kind: 'unsupported_currency'; currency: string }

const REVERSED_STATUSES = new Set(['refunded', 'charged_back'])

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * MP devuelve `…T22:30:00.000-03:00`. Truncar en UTC mandaría todo pago de la tarde
 * al día siguiente: se resta el offset de Buenos Aires antes de truncar.
 */
export function argentineBusinessDate(iso: string): Date {
  const instant = new Date(iso)
  const local = new Date(instant.getTime() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()))
}

function describe(payment: MpPayment): string {
  return payment.description?.trim() || payment.external_reference?.trim() || 'Cobro Mercado Pago'
}

export function mapPaymentToOutcome(payment: MpPayment): MpOutcome {
  if (payment.currency_id !== 'ARS' && payment.currency_id !== 'USD') {
    return { kind: 'unsupported_currency', currency: payment.currency_id }
  }

  const currency = payment.currency_id
  const externalId = String(payment.id)
  const date = argentineBusinessDate(
    payment.date_approved ?? payment.date_last_updated ?? new Date().toISOString()
  )
  const refunded = round2(Number(payment.transaction_amount_refunded ?? 0))

  if (REVERSED_STATUSES.has(payment.status)) {
    return {
      kind: 'reverse',
      movements: [
        {
          externalId: `${externalId}:reversal`,
          type: 'expense',
          amount: refunded > 0 ? refunded : round2(payment.transaction_amount),
          currency,
          description:
            payment.status === 'charged_back'
              ? 'Contracargo Mercado Pago'
              : 'Reembolso Mercado Pago',
          date,
          needsReview: true,
        },
      ],
    }
  }

  if (payment.status !== 'approved') {
    return { kind: 'skip', reason: payment.status }
  }

  const gross = round2(payment.transaction_amount)
  const net = round2(Number(payment.transaction_details?.net_received_amount ?? gross))
  const fee = round2(gross - net)

  const movements: MappedMovement[] = [
    {
      externalId,
      type: 'income',
      amount: gross,
      currency,
      description: describe(payment),
      date,
      needsReview: true,
    },
  ]

  if (fee > 0) {
    movements.push({
      externalId: `${externalId}:fee`,
      type: 'expense',
      amount: fee,
      currency,
      description: 'Comisión Mercado Pago',
      date,
      needsReview: false,
    })
  }

  if (refunded > 0) {
    movements.push({
      externalId: `${externalId}:reversal`,
      type: 'expense',
      amount: refunded,
      currency,
      description: 'Reembolso Mercado Pago',
      date,
      needsReview: true,
    })
  }

  return { kind: 'post', movements }
}
```

- [ ] **Step 4: Correr el test**

Run: `cd backend && npx vitest run tests/mpPaymentMapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/mercadopago/mpPaymentMapper.ts backend/tests/mpPaymentMapper.test.ts
git commit -m "feat: map Mercado Pago payments to movements"
```

---

### Task 6: Cliente de la API de Mercado Pago

**Files:**
- Create: `backend/src/services/mercadopago/mpClient.ts`
- Create: `backend/tests/helpers/mpFixtures.ts`
- Create: `backend/tests/mpClient.test.ts`

**Interfaces:**
- Consumes: `requestJson`/`httpClient` (Task 3), `mpConfig` (Task 2).
- Produces:
  - `buildAuthorizationUrl({ state, codeChallenge }): string`
  - `exchangeAuthorizationCode({ code, codeVerifier }): Promise<MpTokenResponse>`
  - `refreshAccessToken(refreshToken): Promise<MpTokenResponse>`
  - `getPayment(accessToken, paymentId): Promise<MpPayment>`
  - `searchPayments(accessToken, { from, to, offset }): Promise<{ results: MpPayment[]; paging: { total: number } }>`
  - Fixtures `approvedPayment`, `refundedPayment`, `pendingPayment`, `tokenResponse`, `fakeMpFetch` para las tasks 9-13.

- [ ] **Step 1: Escribir las fixtures y el test que falla**

Crear `backend/tests/helpers/mpFixtures.ts`:

```ts
import type { MpPayment } from '../../src/services/mercadopago/mpPaymentMapper'

export const tokenResponse = {
  access_token: 'APP_USR-access-token',
  refresh_token: 'TG-refresh-token',
  expires_in: 15_552_000,
  user_id: 987654321,
  public_key: 'APP_USR-public-key',
  scope: 'offline_access read write',
  live_mode: false,
}

export function approvedPayment(overrides: Partial<MpPayment> = {}): MpPayment {
  return {
    id: 111111111,
    status: 'approved',
    status_detail: 'accredited',
    transaction_amount: 10000,
    transaction_amount_refunded: 0,
    transaction_details: { net_received_amount: 9310 },
    currency_id: 'ARS',
    date_approved: '2026-08-14T10:00:00.000-03:00',
    date_last_updated: '2026-08-14T10:01:00.000-03:00',
    collector_id: 987654321,
    description: 'Pago servicio',
    external_reference: null,
    ...overrides,
  }
}

export function refundedPayment(overrides: Partial<MpPayment> = {}): MpPayment {
  return approvedPayment({
    status: 'refunded',
    transaction_amount_refunded: 10000,
    date_last_updated: '2026-08-15T10:00:00.000-03:00',
    ...overrides,
  })
}

export function pendingPayment(overrides: Partial<MpPayment> = {}): MpPayment {
  return approvedPayment({ status: 'pending', ...overrides })
}

/** Rutea por URL: token, payment por id, search. Devuelve 404 para lo que no conoce. */
export function fakeMpFetch(routes: {
  token?: unknown
  payments?: Record<string, MpPayment>
  search?: MpPayment[]
}) {
  const calls: { url: string; init?: RequestInit }[] = []

  const fetchImpl = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })

    const respond = (status: number, body: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
      }) as unknown as Response

    if (url.includes('/oauth/token')) return respond(200, routes.token ?? tokenResponse)

    if (url.includes('/v1/payments/search')) {
      const results = routes.search ?? []
      return respond(200, { results, paging: { total: results.length } })
    }

    const match = url.match(/\/v1\/payments\/(\d+)/)
    if (match && routes.payments?.[match[1]]) {
      return respond(200, routes.payments[match[1]])
    }

    return respond(404, { message: 'not_found' })
  }

  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}
```

Crear `backend/tests/mpClient.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { httpClient } from '../src/lib/httpClient'
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  getPayment,
  searchPayments,
} from '../src/services/mercadopago/mpClient'
import { approvedPayment, fakeMpFetch } from './helpers/mpFixtures'

const realFetch = httpClient.fetch

beforeEach(() => {
  process.env.MP_CLIENT_ID = 'test-client-id'
  process.env.MP_CLIENT_SECRET = 'test-client-secret'
  process.env.MP_REDIRECT_URI = 'https://monedapp.test/integrations/mercadopago/callback'
  process.env.MP_WEBHOOK_SECRET = 'test-secret'
  process.env.MP_API_BASE_URL = 'https://api.mp.test'
  process.env.MP_AUTH_BASE_URL = 'https://auth.mp.test'
})

afterEach(() => {
  httpClient.fetch = realFetch
})

describe('mpClient', () => {
  it('la URL de autorización lleva PKCE y el redirect registrado', () => {
    const url = new URL(buildAuthorizationUrl({ state: 'st-1', codeChallenge: 'ch-1' }))

    expect(url.origin + url.pathname).toBe('https://auth.mp.test/authorization')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('platform_id')).toBe('mp')
    expect(url.searchParams.get('state')).toBe('st-1')
    expect(url.searchParams.get('code_challenge')).toBe('ch-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://monedapp.test/integrations/mercadopago/callback'
    )
  })

  it('el intercambio manda el body exacto de MP', async () => {
    const fake = fakeMpFetch({})
    httpClient.fetch = fake.fetchImpl

    const tokens = await exchangeAuthorizationCode({ code: 'code-1', codeVerifier: 'verifier-1' })

    expect(tokens.access_token).toBe('APP_USR-access-token')
    const call = fake.calls[0]
    expect(call.url).toBe('https://api.mp.test/oauth/token')
    expect(JSON.parse(String(call.init?.body))).toEqual({
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'https://monedapp.test/integrations/mercadopago/callback',
      code_verifier: 'verifier-1',
    })
  })

  it('getPayment pega al recurso con el bearer', async () => {
    const fake = fakeMpFetch({ payments: { '111111111': approvedPayment() } })
    httpClient.fetch = fake.fetchImpl

    const payment = await getPayment('APP_USR-access-token', '111111111')

    expect(payment.id).toBe(111111111)
    expect(fake.calls[0].url).toBe('https://api.mp.test/v1/payments/111111111')
  })

  it('searchPayments manda sort, que MP exige', async () => {
    const fake = fakeMpFetch({ search: [approvedPayment()] })
    httpClient.fetch = fake.fetchImpl

    const from = new Date(Date.UTC(2026, 6, 1))
    const to = new Date(Date.UTC(2026, 7, 1))
    const page = await searchPayments('APP_USR-access-token', { from, to, offset: 0 })

    expect(page.results).toHaveLength(1)
    const url = new URL(fake.calls[0].url)
    expect(url.searchParams.get('sort')).toBe('date_created')
    expect(url.searchParams.get('criteria')).toBe('desc')
    expect(url.searchParams.get('range')).toBe('date_created')
    expect(url.searchParams.get('limit')).toBe('50')
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/mpClient.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

Crear `backend/src/services/mercadopago/mpClient.ts`:

```ts
import { mpConfig } from '../../lib/env'
import { requestJson } from '../../lib/httpClient'
import type { MpPayment } from './mpPaymentMapper'

export type MpTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  user_id: number | string
  public_key?: string | null
  scope?: string | null
  live_mode?: boolean | null
}

export function buildAuthorizationUrl(params: { state: string; codeChallenge: string }): string {
  const { clientId, redirectUri, authBaseUrl } = mpConfig()
  const url = new URL('/authorization', authBaseUrl)

  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('platform_id', 'mp')
  url.searchParams.set('state', params.state)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')

  return url.toString()
}

function tokenRequest(body: Record<string, string>): Promise<MpTokenResponse> {
  const { apiBaseUrl } = mpConfig()
  return requestJson<MpTokenResponse>(`${apiBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function exchangeAuthorizationCode(params: {
  code: string
  codeVerifier: string
}): Promise<MpTokenResponse> {
  const { clientId, clientSecret, redirectUri } = mpConfig()
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: redirectUri,
    code_verifier: params.codeVerifier,
  })
}

export function refreshAccessToken(refreshToken: string): Promise<MpTokenResponse> {
  const { clientId, clientSecret } = mpConfig()
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

export function getPayment(accessToken: string, paymentId: string): Promise<MpPayment> {
  const { apiBaseUrl } = mpConfig()
  return requestJson<MpPayment>(`${apiBaseUrl}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function searchPayments(
  accessToken: string,
  params: { from: Date; to: Date; offset: number }
): Promise<{ results: MpPayment[]; paging: { total: number } }> {
  const { apiBaseUrl } = mpConfig()
  const url = new URL('/v1/payments/search', apiBaseUrl)

  // `sort` es obligatorio en este endpoint: sin él MP responde 400.
  url.searchParams.set('sort', 'date_created')
  url.searchParams.set('criteria', 'desc')
  url.searchParams.set('range', 'date_created')
  url.searchParams.set('begin_date', params.from.toISOString())
  url.searchParams.set('end_date', params.to.toISOString())
  url.searchParams.set('limit', '50')
  url.searchParams.set('offset', String(params.offset))

  return requestJson(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
```

- [ ] **Step 4: Correr el test**

Run: `cd backend && npx vitest run tests/mpClient.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/mercadopago/mpClient.ts backend/tests/helpers/mpFixtures.ts backend/tests/mpClient.test.ts
git commit -m "feat: add Mercado Pago API client with PKCE authorization"
```

---

### Task 7: Billetera autoprovista del proveedor

**Files:**
- Create: `backend/src/services/integrationWalletService.ts`
- Test: `backend/tests/integrationsMercadoPago.test.ts`

**Interfaces:**
- Consumes: el par Account+Wallet que arma `backend/src/routes/wallets.ts:43-61`.
- Produces: `ensureProviderWallet(tx, userId, provider, currency): Promise<Wallet>` — idempotente por `@@unique([userId, externalProvider, currency])`; si el nombre `Mercado Pago ARS` ya está tomado por una cuenta manual, cae a `Mercado Pago ARS (integración)`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/integrationsMercadoPago.test.ts`:

```ts
describe('ensureProviderWallet', () => {
  it('llamarla dos veces deja una sola billetera', async () => {
    const { ensureProviderWallet } = await import('../src/services/integrationWalletService')
    const { userId } = await registerAndOnboard()

    const first = await prisma.$transaction((tx) =>
      ensureProviderWallet(tx, userId, 'mercadopago', 'ARS')
    )
    const second = await prisma.$transaction((tx) =>
      ensureProviderWallet(tx, userId, 'mercadopago', 'ARS')
    )

    expect(second.id).toBe(first.id)
    expect(first.name).toBe('Mercado Pago ARS')

    const count = await prisma.wallet.count({
      where: { userId, externalProvider: 'mercadopago', currency: 'ARS' },
    })
    expect(count).toBe(1)
  })

  it('si el nombre ya lo usa una cuenta manual, usa el nombre alternativo', async () => {
    const { ensureProviderWallet } = await import('../src/services/integrationWalletService')
    const { userId, token } = await registerAndOnboard()

    await request(app)
      .post('/wallets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mercado Pago ARS', currency: 'ARS' })

    const wallet = await prisma.$transaction((tx) =>
      ensureProviderWallet(tx, userId, 'mercadopago', 'ARS')
    )

    expect(wallet.name).toBe('Mercado Pago ARS (integración)')
  })
})
```

Nota: `POST /wallets` nombra la cuenta espejo `Mercado Pago ARS (ARS)`, no `Mercado Pago ARS`. Si el segundo test no dispara el `P2002`, crear la cuenta que colisiona directo con `prisma.account.create({ data: { userId, name: 'Mercado Pago ARS', kind: 'ASSET', currency: 'ARS' } })` y borrar la llamada a `POST /wallets`.

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

Crear `backend/src/services/integrationWalletService.ts`:

```ts
import { AccountKind, Currency, Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

const PROVIDER_LABELS: Record<string, string> = {
  mercadopago: 'Mercado Pago',
}

/** Idempotente: la unicidad la garantiza @@unique([userId, externalProvider, currency]). */
export async function ensureProviderWallet(
  tx: Tx,
  userId: string,
  provider: string,
  currency: Currency
) {
  const existing = await tx.wallet.findFirst({
    where: { userId, externalProvider: provider, currency },
  })
  if (existing) return existing

  const label = PROVIDER_LABELS[provider] ?? provider
  const preferredName = `${label} ${currency}`

  // El nombre de cuenta puede estar tomado por una billetera manual del usuario.
  let account
  try {
    account = await tx.account.create({
      data: { userId, name: preferredName, kind: AccountKind.ASSET, currency },
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      account = await tx.account.create({
        data: {
          userId,
          name: `${preferredName} (integración)`,
          kind: AccountKind.ASSET,
          currency,
        },
      })
    } else {
      throw error
    }
  }

  return tx.wallet.create({
    data: {
      userId,
      accountId: account.id,
      currency,
      name: account.name,
      externalProvider: provider,
    },
  })
}
```

- [ ] **Step 4: Correr el test**

Run: `cd backend && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/integrationWalletService.ts backend/tests/integrationsMercadoPago.test.ts
git commit -m "feat: auto-provision a wallet per integration provider"
```

---

### Task 8: Servicio OAuth de Mercado Pago

**Files:**
- Create: `backend/src/services/mercadopago/mpOAuthService.ts`

**Interfaces:**
- Consumes: `mpClient` (Task 6), `encryptSecret`/`decryptSecret` (Task 2), `ensureProviderWallet` (Task 7), `mobileDeepLinkScheme` (Task 2).
- Produces:
  - `startConnect(userId, mobileRedirectUri): Promise<{ authorizationUrl: string }>`
  - `completeConnect({ state, code }): Promise<{ mobileRedirectUri: string }>`
  - `getValidAccessToken(userId): Promise<string>`
  - `disconnect(userId): Promise<void>`
  - `getIntegrationStatus(userId): Promise<Integration[]>`

Se verifica junto con las rutas en la Task 9 (necesita HTTP para probarse de punta a punta).

- [ ] **Step 1: Escribir el servicio**

Crear `backend/src/services/mercadopago/mpOAuthService.ts`:

```ts
import crypto from 'crypto'
import { Currency } from '@prisma/client'
import { prisma } from '../../prisma/prisma'
import { AppError } from '../../lib/errors'
import { decryptSecret, encryptSecret } from '../../lib/crypto'
import { mobileDeepLinkScheme } from '../../lib/env'
import { HttpError } from '../../lib/httpClient'
import { ensureProviderWallet } from '../integrationWalletService'
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  type MpTokenResponse,
} from './mpClient'

export const PROVIDER = 'mercadopago'

/** El código de MP vive 10 minutos: el state no tiene por qué durar más. */
const STATE_TTL_MS = 10 * 60 * 1000
const REFRESH_MARGIN_MS = 30 * 24 * 60 * 60 * 1000

type StoredCredentials = {
  accessToken: string
  refreshToken: string
  publicKey?: string | null
  scope?: string | null
  liveMode?: boolean | null
}

function assertMobileRedirectUri(uri: string) {
  const scheme = mobileDeepLinkScheme()
  const allowed = uri.startsWith(`${scheme}://`) || (process.env.NODE_ENV !== 'production' && uri.startsWith('exp://'))
  if (!allowed) {
    throw new AppError(400, 'mobileRedirectUri inválido')
  }
}

export async function startConnect(userId: string, mobileRedirectUri: unknown) {
  if (typeof mobileRedirectUri !== 'string' || mobileRedirectUri.trim() === '') {
    throw new AppError(400, 'mobileRedirectUri es requerido')
  }
  assertMobileRedirectUri(mobileRedirectUri)

  const state = crypto.randomBytes(32).toString('base64url')
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  await prisma.integrationOAuthState.create({
    data: {
      userId,
      provider: PROVIDER,
      state,
      codeVerifier,
      mobileRedirectUri,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  })

  return { authorizationUrl: buildAuthorizationUrl({ state, codeChallenge }) }
}

async function persistTokens(userId: string, tokens: MpTokenResponse) {
  const credentials: StoredCredentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    publicKey: tokens.public_key ?? null,
    scope: tokens.scope ?? null,
    liveMode: tokens.live_mode ?? null,
  }

  const data = {
    credentials: encryptSecret(JSON.stringify(credentials)),
    status: 'connected',
    externalAccountId: String(tokens.user_id),
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    lastError: null,
  }

  return prisma.integration.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { userId, provider: PROVIDER, ...data },
    update: data,
  })
}

export async function completeConnect(params: { state: unknown; code: unknown }) {
  if (typeof params.state !== 'string' || typeof params.code !== 'string') {
    throw new AppError(400, 'Faltan state o code')
  }

  // Compare-and-set atómico: el state es de un solo uso, sin carrera posible.
  const consumed = await prisma.integrationOAuthState.updateMany({
    where: { state: params.state, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  })
  if (consumed.count !== 1) {
    throw new AppError(400, 'El pedido de conexión venció o ya fue usado')
  }

  const row = await prisma.integrationOAuthState.findUniqueOrThrow({
    where: { state: params.state },
  })

  const tokens = await exchangeAuthorizationCode({
    code: params.code,
    codeVerifier: row.codeVerifier,
  })
  await persistTokens(row.userId, tokens)

  // La billetera se crea ya para que la pantalla de conexión muestre algo concreto.
  await prisma.$transaction((tx) =>
    ensureProviderWallet(tx, row.userId, PROVIDER, Currency.ARS)
  )

  return { mobileRedirectUri: row.mobileRedirectUri }
}

export async function getValidAccessToken(userId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  })
  if (!integration || integration.status !== 'connected' || !integration.credentials) {
    throw new AppError(400, 'Mercado Pago no está conectado')
  }

  const credentials = JSON.parse(decryptSecret(integration.credentials)) as StoredCredentials
  const expiresSoon =
    !integration.tokenExpiresAt ||
    integration.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS

  if (!expiresSoon) return credentials.accessToken

  try {
    // El refresh_token rota en cada refresh: hay que guardar el nuevo o la conexión muere.
    const tokens = await refreshAccessToken(credentials.refreshToken)
    await persistTokens(userId, tokens)
    return tokens.access_token
  } catch (error) {
    if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
      await prisma.integration.update({
        where: { id: integration.id },
        data: { status: 'error', lastError: 'Reconectá Mercado Pago' },
      })
      throw new AppError(400, 'Reconectá Mercado Pago')
    }
    throw error
  }
}

export async function disconnect(userId: string) {
  // No se borran ni la billetera ni sus movimientos: son historial real del ledger.
  await prisma.integration.updateMany({
    where: { userId, provider: PROVIDER },
    data: { status: 'disconnected', credentials: '', externalAccountId: null, tokenExpiresAt: null },
  })
}

export function getIntegrationStatus(userId: string) {
  return prisma.integration.findMany({ where: { userId }, orderBy: { provider: 'asc' } })
}
```

- [ ] **Step 2: Chequear tipos**

Run: `cd backend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/mercadopago/mpOAuthService.ts
git commit -m "feat: add Mercado Pago OAuth service with PKCE and token rotation"
```

---

### Task 9: Rutas de integraciones y callback

**Files:**
- Create: `backend/src/routes/integrations.ts`
- Create: `backend/src/routes/integrationsCallback.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/lib/serializers.ts` (`serializeIntegration`)
- Test: `backend/tests/integrationsMercadoPago.test.ts`

**Interfaces:**
- Consumes: `mpOAuthService` (Task 8).
- Produces: `GET /integrations`, `POST /integrations/:provider/connect`, `DELETE /integrations/:provider`, y el público `GET /integrations/:provider/callback`. `serializeIntegration(integration)` → `{ provider, status, externalAccountId, lastSyncAt, lastWebhookAt, lastError }` — **nunca** `credentials`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/integrationsMercadoPago.test.ts` (sumar los imports de `httpClient` y `fakeMpFetch`):

```ts
describe('rutas de integraciones', () => {
  const realFetch = httpClient.fetch

  afterEach(() => {
    httpClient.fetch = realFetch
  })

  it('connect devuelve una URL con PKCE y el callback vuelve al deep link', async () => {
    const { token } = await registerAndOnboard()
    const fake = fakeMpFetch({ token: { ...tokenResponse, user_id: Date.now() } })
    httpClient.fetch = fake.fetchImpl

    const connect = await request(app)
      .post('/integrations/mercadopago/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ mobileRedirectUri: 'monedapp://integrations/mercadopago' })

    expect(connect.status).toBe(200)
    const url = new URL(connect.body.authorizationUrl)
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')

    const state = url.searchParams.get('state')!
    const callback = await request(app).get(
      `/integrations/mercadopago/callback?code=code-1&state=${state}`
    )

    expect(callback.status).toBe(302)
    expect(callback.headers.location).toContain('monedapp://integrations/mercadopago')
    expect(callback.headers.location).toContain('status=connected')

    const list = await request(app).get('/integrations').set('Authorization', `Bearer ${token}`)
    expect(list.body[0].status).toBe('connected')
    expect(list.body[0].credentials).toBeUndefined()
  })

  it('un state ya usado redirige con status=error', async () => {
    const { token } = await registerAndOnboard()
    httpClient.fetch = fakeMpFetch({ token: { ...tokenResponse, user_id: Date.now() } }).fetchImpl

    const connect = await request(app)
      .post('/integrations/mercadopago/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ mobileRedirectUri: 'monedapp://integrations/mercadopago' })
    const state = new URL(connect.body.authorizationUrl).searchParams.get('state')!

    await request(app).get(`/integrations/mercadopago/callback?code=code-1&state=${state}`)
    const replay = await request(app).get(
      `/integrations/mercadopago/callback?code=code-1&state=${state}`
    )

    expect(replay.status).toBe(302)
    expect(replay.headers.location).toContain('status=error')
  })

  it('mobileRedirectUri de otro esquema → 400', async () => {
    const { token } = await registerAndOnboard()

    const res = await request(app)
      .post('/integrations/mercadopago/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ mobileRedirectUri: 'https://evil.test/steal' })

    expect(res.status).toBe(400)
  })

  it('proveedor desconocido → 400', async () => {
    const { token } = await registerAndOnboard()

    const res = await request(app)
      .post('/integrations/stripe/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ mobileRedirectUri: 'monedapp://integrations/stripe' })

    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: FAIL — 404 en todas las rutas.

- [ ] **Step 3: Escribir el serializer**

En `backend/src/lib/serializers.ts`, sumar `Integration` al import de `@prisma/client` y agregar:

```ts
/** Nunca emite `credentials`: son tokens cifrados del proveedor. */
export function serializeIntegration(integration: Integration) {
  return {
    provider: integration.provider,
    status: integration.status,
    externalAccountId: integration.externalAccountId,
    lastSyncAt: integration.lastSyncAt,
    lastWebhookAt: integration.lastWebhookAt,
    lastError: integration.lastError,
  }
}
```

- [ ] **Step 4: Escribir las rutas**

Crear `backend/src/routes/integrations.ts`:

```ts
import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { serializeIntegration } from '../lib/serializers'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import {
  disconnect,
  getIntegrationStatus,
  startConnect,
} from '../services/mercadopago/mpOAuthService'

const router = Router()
router.use(requireAuth)

function assertSupportedProvider(provider: string) {
  if (provider !== 'mercadopago') {
    throw new AppError(400, 'Proveedor no soportado')
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const integrations = await getIntegrationStatus(userId)
    res.json(integrations.map(serializeIntegration))
  })
)

router.post(
  '/:provider/connect',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    assertSupportedProvider(req.params.provider)

    const { mobileRedirectUri } = req.body as { mobileRedirectUri?: unknown }
    res.json(await startConnect(userId, mobileRedirectUri))
  })
)

router.delete(
  '/:provider',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    assertSupportedProvider(req.params.provider)

    await disconnect(userId)
    res.status(204).send()
  })
)

export default router
```

Crear `backend/src/routes/integrationsCallback.ts`:

```ts
import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { completeConnect } from '../services/mercadopago/mpOAuthService'

const router = Router()

/**
 * Sin requireAuth: el navegador que trae a MP no tiene el JWT.
 * El userId viaja en la fila de state, del lado del servidor.
 * Siempre redirige: el usuario nunca ve una página de error del backend.
 */
router.get(
  '/:provider/callback',
  asyncHandler(async (req, res) => {
    const { code, state } = req.query
    const fallback = `${process.env.MOBILE_DEEP_LINK_SCHEME || 'monedapp'}://integrations/${req.params.provider}`

    if (req.params.provider !== 'mercadopago') {
      res.redirect(302, `${fallback}?status=error&reason=unsupported_provider`)
      return
    }

    try {
      const { mobileRedirectUri } = await completeConnect({ state, code })
      res.redirect(302, `${mobileRedirectUri}?status=connected`)
    } catch (error) {
      const reason = error instanceof Error ? encodeURIComponent(error.message) : 'unknown'
      res.redirect(302, `${fallback}?status=error&reason=${reason}`)
    }
  })
)

export default router
```

- [ ] **Step 5: Montar en orden**

En `backend/src/app.ts`, el público **antes** del autenticado (si no, `requireAuth` se come el callback):

```ts
  app.use('/integrations', integrationsCallbackRouter)
  app.use('/integrations', integrationsRouter)
```

- [ ] **Step 6: Correr los tests**

Run: `cd backend && npx tsc --noEmit && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/integrations.ts backend/src/routes/integrationsCallback.ts backend/src/app.ts backend/src/lib/serializers.ts backend/tests/integrationsMercadoPago.test.ts
git commit -m "feat: add integration connect, status and callback routes"
```

---

### Task 10: Ingesta de pagos

**Files:**
- Create: `backend/src/services/mercadopago/mpIngestionService.ts`
- Test: `backend/tests/integrationsMercadoPago.test.ts`

**Interfaces:**
- Consumes: `mapPaymentToOutcome` (Task 5), `ensureProviderWallet` (Task 7), `resolveExchangeRateId` de `exchangeRateService`, `createLedgerForMovement` de `ledgerService`.
- Produces: `ingestPayment(userId, payment): Promise<{ status: 'posted' | 'skipped'; reason?: string; created: number }>`.

**Nota de fase 3:** si las categorías ya están implementadas, la comisión debe apuntar a la cuenta "Comisiones bancarias" en vez de `getDefaultExpenseAccountId`; pasarla como `categoryAccountId` a `createLedgerForMovement`. Si la fase 3 no está, dejarlo en el default y anotarlo como deuda.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/integrationsMercadoPago.test.ts`:

```ts
describe('ingestPayment', () => {
  it('un pago aprobado crea ingreso bruto + comisión y el asiento suma 0', async () => {
    const { ingestPayment } = await import('../src/services/mercadopago/mpIngestionService')
    const { userId } = await registerAndOnboard()

    const result = await ingestPayment(userId, approvedPayment({ id: 200000001 }))

    expect(result.status).toBe('posted')

    const movements = await prisma.movement.findMany({
      where: { userId, externalProvider: 'mercadopago' },
      orderBy: { externalId: 'asc' },
    })
    expect(movements).toHaveLength(2)
    expect(movements.map((m) => m.externalId)).toEqual(['200000001', '200000001:fee'])
    expect(movements[0].needsReview).toBe(true)
    expect(movements[1].needsReview).toBe(false)
    expect(movements[0].date.toISOString()).toBe('2026-08-14T00:00:00.000Z')

    const entries = await prisma.ledgerEntry.findMany({
      where: { movementId: { in: movements.map((m) => m.id) } },
    })
    expect(entries.reduce((sum, e) => sum + Number(e.change), 0)).toBe(0)
  })

  it('reingestar el mismo pago no duplica nada', async () => {
    const { ingestPayment } = await import('../src/services/mercadopago/mpIngestionService')
    const { userId } = await registerAndOnboard()

    await ingestPayment(userId, approvedPayment({ id: 200000002 }))
    await ingestPayment(userId, approvedPayment({ id: 200000002 }))

    const count = await prisma.movement.count({
      where: { userId, externalProvider: 'mercadopago' },
    })
    expect(count).toBe(2)
  })

  it('un pago pendiente no crea movimientos', async () => {
    const { ingestPayment } = await import('../src/services/mercadopago/mpIngestionService')
    const { userId } = await registerAndOnboard()

    const result = await ingestPayment(userId, pendingPayment({ id: 200000003 }))

    expect(result.status).toBe('skipped')
    expect(await prisma.movement.count({ where: { userId, externalProvider: 'mercadopago' } })).toBe(0)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

Crear `backend/src/services/mercadopago/mpIngestionService.ts`:

```ts
import { Currency, MovementType, Prisma } from '@prisma/client'
import { prisma } from '../../prisma/prisma'
import { resolveExchangeRateId } from '../exchangeRateService'
import { createLedgerForMovement } from '../ledgerService'
import { ensureProviderWallet } from '../integrationWalletService'
import { mapPaymentToOutcome, type MpPayment } from './mpPaymentMapper'
import { PROVIDER } from './mpOAuthService'

export type IngestResult = { status: 'posted' | 'skipped'; reason?: string; created: number }

export async function ingestPayment(userId: string, payment: MpPayment): Promise<IngestResult> {
  const outcome = mapPaymentToOutcome(payment)

  if (outcome.kind === 'skip') return { status: 'skipped', reason: outcome.reason, created: 0 }
  if (outcome.kind === 'unsupported_currency') {
    return { status: 'skipped', reason: `unsupported_currency:${outcome.currency}`, created: 0 }
  }

  const currency = outcome.movements[0].currency as Currency
  const date = outcome.movements[0].date
  const updatedAt = payment.date_last_updated ? new Date(payment.date_last_updated) : new Date()

  // Fuera de la transacción: usa el cliente no-tx y es idempotente.
  const exchangeRateId = await resolveExchangeRateId(currency, date, 'blue')

  return prisma.$transaction(async (tx) => {
    // Serializa la ingesta por usuario sin necesidad de una cola; se libera al commitear.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'mp:' + userId}, 0))`

    const previous = await tx.movement.findFirst({
      where: { userId, externalProvider: PROVIDER, externalId: String(payment.id) },
    })
    if (previous?.externalUpdatedAt && previous.externalUpdatedAt >= updatedAt) {
      return { status: 'skipped' as const, reason: 'stale', created: 0 }
    }

    const wallet = await ensureProviderWallet(tx, userId, PROVIDER, currency)
    let created = 0

    for (const mapped of outcome.movements) {
      try {
        const movement = await tx.movement.create({
          data: {
            userId,
            walletId: wallet.id,
            type: mapped.type as MovementType,
            amount: new Prisma.Decimal(mapped.amount),
            currency,
            exchangeRateId,
            description: mapped.description,
            date: mapped.date,
            externalProvider: PROVIDER,
            externalId: mapped.externalId,
            externalStatus: payment.status,
            externalUpdatedAt: updatedAt,
            needsReview: mapped.needsReview,
          },
        })

        await createLedgerForMovement(tx, {
          userId,
          movementId: movement.id,
          type: movement.type,
          amount: movement.amount,
          currency: movement.currency,
          walletAccountId: wallet.accountId,
        })
        created++
      } catch (error) {
        // P2002 = ya lo posteamos por otra vía (otro webhook, o el sync). Es éxito.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue
        }
        throw error
      }
    }

    return { status: 'posted' as const, created }
  })
}
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/mercadopago/mpIngestionService.ts backend/tests/integrationsMercadoPago.test.ts
git commit -m "feat: ingest Mercado Pago payments into movements and ledger"
```

---

### Task 11: Webhook de Mercado Pago

**Files:**
- Create: `backend/src/routes/webhooks.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/integrationsMercadoPago.test.ts`

**Interfaces:**
- Consumes: `verifyWebhookSignature` (Task 4), `getValidAccessToken` (Task 8), `getPayment` (Task 6), `ingestPayment` (Task 10).
- Produces: `POST /webhooks/mercadopago` y el helper de test `signWebhook(dataId, requestId, ts)`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/integrationsMercadoPago.test.ts` (sumar `import crypto from 'crypto'`):

```ts
describe('POST /webhooks/mercadopago', () => {
  const realFetch = httpClient.fetch

  afterEach(() => {
    httpClient.fetch = realFetch
  })

  function signWebhook(dataId: string, requestId = 'req-1', ts = '1704908010') {
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`
    const v1 = crypto
      .createHmac('sha256', process.env.MP_WEBHOOK_SECRET!)
      .update(manifest)
      .digest('hex')
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId }
  }

  /** Deja una Integration conectada apuntando a un collector id único. */
  async function seedConnectedIntegration(userId: string, externalAccountId: string) {
    const { encryptSecret } = await import('../src/lib/crypto')
    await prisma.integration.create({
      data: {
        userId,
        provider: 'mercadopago',
        status: 'connected',
        externalAccountId,
        tokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        credentials: encryptSecret(
          JSON.stringify({ accessToken: 'APP_USR-access-token', refreshToken: 'TG-refresh' })
        ),
      },
    })
  }

  function body(paymentId: string, collectorId: string, notificationId: number) {
    return {
      id: notificationId,
      live_mode: false,
      type: 'payment',
      action: 'payment.created',
      user_id: Number(collectorId),
      data: { id: paymentId },
    }
  }

  it('pago aprobado firmado → 200 y dos movimientos', async () => {
    const { userId } = await registerAndOnboard()
    const collectorId = String(Date.now())
    await seedConnectedIntegration(userId, collectorId)
    const payment = approvedPayment({ id: 300000001, collector_id: Number(collectorId) })
    httpClient.fetch = fakeMpFetch({ payments: { '300000001': payment } }).fetchImpl

    const res = await request(app)
      .post('/webhooks/mercadopago?data.id=300000001')
      .set(signWebhook('300000001'))
      .send(body('300000001', collectorId, 1))

    expect(res.status).toBe(200)
    const movements = await prisma.movement.findMany({ where: { userId } })
    expect(movements).toHaveLength(2)
  })

  it('la misma notificación reentregada no duplica', async () => {
    const { userId } = await registerAndOnboard()
    const collectorId = String(Date.now() + 1)
    await seedConnectedIntegration(userId, collectorId)
    const payment = approvedPayment({ id: 300000002, collector_id: Number(collectorId) })
    httpClient.fetch = fakeMpFetch({ payments: { '300000002': payment } }).fetchImpl
    const notification = body('300000002', collectorId, 2)

    await request(app)
      .post('/webhooks/mercadopago?data.id=300000002')
      .set(signWebhook('300000002'))
      .send(notification)
    const replay = await request(app)
      .post('/webhooks/mercadopago?data.id=300000002')
      .set(signWebhook('300000002'))
      .send(notification)

    expect(replay.status).toBe(200)
    expect(await prisma.movement.count({ where: { userId } })).toBe(2)
  })

  it('payment.updated con otra notification id tampoco duplica', async () => {
    const { userId } = await registerAndOnboard()
    const collectorId = String(Date.now() + 2)
    await seedConnectedIntegration(userId, collectorId)
    const payment = approvedPayment({ id: 300000003, collector_id: Number(collectorId) })
    httpClient.fetch = fakeMpFetch({ payments: { '300000003': payment } }).fetchImpl

    await request(app)
      .post('/webhooks/mercadopago?data.id=300000003')
      .set(signWebhook('300000003'))
      .send(body('300000003', collectorId, 3))
    await request(app)
      .post('/webhooks/mercadopago?data.id=300000003')
      .set(signWebhook('300000003', 'req-2'))
      .send({ ...body('300000003', collectorId, 4), action: 'payment.updated' })

    expect(await prisma.movement.count({ where: { userId } })).toBe(2)
  })

  it('firma inválida → 401 y ningún movimiento', async () => {
    const { userId } = await registerAndOnboard()
    const collectorId = String(Date.now() + 3)
    await seedConnectedIntegration(userId, collectorId)

    const res = await request(app)
      .post('/webhooks/mercadopago?data.id=300000004')
      .set({ 'x-signature': 'ts=1704908010,v1=deadbeef', 'x-request-id': 'req-1' })
      .send(body('300000004', collectorId, 5))

    expect(res.status).toBe(401)
    expect(await prisma.movement.count({ where: { userId } })).toBe(0)
  })

  it('user_id sin integración → 200 y evento ignorado', async () => {
    const unknownCollector = String(Date.now() + 4)

    const res = await request(app)
      .post('/webhooks/mercadopago?data.id=300000005')
      .set(signWebhook('300000005'))
      .send(body('300000005', unknownCollector, 6))

    expect(res.status).toBe(200)
    const event = await prisma.integrationWebhookEvent.findFirst({
      where: { provider: 'mercadopago', notificationId: '6' },
    })
    expect(event?.status).toBe('ignored')
  })

  it('un topic que no es payment se ignora con 200', async () => {
    const res = await request(app)
      .post('/webhooks/mercadopago?data.id=300000006')
      .set(signWebhook('300000006'))
      .send({ id: 7, type: 'merchant_order', action: 'merchant_order.updated', data: { id: '1' } })

    expect(res.status).toBe(200)
    expect(res.body.ignored).toBe(true)
  })

  it('un pago pendiente no crea movimientos', async () => {
    const { userId } = await registerAndOnboard()
    const collectorId = String(Date.now() + 5)
    await seedConnectedIntegration(userId, collectorId)
    const payment = pendingPayment({ id: 300000007, collector_id: Number(collectorId) })
    httpClient.fetch = fakeMpFetch({ payments: { '300000007': payment } }).fetchImpl

    const res = await request(app)
      .post('/webhooks/mercadopago?data.id=300000007')
      .set(signWebhook('300000007'))
      .send(body('300000007', collectorId, 8))

    expect(res.status).toBe(200)
    expect(await prisma.movement.count({ where: { userId } })).toBe(0)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: FAIL — 404 en `/webhooks/mercadopago`.

- [ ] **Step 3: Implementar**

Crear `backend/src/routes/webhooks.ts`:

```ts
import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { mpConfig } from '../lib/env'
import { verifyWebhookSignature } from '../services/mercadopago/mpSignature'
import { getValidAccessToken, PROVIDER } from '../services/mercadopago/mpOAuthService'
import { getPayment } from '../services/mercadopago/mpClient'
import { ingestPayment } from '../services/mercadopago/mpIngestionService'

const router = Router()

router.post(
  '/mercadopago',
  asyncHandler(async (req, res) => {
    const dataIdQuery = req.query['data.id']
    const signatureOk = verifyWebhookSignature({
      xSignature: req.header('x-signature') ?? undefined,
      xRequestId: req.header('x-request-id') ?? undefined,
      dataId: typeof dataIdQuery === 'string' ? dataIdQuery : undefined,
      secret: mpConfig().webhookSecret,
    })

    if (!signatureOk) {
      res.status(401).json({ error: 'Firma inválida' })
      return
    }

    const body = req.body as {
      id?: number | string
      type?: string
      user_id?: number | string
      data?: { id?: string }
    }

    if (body.type !== 'payment') {
      res.json({ ignored: true })
      return
    }

    const notificationId = String(body.id ?? '')
    const resourceId = body.data?.id ? String(body.data.id) : null

    // Reentrega de la misma notificación: 200 y nada más.
    try {
      await prisma.integrationWebhookEvent.create({
        data: { provider: PROVIDER, notificationId, resourceId },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.json({ duplicate: true })
        return
      }
      throw error
    }

    const integration = await prisma.integration.findFirst({
      where: { provider: PROVIDER, externalAccountId: String(body.user_id ?? ''), status: 'connected' },
    })

    if (!integration || !resourceId) {
      // 200 a propósito: un 4xx haría que MP reintente días un evento que nunca va a matchear.
      await prisma.integrationWebhookEvent.updateMany({
        where: { provider: PROVIDER, notificationId },
        data: { status: 'ignored' },
      })
      res.json({ ignored: true })
      return
    }

    try {
      const accessToken = await getValidAccessToken(integration.userId)
      const payment = await getPayment(accessToken, resourceId)

      if (String(payment.collector_id ?? '') !== String(integration.externalAccountId)) {
        await prisma.integrationWebhookEvent.updateMany({
          where: { provider: PROVIDER, notificationId },
          data: { status: 'ignored', error: 'collector_mismatch' },
        })
        res.json({ ignored: true })
        return
      }

      await ingestPayment(integration.userId, payment)

      await prisma.integrationWebhookEvent.updateMany({
        where: { provider: PROVIDER, notificationId },
        data: { status: 'processed' },
      })
      await prisma.integration.update({
        where: { id: integration.id },
        data: { lastWebhookAt: new Date() },
      })

      res.json({ processed: true })
    } catch (error) {
      // Falla transitoria: un 500 es un reintento gratis de MP en 15 minutos.
      await prisma.integrationWebhookEvent.updateMany({
        where: { provider: PROVIDER, notificationId },
        data: { status: 'failed', error: error instanceof Error ? error.message : 'unknown' },
      })
      throw error
    }
  })
)

export default router
```

En `backend/src/app.ts`:

```ts
  app.use('/webhooks', webhooksRouter)
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx tsc --noEmit && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/webhooks.ts backend/src/app.ts backend/tests/integrationsMercadoPago.test.ts
git commit -m "feat: process signed Mercado Pago payment webhooks"
```

---

### Task 12: Reembolsos y contracargos

**Files:**
- Test: `backend/tests/integrationsMercadoPago.test.ts`
- Modify: `backend/src/services/mercadopago/mpIngestionService.ts` (solo si el test lo pide)

**Interfaces:**
- Consumes: la rama `reverse` de `mapPaymentToOutcome` (Task 5) y `ingestPayment` (Task 10).
- Produces: garantía de que un reembolso agrega un tercer movimiento `:reversal` sin tocar el original.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/integrationsMercadoPago.test.ts`:

```ts
describe('reembolsos', () => {
  it('un reembolso agrega un movimiento compensatorio y no toca el original', async () => {
    const { ingestPayment } = await import('../src/services/mercadopago/mpIngestionService')
    const { userId } = await registerAndOnboard()

    await ingestPayment(userId, approvedPayment({ id: 400000001 }))
    const original = await prisma.movement.findFirstOrThrow({
      where: { userId, externalId: '400000001' },
    })

    await ingestPayment(userId, refundedPayment({ id: 400000001 }))

    const movements = await prisma.movement.findMany({
      where: { userId, externalProvider: 'mercadopago' },
      orderBy: { externalId: 'asc' },
    })
    expect(movements.map((m) => m.externalId)).toEqual([
      '400000001',
      '400000001:fee',
      '400000001:reversal',
    ])

    const stillThere = await prisma.movement.findUniqueOrThrow({ where: { id: original.id } })
    expect(Number(stillThere.amount)).toBe(Number(original.amount))

    const entries = await prisma.ledgerEntry.findMany({
      where: { movementId: { in: movements.map((m) => m.id) } },
    })
    expect(entries.reduce((sum, e) => sum + Number(e.change), 0)).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test**

Run: `cd backend && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: puede pasar directo (la rama `reverse` ya está mapeada) o fallar por el guard de staleness — el reembolso trae un `date_last_updated` posterior, así que debería pasar.

Si falla porque el guard bloquea el reembolso: el guard compara contra el movimiento de `externalId` base; verificar que `refundedPayment` tenga un `date_last_updated` **posterior** al del pago aprobado y ajustar la fixture, no el guard.

- [ ] **Step 3: Documentar el límite conocido**

Agregar el comentario en `mpIngestionService.ts`, arriba del loop de movimientos:

```ts
      // Límite conocido: un segundo reembolso parcial del mismo pago colisiona en
      // `<id>:reversal` y se traga como duplicado. Documentado, no resuelto.
```

- [ ] **Step 4: Commit**

```bash
git add backend/tests/integrationsMercadoPago.test.ts backend/src/services/mercadopago/mpIngestionService.ts
git commit -m "test: cover Mercado Pago refunds as compensating movements"
```

---

### Task 13: Sync manual como red de seguridad

**Files:**
- Create: `backend/src/services/mercadopago/mpSyncService.ts`
- Modify: `backend/src/routes/integrations.ts`
- Test: `backend/tests/integrationsMercadoPago.test.ts`

**Interfaces:**
- Consumes: `searchPayments` (Task 6), `getValidAccessToken` (Task 8), `ingestPayment` (Task 10).
- Produces: `syncMercadoPago(userId, { from?, to? }): Promise<{ scanned: number; created: number }>` y `POST /integrations/:provider/sync`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/integrationsMercadoPago.test.ts`:

```ts
describe('POST /integrations/mercadopago/sync', () => {
  const realFetch = httpClient.fetch

  afterEach(() => {
    httpClient.fetch = realFetch
  })

  it('la primera corrida crea movimientos y la segunda no crea nada', async () => {
    const { token, userId } = await registerAndOnboard()
    const collectorId = String(Date.now() + 10)
    const { encryptSecret } = await import('../src/lib/crypto')
    await prisma.integration.create({
      data: {
        userId,
        provider: 'mercadopago',
        status: 'connected',
        externalAccountId: collectorId,
        tokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        credentials: encryptSecret(
          JSON.stringify({ accessToken: 'APP_USR-access-token', refreshToken: 'TG-refresh' })
        ),
      },
    })
    httpClient.fetch = fakeMpFetch({
      search: [approvedPayment({ id: 500000001, collector_id: Number(collectorId) })],
    }).fetchImpl

    const first = await request(app)
      .post('/integrations/mercadopago/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(first.status).toBe(200)
    expect(first.body.created).toBe(2)

    const second = await request(app)
      .post('/integrations/mercadopago/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(second.body.created).toBe(0)
    expect(await prisma.movement.count({ where: { userId } })).toBe(2)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: FAIL — 404 en `/integrations/mercadopago/sync`.

- [ ] **Step 3: Implementar el servicio**

Crear `backend/src/services/mercadopago/mpSyncService.ts`:

```ts
import { prisma } from '../../prisma/prisma'
import { searchPayments } from './mpClient'
import { getValidAccessToken, PROVIDER } from './mpOAuthService'
import { ingestPayment } from './mpIngestionService'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_PAGES = 20

export async function syncMercadoPago(
  userId: string,
  range: { from?: Date; to?: Date } = {}
): Promise<{ scanned: number; created: number }> {
  const accessToken = await getValidAccessToken(userId)

  const to = range.to ?? new Date()
  const requestedFrom = range.from ?? new Date(to.getTime() - 30 * DAY_MS)
  // MP solo permite ventanas menores a 365 días, y solo los últimos 12 meses.
  const earliest = new Date(to.getTime() - 364 * DAY_MS)
  const from = requestedFrom < earliest ? earliest : requestedFrom

  let scanned = 0
  let created = 0

  for (let page = 0; page < MAX_PAGES; page++) {
    const { results } = await searchPayments(accessToken, { from, to, offset: page * 50 })
    if (results.length === 0) break

    for (const payment of results) {
      scanned++
      // Mismo camino que el webhook: un pago ya posteado se deduplica solo.
      const result = await ingestPayment(userId, payment)
      created += result.created
    }

    if (results.length < 50) break
  }

  await prisma.integration.updateMany({
    where: { userId, provider: PROVIDER },
    data: { lastSyncAt: new Date() },
  })

  return { scanned, created }
}
```

- [ ] **Step 4: Exponer la ruta**

En `backend/src/routes/integrations.ts`, importar `syncMercadoPago` y agregar:

```ts
router.post(
  '/:provider/sync',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    assertSupportedProvider(req.params.provider)

    const { from, to } = req.body as { from?: unknown; to?: unknown }
    const parseOptionalDate = (value: unknown) =>
      typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
        ? new Date(value)
        : undefined

    res.json(
      await syncMercadoPago(userId, { from: parseOptionalDate(from), to: parseOptionalDate(to) })
    )
  })
)
```

- [ ] **Step 5: Correr toda la suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/mercadopago/mpSyncService.ts backend/src/routes/integrations.ts backend/tests/integrationsMercadoPago.test.ts
git commit -m "feat: add manual Mercado Pago backfill sync"
```

---

### Task 14: Bandeja de revisión en la API

**Files:**
- Modify: `backend/src/lib/serializers.ts` (`serializeMovement`)
- Modify: `backend/src/routes/movements.ts` (`GET` filtros, `PATCH`)
- Test: `backend/tests/integrationsMercadoPago.test.ts`

**Interfaces:**
- Consumes: `needsReview`/`externalProvider` (Task 1).
- Produces: `serializeMovement` con `needsReview` y `source` (`externalProvider ?? 'manual'`); `GET /movements?needsReview=true&source=mercadopago`; `PATCH /movements/:id { needsReview: false }` como acción "confirmar".

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/integrationsMercadoPago.test.ts`:

```ts
describe('bandeja de revisión', () => {
  it('filtra por needsReview y el PATCH limpia la marca', async () => {
    const { ingestPayment } = await import('../src/services/mercadopago/mpIngestionService')
    const { token, userId } = await registerAndOnboard()
    await ingestPayment(userId, approvedPayment({ id: 600000001 }))

    const pending = await request(app)
      .get('/movements?needsReview=true')
      .set('Authorization', `Bearer ${token}`)

    expect(pending.status).toBe(200)
    expect(pending.body).toHaveLength(1)
    expect(pending.body[0].source).toBe('mercadopago')
    expect(pending.body[0].needsReview).toBe(true)

    const confirmed = await request(app)
      .patch(`/movements/${pending.body[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Cobro Estudio Contable', needsReview: false })

    expect(confirmed.status).toBe(200)
    expect(confirmed.body.needsReview).toBe(false)

    const after = await request(app)
      .get('/movements?needsReview=true')
      .set('Authorization', `Bearer ${token}`)
    expect(after.body).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/integrationsMercadoPago.test.ts`
Expected: FAIL — `source` es `undefined` y el filtro devuelve los 2 movimientos.

- [ ] **Step 3: Implementar**

En `backend/src/lib/serializers.ts`, agregar al objeto que devuelve `serializeMovement`:

```ts
    needsReview: movement.needsReview,
    source: movement.externalProvider ?? 'manual',
```

En `backend/src/routes/movements.ts`, en el `GET /`:

```ts
    const { walletId, clientId, type, from, to, needsReview, source } = req.query
```

```ts
    if (needsReview === 'true') where.needsReview = true
    if (needsReview === 'false') where.needsReview = false
    if (typeof source === 'string') {
      where.externalProvider = source === 'manual' ? null : source
    }
```

En el `PATCH /:id`, junto a los otros campos opcionales:

```ts
    if (needsReview !== undefined) {
      if (typeof needsReview !== 'boolean') {
        throw new AppError(400, 'needsReview debe ser booleano')
      }
      data.needsReview = needsReview
    }
```

leyendo `needsReview` del body en el destructuring del handler.

- [ ] **Step 4: Correr toda la suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/serializers.ts backend/src/routes/movements.ts backend/tests/integrationsMercadoPago.test.ts
git commit -m "feat: expose review inbox filters and confirm action on movements"
```

---

### Task 15: Pantalla de integraciones en la app

**Files:**
- Modify: `mobile/src/api/types.ts`
- Modify: `mobile/app.json` (plugin)
- Create: `mobile/app/integrations.tsx`
- Modify: `mobile/app/_layout.tsx` (`Stack` raíz)
- Modify: `mobile/app/(tabs)/index.tsx` (link a Integraciones)

**Interfaces:**
- Consumes: `GET /integrations`, `POST /integrations/mercadopago/connect`, `POST /integrations/mercadopago/sync`, `DELETE /integrations/mercadopago`.
- Produces: `Integration`, `ConnectResponse`, `SyncResult` en types; `Movement` gana `needsReview` y `source`.

Antes de escribir código, leer https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/ y .../sdk/linking/.

- [ ] **Step 1: Agregar los tipos y el plugin**

En `mobile/src/api/types.ts`:

```ts
export type Integration = {
  provider: string
  status: 'connected' | 'disconnected' | 'error'
  externalAccountId: string | null
  lastSyncAt: string | null
  lastWebhookAt: string | null
  lastError: string | null
}

export type ConnectResponse = { authorizationUrl: string }
export type SyncResult = { scanned: number; created: number }
```

y dentro de `Movement`:

```ts
  needsReview?: boolean
  source?: string
```

En `mobile/app.json`, agregar `"expo-web-browser"` al array `plugins`.

- [ ] **Step 2: Escribir la pantalla**

Crear `mobile/app/integrations.tsx`:

```tsx
import { apiRequest, ApiError } from '@/src/api/client'
import type { ConnectResponse, Integration, SyncResult } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

const statusLabel: Record<string, string> = {
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Error',
}

export default function IntegrationsScreen() {
  const { accessToken } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiRequest<Integration[]>('/integrations', { token: accessToken }),
    enabled: !!accessToken,
  })

  const mp = (integrations.data ?? []).find((i) => i.provider === 'mercadopago')

  async function refreshAll() {
    await queryClient.invalidateQueries({ queryKey: ['integrations'] })
    await queryClient.invalidateQueries({ queryKey: ['movements'] })
    await queryClient.invalidateQueries({ queryKey: ['balance-by-wallet'] })
    await queryClient.invalidateQueries({ queryKey: ['wallets'] })
  }

  const connect = useMutation({
    mutationFn: async () => {
      const returnUrl = Linking.createURL('integrations/mercadopago')
      const { authorizationUrl } = await apiRequest<ConnectResponse>(
        '/integrations/mercadopago/connect',
        { method: 'POST', token: accessToken, body: { mobileRedirectUri: returnUrl } }
      )

      const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, returnUrl)
      if (result.type !== 'success') return { status: 'cancelled' }

      const status = Linking.parse(result.url).queryParams?.status
      return { status: typeof status === 'string' ? status : 'unknown' }
    },
    onSuccess: async (result) => {
      await refreshAll()
      if (result.status !== 'connected' && result.status !== 'cancelled') {
        setError('No se pudo conectar Mercado Pago')
      }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo conectar'),
  })

  const sync = useMutation({
    mutationFn: () =>
      apiRequest<SyncResult>('/integrations/mercadopago/sync', {
        method: 'POST',
        token: accessToken,
        body: {},
      }),
    onSuccess: async (result) => {
      await refreshAll()
      Alert.alert('Sincronización', `Se importaron ${result.created} movimientos.`)
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo sincronizar'),
  })

  const disconnect = useMutation({
    mutationFn: () =>
      apiRequest<void>('/integrations/mercadopago', { method: 'DELETE', token: accessToken }),
    onSuccess: refreshAll,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo desconectar'),
  })

  const busy = connect.isPending || sync.isPending || disconnect.isPending

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <View style={styles.card}>
        <Text style={styles.title}>Mercado Pago</Text>
        <Text style={styles.status}>{statusLabel[mp?.status ?? 'disconnected']}</Text>
        {mp?.lastSyncAt ? (
          <Text style={styles.meta}>
            Última sincronización: {new Date(mp.lastSyncAt).toLocaleString('es-AR')}
          </Text>
        ) : null}
        {mp?.lastError ? <Text style={formStyles.error}>{mp.lastError}</Text> : null}
      </View>

      {error ? <Text style={formStyles.error}>{error}</Text> : null}

      {mp?.status === 'connected' ? (
        <>
          <Pressable style={formStyles.button} onPress={() => sync.mutate()} disabled={busy}>
            {sync.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={formStyles.buttonText}>Sincronizar ahora</Text>
            )}
          </Pressable>
          <Pressable onPress={() => disconnect.mutate()} disabled={busy}>
            <Text style={styles.disconnect}>Desconectar</Text>
          </Pressable>
        </>
      ) : (
        <Pressable style={formStyles.button} onPress={() => connect.mutate()} disabled={busy}>
          {connect.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={formStyles.buttonText}>Conectar Mercado Pago</Text>
          )}
        </Pressable>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.ink },
  status: { fontSize: 15, color: colors.accent, fontWeight: '600' },
  meta: { fontSize: 13, color: colors.muted },
  disconnect: { color: colors.danger, textAlign: 'center', paddingVertical: 10, fontWeight: '600' },
})
```

Si la fase 2 no está hecha, `@/src/ui/formStyles` no existe: crearlo con `label`, `input`, `button`, `buttonText`, `rowWrap`, `chip`, `chipActive`, `chipText`, `chipTextActive` y `error` como está descripto en el plan de ABM, Task 5.

- [ ] **Step 3: Registrar la ruta y el acceso**

En `mobile/app/_layout.tsx`, dentro del `<Stack>`:

```tsx
            <Stack.Screen
              name="integrations"
              options={{
                headerShown: true,
                title: 'Integraciones',
                headerStyle: { backgroundColor: colors.bg },
                headerShadowVisible: false,
              }}
            />
```

En `mobile/app/(tabs)/index.tsx`, en el header, un acceso:

```tsx
        <Pressable onPress={() => router.push('/integrations')}>
          <Text style={styles.seeAll}>Integraciones</Text>
        </Pressable>
```

- [ ] **Step 4: Chequear tipos**

Run: `cd mobile && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/types.ts mobile/app.json mobile/app/integrations.tsx mobile/app/_layout.tsx mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): add Mercado Pago integration screen"
```

---

### Task 16: Tab "Revisar"

**Files:**
- Create: `mobile/app/(tabs)/inbox.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx`
- Modify: `mobile/app/(tabs)/index.tsx` (banner)

**Interfaces:**
- Consumes: `GET /movements?needsReview=true` (Task 14).
- Produces: tab "Revisar" con badge de pendientes y banner en Inicio.

- [ ] **Step 1: Escribir la pantalla**

Crear `mobile/app/(tabs)/inbox.tsx`:

```tsx
import { apiRequest } from '@/src/api/client'
import type { Movement } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'

export default function InboxScreen() {
  const { accessToken } = useAuth()
  const router = useRouter()

  const movements = useQuery({
    queryKey: ['movements', { needsReview: true }],
    queryFn: () =>
      apiRequest<Movement[]>('/movements?needsReview=true', { token: accessToken }),
    enabled: !!accessToken,
  })

  if (movements.isLoading) {
    return <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
  }

  return (
    <FlatList
      style={styles.container}
      data={movements.data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl refreshing={movements.isFetching} onRefresh={() => movements.refetch()} />
      }
      ListEmptyComponent={
        <Text style={styles.empty}>No hay nada para revisar. Todo al día.</Text>
      }
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => router.push(`/movement/${item.id}`)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.desc}>{item.description}</Text>
            <Text style={styles.meta}>
              {item.wallet?.name ?? item.currency} · {item.source ?? 'manual'}
            </Text>
          </View>
          <Text style={styles.amount}>{formatAmount(item.amount, item.currency)}</Text>
        </Pressable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  desc: { fontSize: 16, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  amount: { fontSize: 15, fontWeight: '700', color: colors.income },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
})
```

- [ ] **Step 2: Registrar la tab con badge**

En `mobile/app/(tabs)/_layout.tsx`, agregar la query de pendientes y la tab. La barra queda con Inicio · Movimientos · Nuevo · Revisar · Ajustes:

```tsx
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Revisar',
          tabBarIcon: ({ color }) => <TabIcon name="inbox" color={String(color)} />,
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
        }}
      />
```

con, arriba del `return`:

```tsx
  const { accessToken } = useAuth()
  const pending = useQuery({
    queryKey: ['movements', { needsReview: true }],
    queryFn: () => apiRequest<Movement[]>('/movements?needsReview=true', { token: accessToken }),
    enabled: !!accessToken,
  })
  const pendingCount = pending.data?.length ?? 0
```

y sus imports.

**Choque de specs resuelto:** el spec de MP pedía tab "Revisar" y el de ABM pedía tab "Ajustes"; con Inicio/Movimientos/Nuevo serían cinco, que es el tope que fija el roadmap. Si se agrega "Reportes" en la fase 6, la bandeja pasa a ser un filtro `needsReview` dentro de Movimientos y esta tab se saca.

- [ ] **Step 3: Banner en Inicio**

En `mobile/app/(tabs)/index.tsx`, arriba del bloque "Tu plata":

```tsx
          {pendingCount > 0 ? (
            <Pressable style={styles.banner} onPress={() => router.push('/(tabs)/inbox')}>
              <Text style={styles.bannerText}>
                Tenés {pendingCount} movimiento{pendingCount === 1 ? '' : 's'} para revisar
              </Text>
            </Pressable>
          ) : null}
```

con la misma query que la tab y los estilos:

```ts
  banner: {
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  bannerText: { color: colors.accent, fontWeight: '600' },
```

- [ ] **Step 4: Chequear tipos y probar**

Run: `cd mobile && npx tsc --noEmit`
Expected: sin errores. La tab aparece con el badge cuando hay pendientes.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(tabs\)/inbox.tsx mobile/app/\(tabs\)/_layout.tsx mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): add review inbox tab with pending badge"
```

---

### Task 17: Detalle de movimiento para confirmar

**Files:**
- Create: `mobile/app/movement/[id].tsx`
- Modify: `mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `GET /movements/:id`, `PATCH /movements/:id` con `{ description, clientId, needsReview: false }` (Task 14), `GET /clients`.
- Produces: pantalla de detalle reusable. **El spec de cuentas por cobrar (fase 5) necesita un detalle de factura: se reusa esta pantalla, no se escribe otra.**

- [ ] **Step 1: Escribir la pantalla**

Crear `mobile/app/movement/[id].tsx`:

```tsx
import { apiRequest, ApiError } from '@/src/api/client'
import type { Client, Movement } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

export default function MovementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { accessToken } = useAuth()
  const queryClient = useQueryClient()
  const router = useRouter()

  const [description, setDescription] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const movement = useQuery({
    queryKey: ['movement', id],
    queryFn: () => apiRequest<Movement>(`/movements/${id}`, { token: accessToken }),
    enabled: !!accessToken && !!id,
  })

  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiRequest<Client[]>('/clients', { token: accessToken }),
    enabled: !!accessToken,
  })

  useEffect(() => {
    if (movement.data) {
      setDescription(movement.data.description)
      setClientId(movement.data.clientId)
    }
  }, [movement.data])

  const confirm = useMutation({
    mutationFn: () =>
      apiRequest<Movement>(`/movements/${id}`, {
        method: 'PATCH',
        token: accessToken,
        body: { description: description.trim(), clientId, needsReview: false },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['movements'] })
      await queryClient.invalidateQueries({ queryKey: ['movement', id] })
      router.back()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo guardar'),
  })

  if (movement.isLoading || !movement.data) {
    return <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
  }

  const isIncome = movement.data.type === 'income'

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Text style={styles.amount}>
        {formatAmount(movement.data.amount, movement.data.currency)}
      </Text>
      <Text style={styles.meta}>
        {movement.data.wallet?.name} · {movement.data.source ?? 'manual'}
      </Text>

      <Text style={formStyles.label}>Descripción</Text>
      <TextInput
        style={formStyles.input}
        value={description}
        onChangeText={setDescription}
        placeholderTextColor={colors.muted}
      />

      {isIncome ? (
        <>
          <Text style={formStyles.label}>Cliente</Text>
          <View style={formStyles.rowWrap}>
            <Pressable
              style={[formStyles.chip, clientId === null && formStyles.chipActive]}
              onPress={() => setClientId(null)}
            >
              <Text
                style={[formStyles.chipText, clientId === null && formStyles.chipTextActive]}
              >
                Sin cliente
              </Text>
            </Pressable>
            {(clients.data ?? []).map((c) => (
              <Pressable
                key={c.id}
                style={[formStyles.chip, clientId === c.id && formStyles.chipActive]}
                onPress={() => setClientId(c.id)}
              >
                <Text
                  style={[formStyles.chipText, clientId === c.id && formStyles.chipTextActive]}
                >
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {error ? <Text style={formStyles.error}>{error}</Text> : null}

      <Pressable style={formStyles.button} onPress={() => confirm.mutate()} disabled={confirm.isPending}>
        {confirm.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={formStyles.buttonText}>Confirmar</Text>
        )}
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  amount: { fontSize: 28, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted },
})
```

- [ ] **Step 2: Registrar la ruta**

En `mobile/app/_layout.tsx`:

```tsx
            <Stack.Screen
              name="movement/[id]"
              options={{
                headerShown: true,
                title: 'Movimiento',
                headerStyle: { backgroundColor: colors.bg },
                headerShadowVisible: false,
              }}
            />
```

- [ ] **Step 3: Chequear tipos y probar el circuito**

Run: `cd mobile && npx tsc --noEmit`
Expected: sin errores. Con un movimiento importado: Revisar → tocar el ítem → cambiar descripción, elegir cliente → Confirmar → desaparece de la bandeja y el badge baja.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/movement/\[id\].tsx mobile/app/_layout.tsx
git commit -m "feat(mobile): edit and confirm imported movements"
```

---

### Task 18: Documentación, gate verde y smoke real diferido

**Files:**
- Modify: `README.md`
- Modify: `IMPLEMENTATION_PLAN.md` (fila 4 del roadmap)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Documentar en el README**

Agregar una sección "Integraciones" en `README.md`, en castellano, con:

- las variables de `.env.example` (`MP_*`, `INTEGRATIONS_ENCRYPTION_KEY`, `MOBILE_DEEP_LINK_SCHEME`) y cómo generar la clave: `openssl rand -base64 32`;
- el alta de la aplicación en el panel de MP: **PKCE tiene que estar habilitado** o el `code_challenge` se rechaza; el `redirect_uri` registrado tiene que ser byte-exacto contra `MP_REDIRECT_URI`;
- los endpoints nuevos:

```
| GET | `/integrations` | Estado de las integraciones (nunca devuelve credenciales) |
| POST | `/integrations/mercadopago/connect` | Devuelve la URL de autorización con PKCE |
| GET | `/integrations/mercadopago/callback` | Público: MP vuelve acá y rebota al deep link |
| POST | `/integrations/mercadopago/sync` | Backfill manual (30 días por defecto) |
| DELETE | `/integrations/mercadopago` | Desconecta sin borrar movimientos |
| POST | `/webhooks/mercadopago` | Webhook firmado HMAC-SHA256 |
```

- la nota de que el token de MP vive 180 días y el refresh es lazy: sin pagos por 180 días la conexión se cae y la pantalla pide "Reconectá Mercado Pago";
- que un reembolso **no** borra el movimiento original, postea uno compensatorio.

- [ ] **Step 2: Marcar la fase 4 en el roadmap**

En `IMPLEMENTATION_PLAN.md`, fila 4 de "Orden de ejecución": `[Integración Mercado Pago](docs/superpowers/specs/04-mercadopago.md) ✅ implementada (falta el smoke real, ver plan)`.

- [ ] **Step 3: Gate verde**

```bash
cd backend && npx tsc --noEmit && npm test
cd ../mobile && npx tsc --noEmit
```

Expected: todo en verde. Confirmar además que no se coló ningún secreto:

```bash
git status --short && git check-ignore -v .env backend/.env
```

- [ ] **Step 4: Commit**

```bash
git add README.md IMPLEMENTATION_PLAN.md
git commit -m "docs: document the Mercado Pago integration"
```

- [ ] **Step 5: Anotar el smoke real como pendiente (no se hace ahora)**

Esta parte **queda bloqueada** hasta que exista una URL HTTPS pública. Cuando la haya:

1. Dar de alta la aplicación en el panel de MP y **habilitar PKCE**.
2. Setear `MP_REDIRECT_URI=https://<host>/integrations/mercadopago/callback` — byte-exacto contra el registrado.
3. Configurar la notificación de `payment` apuntando a `https://<host>/webhooks/mercadopago` y copiar el secreto a `MP_WEBHOOK_SECRET`.
4. Conectar desde la app con una cuenta de prueba, generar un pago de test y verificar que aparece en la bandeja "Revisar" con el monto bruto y su comisión.
5. Recién ahí sacar el "(falta el smoke real…)" del roadmap.
