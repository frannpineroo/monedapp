# Spec 4 — Integración Mercado Pago

**Estado:** aprobado, sin implementar · **Tamaño:** XL

## Context

MonedApp is a multi-currency ledger for Argentine freelancers. Today every movement is typed by hand; the spec's core promise is "integraciones que ahorran carga manual" ([monedapp_spec.md:36](../../../monedapp_spec.md#L36)) with Mercado Pago as the first provider — deliberately left out of the core plan ([IMPLEMENTATION_PLAN.md:19](../../../IMPLEMENTATION_PLAN.md#L19)).

Outcome: a user connects their MP account once; approved payments arrive by webhook and auto-post as Movements (plus hidden double-entry ledger) into an auto-provisioned "Mercado Pago" wallet, flagged for review so the user can attach a client and fix the description. Balances and "cuánto facturé" become correct without manual loading.

The `Integration` model already exists in the schema and has **zero call sites** — this feature fills that empty slot.

### Decisions fixed by the user

| Decision | Choice |
|---|---|
| Connection | Full OAuth `authorization_code` + PKCE, refresh_token rotation |
| Ingestion | Webhooks only; spec's `POST /integrations/:provider/sync` kept as manual backfill escape hatch |
| Imported payments | Auto-post immediately, flagged `needsReview` |
| Fees | Gross income movement + separate fee expense movement |
| Mobile | Connect screen + status + review inbox |
| Dev tunnel | None available → real MP smoke test deferred; verification via signed synthetic webhooks |

## Verified Mercado Pago API facts

- **Authorize**: `https://auth.mercadopago.com.ar/authorization?client_id&response_type=code&platform_id=mp&state&redirect_uri&code_challenge&code_challenge_method=S256`. `redirect_uri` must be **byte-exact against the registered static HTTPS URI** — `monedapp://` can never be given to MP. Code lives 10 minutes. PKCE must be enabled in the MP Application panel.
- **Token**: `POST https://api.mercadopago.com/oauth/token` (JSON). Returns `access_token`, `refresh_token`, `expires_in` (**180 days**), `user_id`, `public_key`, `live_mode`. **`refresh_token` rotates on every refresh** — must persist the new one.
- **Webhook body**: `{ id, live_mode, type:"payment", action:"payment.created|payment.updated", user_id, data:{ id } }`. `user_id` = collector account id = join key to a MonedApp user.
- **Signature**: headers `x-signature: ts=…,v1=…` + `x-request-id`. Manifest template verbatim `id:{data.id};request-id:{x-request-id};ts:{ts};`, `data.id` from the **query string, lowercased**; absent pairs are **removed** from the manifest, not left empty. `HMAC-SHA256(secret, manifest)` hex, constant-time compare. **The body is not signed** → no `express.raw` carve-out needed. Secret is per-application.
- **Delivery contract**: 200/201 within 22s, else retry every 15 min.
- **Payment** `GET /v1/payments/{id}`: `status`, `status_detail`, `transaction_amount`, `transaction_amount_refunded`, `transaction_details.net_received_amount`, `currency_id` (`ARS`/`USD` for AR accounts, never `USDT`), `date_approved`/`date_last_updated` (ISO with `-03:00`), `collector_id`, `description`, `external_reference`.
- **Search** `GET /v1/payments/search`: `sort` is **required**; window < 365 days, only last 12 months searchable.

## Schema changes

`backend/prisma/schema.prisma` — all additions nullable or defaulted, so no backfill.

```prisma
model Movement {
  externalProvider  String?    // "mercadopago"
  externalId        String?    // "<id>" | "<id>:fee" | "<id>:reversal"
  externalStatus    String?
  externalUpdatedAt DateTime?  // MP date_last_updated — staleness guard
  needsReview       Boolean    @default(false)
  @@unique([userId, externalProvider, externalId])   // NULLs distinct → manual movements unaffected
  @@index([userId, needsReview])
}

model Wallet {
  externalProvider String?
  @@unique([userId, externalProvider, currency])
}

model Integration {              // model already exists; add:
  externalAccountId String?      // MP user_id / collector_id
  tokenExpiresAt    DateTime?
  lastError         String?
  lastWebhookAt     DateTime?
  @@unique([provider, externalAccountId])
}
```

Two new models: `IntegrationOAuthState` (`state @unique`, `codeVerifier`, `mobileRedirectUri`, `expiresAt`, `consumedAt`, userId FK cascade — mirrors the single-use server-side `RefreshToken` precedent) and `IntegrationWebhookEvent` (`@@unique([provider, notificationId])`, `resourceId`, `status received|processed|ignored|failed`, `error`, timestamps).

`Integration.credentials` keeps its name/type but stores **AES-256-GCM ciphertext** of `{accessToken, refreshToken, publicKey, scope, liveMode}` — satisfies the spec's `credentials (encriptado)`.

Migration: `npx prisma migrate dev --name add_mercadopago_integration --create-only`, **inspect the SQL for any `DROP`**, then apply. Never `db:push` (would drift `migration_lock.toml`).

## Backend modules

Follow existing conventions exactly: routes call prisma directly, business rules in `src/services/`, manual inline validation throwing `AppError(400, 'mensaje en español')`, no validation library, `asyncHandler` wrapping every handler, bare-JSON responses via `src/lib/serializers.ts`.

| File | Contents |
|---|---|
| `backend/src/lib/env.ts` (new) | `mpConfig()`, `integrationsEncryptionKey()`, `requiredEnv()`. **Lazy per-getter validation**, matching the `jwt.ts:4-7` style — eager boot validation would break `npm test`/`npm run dev` for anyone without MP configured. |
| `backend/src/lib/crypto.ts` (new) | `encryptSecret`/`decryptSecret`, AES-256-GCM, random 12-byte IV, format `v1.<iv>.<tag>.<ct>` (version prefix reserves a key-rotation path). Node builtin `crypto`, already used in `jwt.ts`. |
| `backend/src/lib/httpClient.ts` (new) | `requestJson<T>()` over Node 22 global `fetch` — no new dependency. `AbortSignal.timeout(10s)`, retry on network/429/5xx with backoff+jitter, never on other 4xx, throws `HttpError(status, body)`. Exports a **mutable `httpClient.fetch`** as the deliberate test seam. |
| `backend/src/services/mercadopago/mpClient.ts` (new) | `buildAuthorizationUrl`, `exchangeAuthorizationCode`, `refreshAccessToken`, `getPayment`, `searchPayments` (always sends `sort=date_created&criteria=desc&range=date_created`). |
| `backend/src/services/mercadopago/mpSignature.ts` (new) | `verifyWebhookSignature({xSignature,xRequestId,dataId,secret})`. Lowercase `dataId`, omit absent pairs, `timingSafeEqual` **guarded by a length pre-check** (it throws on mismatch). |
| `backend/src/services/mercadopago/mpPaymentMapper.ts` (new) | Pure, zero I/O, fully unit-testable. `mapPaymentToOutcome(payment)` → `post \| reverse \| skip \| unsupported_currency`. Also exports `argentineBusinessDate(iso)`. |
| `backend/src/services/integrationWalletService.ts` (new) | `ensureProviderWallet(tx, userId, provider, currency)` — Account(ASSET) + Wallet pair named `Mercado Pago ARS`, same two-step as `backend/src/routes/wallets.ts:43-61`. On `P2002` from `Account @@unique([userId,name])` fall back to `Mercado Pago ARS (integración)`. |
| `backend/src/services/mercadopago/mpOAuthService.ts` (new) | `startConnect`, `completeConnect`, `getValidAccessToken`, `disconnect`, `getIntegrationStatus`. |
| `backend/src/services/mercadopago/mpIngestionService.ts` (new) | `ingestPayment(userId, payment)`. |
| `backend/src/services/mercadopago/mpSyncService.ts` (new) | `syncMercadoPago(userId, {from,to})` — 30-day default, clamped to 365d/12mo, paginates `limit=50` up to 20 pages, routes every result through `ingestPayment` (so backfill of an already-webhooked payment is a no-op by construction). |
| `backend/src/routes/integrations.ts` (new) | `router.use(requireAuth)`. `GET /integrations`, `POST /:provider/connect` → `{authorizationUrl}`, `POST /:provider/sync`, `DELETE /:provider`. Provider guard: `if (provider !== 'mercadopago') throw new AppError(400, 'Proveedor no soportado')`. Matches the spec's endpoint names ([monedapp_spec.md:169-173](../../../monedapp_spec.md#L169-L173)). |
| `backend/src/routes/integrationsCallback.ts` (new) | `GET /integrations/:provider/callback` — **no `requireAuth`** (browser has no JWT); userId travels in the server-side `state` row. Always `302` back to the app deep link with `?status=connected` or `?status=error&reason=…`, never an error page. |
| `backend/src/routes/webhooks.ts` (new) | `POST /webhooks/mercadopago` — unauthenticated, HMAC-verified. |

### Mapping rules (`mpPaymentMapper.ts`)

| MP `status` | Outcome |
|---|---|
| `approved`, no refund | `post`: gross income + fee expense |
| `approved` + `transaction_amount_refunded > 0` | `post` + `reverse` for the refunded delta |
| `refunded`, `charged_back` | `reverse`: compensating expense |
| `pending`, `in_process`, `authorized`, `in_mediation`, `rejected`, `cancelled` | `skip` |

- **Amount**: income = **gross `transaction_amount`** rounded to 2dp; second `expense` movement of `transaction_amount − transaction_details.net_received_amount` with `externalId "<id>:fee"`, description `'Comisión Mercado Pago'`, `needsReview: false`, emitted only when the delta is > 0.
- **Date — the sharp edge**: MP returns `…T22:30:00.000-03:00`. Copying [parseDate](../../../backend/src/routes/movements.ts#L30-L36) blindly (it takes `getUTCFullYear/Month/Date`) shifts **every evening payment to the next day**. `argentineBusinessDate` subtracts 3h before truncating. Mandatory unit test.
- **Description**: `description?.trim() || external_reference || 'Cobro Mercado Pago'`; income movement gets `needsReview: true`.
- **Reversal**: `externalId "<id>:reversal"`, `type: expense`, `needsReview: true`, `'Reembolso Mercado Pago'` / `'Contracargo Mercado Pago'`.
- **Currency**: `ARS`/`USD` map to the enum; anything else → `unsupported_currency` (recorded, not posted).

### OAuth service behaviour

- `startConnect`: `randomBytes(32).toString('base64url')` for `state` and `codeVerifier`; challenge = `base64url(sha256(verifier))`; 10-minute TTL matching MP's code lifetime; **validate `mobileRedirectUri` against the app scheme** (open-redirect defence), allowing the `exp://` form when `NODE_ENV !== 'production'` or Expo Go testing is impossible.
- `completeConnect`: single-use consumption via `updateMany({where:{state, consumedAt:null, expiresAt:{gt:now}}, data:{consumedAt:now}})` asserting `count === 1` — atomic compare-and-set, no race. Then exchange → `integration.upsert` → `ensureProviderWallet(ARS)` eagerly so the connect screen shows a wallet immediately.
- `getValidAccessToken`: decrypt; refresh proactively when `tokenExpiresAt` is within 30 days and **persist the rotated refresh_token**; callers retry once on `HttpError(401)` after a forced refresh.
- `disconnect`: sets `status:'disconnected'`, clears credentials. **Does not delete the wallet or its movements** — real ledger history.

### Ingestion flow (`ingestPayment`)

Hoist `resolveExchangeRateId(currency, date, 'blue')` **before** the transaction (it uses the non-tx `prisma` client and is idempotent), then in one `prisma.$transaction`:

1. `SELECT pg_advisory_xact_lock(hashtextextended('mp:'||userId, 0))` — serialises MP ingestion per user without a job queue; released on commit/rollback.
2. Staleness guard: if the stored `externalUpdatedAt >= payment.date_last_updated`, return `skipped:'stale'`.
3. `mapPaymentToOutcome` → `ensureProviderWallet(tx, …)`.
4. Per mapped movement: `tx.movement.create(...)` then `createLedgerForMovement(tx, {...})` — the exact shape at [movements.ts:140-148](../../../backend/src/routes/movements.ts#L140-L148). `P2002` on the dedupe index is caught and treated as success.

Income posts `+amount` to the MP wallet Account and `−amount` to `getDefaultIncomeAccountId`; the fee expense posts `+fee` to `getDefaultExpenseAccountId` and `−fee` to the MP wallet. `assertBalanced` holds unchanged.

### Webhook handler + retry contract

1. Verify signature → **401** if invalid.
2. `type !== 'payment'` → 200 `{ignored:true}`.
3. Insert `IntegrationWebhookEvent`; `P2002` → duplicate delivery → **200 immediately**.
4. Find `Integration` by `externalAccountId = String(body.user_id)`, `status:'connected'`. None → mark `ignored`, **200** (a 4xx would make MP retry a permanently unmatched event for days).
5. `getValidAccessToken` → `getPayment(token, data.id)`; assert `collector_id` matches.
6. `ingestPayment` → mark `processed` → 200.

Transient failures (MP 5xx, timeout, DB error) → **500**, converting into a free MP retry. Processing stays synchronous: with no job queue, a 200-then-`setImmediate` crash would lose the event permanently.

### Edits to existing files

- `backend/src/app.ts` — mount in order: public `integrationsCallbackRouter` at `/integrations`, then authed `integrationsRouter` at `/integrations`, then `webhooksRouter` at `/webhooks`.
- `backend/src/lib/serializers.ts` — `serializeMovement` gains `needsReview` + `source`; new `serializeIntegration` that **never** emits `credentials`.
- `backend/src/routes/movements.ts` — `GET` accepts `needsReview` and `source` filters; `PATCH /:id` (already exists at line 174) accepts `needsReview: false` as the "confirmar" action.
- Root `.env.example` and `README.md`.

## Idempotency & concurrency

| Scenario | Mechanism |
|---|---|
| Same notification redelivered | `IntegrationWebhookEvent @@unique([provider, notificationId])` → 200 |
| `payment.created` then `payment.updated` (different notification ids) | `Movement @@unique([userId, externalProvider, externalId])` → `P2002` treated as success |
| Concurrent deliveries | `pg_advisory_xact_lock` per user; loser hits the staleness guard |
| Out-of-order updates | Both events re-fetch the *current* payment, so they converge; `externalUpdatedAt` blocks the stale one |
| Refund / chargeback after auto-post | Never mutate or delete the income movement (`LedgerEntry` cascades on delete — deleting would vaporise entries). Post a compensating expense so the wallet nets out, `needsReview: true` |
| Backfill re-ingesting a webhooked payment | Same `ingestPayment` path → deduped |

## Secrets & config

New vars in root `.env.example` (README's `cp .env backend/.env` propagates them), read **only** through `lib/env.ts`:

```bash
MP_CLIENT_ID=
MP_CLIENT_SECRET=
MP_REDIRECT_URI=https://<host-publico>/integrations/mercadopago/callback
MP_WEBHOOK_SECRET=
MP_AUTH_BASE_URL=https://auth.mercadopago.com.ar
MP_API_BASE_URL=https://api.mercadopago.com
MP_USE_TEST_TOKEN=false
INTEGRATIONS_ENCRYPTION_KEY=   # openssl rand -base64 32 → must decode to exactly 32 bytes
MOBILE_DEEP_LINK_SCHEME=monedapp
```

`.env` and `backend/.env` are already gitignored — verify before committing.

## Mobile (Expo SDK 57 — read https://docs.expo.dev/versions/v57.0.0/ per `mobile/AGENTS.md`)

MP requires a static HTTPS `redirect_uri`, so the **backend** is the redirect target and bounces into the app:

```
1. app → POST /integrations/mercadopago/connect (Bearer JWT)
         body { mobileRedirectUri: Linking.createURL('integrations/mercadopago') }
      ← { authorizationUrl }
2. app : WebBrowser.openAuthSessionAsync(authorizationUrl, returnUrl)
3. MP  → GET https://<host>/integrations/mercadopago/callback?code&state
         backend exchanges code, encrypts+stores tokens, provisions MP wallet
4. backend → 302 monedapp://integrations/mercadopago?status=connected
5. auth session resolves { type:'success', url } → Linking.parse(url).queryParams.status
```

`expo-web-browser` and `expo-linking` are **already installed** (currently unused) and `expo.scheme` is already `"monedapp"` — **no new dependency**, no `expo-auth-session`, no `expo-secure-store`. Add `"expo-web-browser"` to `plugins` in `mobile/app.json`.

| File | Change |
|---|---|
| `mobile/app/integrations.tsx` (new) | Status card (`Conectado`/`Desconectado`/`Error`), `lastSyncAt` in es-AR, Conectar / Sincronizar ahora / Desconectar |
| `mobile/app/(tabs)/inbox.tsx` (new) | 4th tab "Revisar": `FlatList` of `GET /movements?needsReview=true`, `RefreshControl` from `isFetching`, empty state |
| `mobile/app/movement/[id].tsx` (new) | Edit description + client chips → `PATCH` with `{description, clientId, needsReview:false}` |
| `mobile/app/_layout.tsx`, `(tabs)/_layout.tsx`, `(tabs)/index.tsx` | Register stack screens; add inbox tab with pending-count badge; Home link to `/integrations` + review banner |
| `mobile/src/api/types.ts` | `Integration`, `ConnectResponse`, `SyncResult`; `Movement` gains `needsReview`, `source` |

Conventions kept as-is: inline `useQuery`/`useMutation` in screens (no hooks dir), per-screen `StyleSheet.create` using `colors` from `mobile/src/theme.ts`, no shared primitives. New query keys `['integrations']`, `['movements',{needsReview:true}]`. Invalidate `['integrations']`, `['movements']` (partial), `['balance-by-wallet']`, `['wallets']` after connect/sync/confirm.

## Verification

**Unit (no DB, no network)** — `backend/tests/`:
- `crypto.test.ts` — roundtrip, ciphertext differs per call, tampered tag throws.
- `mpSignature.test.ts` — golden hex vector for secret `'test-secret'`, `ts=1704908010`, `x-request-id='bb56a2f1-6aae-46ac-982e-9dcd3581d08e'`, `data.id='999999999'` → manifest `id:999999999;request-id:bb56a2f1-6aae-46ac-982e-9dcd3581d08e;ts:1704908010;`. Negatives: wrong secret; uppercase `data.id` still passes; missing `x-request-id` yields `id:…;ts:…;`; length-mismatched `v1` returns false rather than throwing.
- `mpPaymentMapper.test.ts` — status matrix, currency mapping, fee split, rounding, and `argentineBusinessDate('2026-08-14T22:30:00.000-03:00') === 2026-08-14T00:00:00.000Z` (not the 15th).

**Faking MP HTTP** — swap `httpClient.fetch` in `beforeEach`, restore in `afterEach`; fixtures in `backend/tests/helpers/mpFixtures.ts` (`approvedPayment`, `refundedPayment`, `pendingPayment`, `tokenResponse`, URL-routing `fakeMpFetch`). Preferred over `vi.stubGlobal` — explicit seam, survives import-time capture.

**Integration (real DB + Supertest, matching `backend/tests/auth.test.ts`)** — `backend/tests/integrationsMercadoPago.test.ts` with helpers `registerAndOnboard`, `seedConnectedIntegration`, `signWebhook`, `cleanupUser`. Set `process.env.MP_WEBHOOK_SECRET ??= …` and `INTEGRATIONS_ENCRYPTION_KEY ??= …` before importing `createApp`. `afterAll` **must** call `cleanupUser` (unlike `auth.test.ts`) because `@@unique([provider, externalAccountId])` makes leftover rows collide; use `String(Date.now())` as the external account id.

Cases: (1) signed approved ARS payment → 2 movements, `sum(ledger_entries.change) === 0`; (2) replayed notification → still 2; (3) `payment.updated`, new notification id → still 2; (4) bad signature → 401, 0 movements; (5) unknown `user_id` → 200 + event `ignored`; (6) refund → third `:reversal` movement, ledger still 0; (7) `pending` → 0 movements; (8) sync creates 2 then 0 on re-run; (9) connect → `authorizationUrl` contains `code_challenge`, callback 302s to `monedapp://…?status=connected`, `GET /integrations` never leaks `credentials`; (10) `needsReview` filter + `PATCH` clears the flag.

**Green gate**: `cd backend && npx tsc --noEmit && npm test` and `cd mobile && npx tsc --noEmit`.

**Manual**: `cd mobile && npx expo start` → Integraciones screen → (with MP unreachable, the connect flow is exercised against the fake token endpoint) → inbox shows the auto-posted movement → edit + confirm removes it from the inbox and updates `GET /movements`.

## Task order

1. Schema + `--create-only` migration; inspect SQL for `DROP`.
2. Apply migration, `prisma generate`, `tsc --noEmit`.
3. `lib/env.ts` + `lib/crypto.ts` + `.env.example` → `crypto.test.ts`.
4. `lib/httpClient.ts` + retry/timeout test.
5. `mpSignature.ts` → `mpSignature.test.ts`.
6. `mpPaymentMapper.ts` → `mpPaymentMapper.test.ts`.
7. `mpClient.ts` — assert exact `/oauth/token` body and `sort` on search.
8. `integrationWalletService.ts` — calling twice yields one wallet.
9. `mpOAuthService.ts` + both integrations routes + `app.ts` mounts → case 9.
10. `mpIngestionService.ts` + `routes/webhooks.ts` → cases 1–7.
11. `mpSyncService.ts` → case 8.
12. Serializers + movements filters/PATCH → case 10.
13. Mobile types + `app.json` plugin → `tsc --noEmit`.
14. `integrations.tsx` + Home link + stack registration.
15. `inbox.tsx` + tab.
16. `movement/[id].tsx` edit+confirm.
17. README (Spanish) + `.env.example` docs.
18. **Deferred**: real MP sandbox smoke once a public tunnel exists — register the app, set `MP_REDIRECT_URI`, configure the webhook, run a live connect + test payment.

Per [.cursor/rules/push-after-task.mdc](../../../.cursor/rules/push-after-task.mdc): commit and push after each finished task, English commit messages, never commit `.env`.

## Risks

1. **No public HTTPS URL yet** → MP cannot reach the callback or the webhook. Everything is built and tested against signed synthetic requests; live verification is task 18.
2. **PKCE must be enabled** in the MP Application panel or `code_challenge` is rejected.
3. **180-day token expiry, no cron.** Refresh is lazy; a user with no payments for 180 days silently drops out. `getValidAccessToken` sets `status:'error'` + a Spanish `lastError` the connect screen surfaces as "Reconectá Mercado Pago".
4. **Missed webhooks recoverable only via manual sync** — that is why the sync endpoint stays.
5. **Buenos Aires date truncation** — silent off-by-one-day if `parseDate` is copied. Guarded by a unit test.
6. **Gross-vs-net is baked into the ledger**; changing it later means migrating posted movements.
7. **Second partial refund** on one payment collides on `<id>:reversal` and is swallowed as a duplicate. Documented, not fixed.
8. **`assertBalanced` uses float arithmetic** ([ledgerService.ts:7-12](../../../backend/src/services/ledgerService.ts#L7-L12)) — pre-existing; rounding in the mapper before building `Prisma.Decimal` keeps MP amounts safe.
9. **Encryption key loss** = every connection dead, users must reconnect. No backup story yet.

## Out of scope

Stripe / Hotmart (`provider` stays a `String`) · `merchant_order` / `chargebacks` / `orders` webhook topics · automatic client matching from `payer.email` (that is what `needsReview` defers to the human) · background jobs, cron, proactive token refresh, queues · multiple MP accounts per user · real exchange-rate provider (MP movements use the same `'blue'` stub) · per-`fee_details.type` expense accounts · freemium gating of integrations · mobile refresh-token flow in `AuthContext` (still unimplemented) · push notifications · mobile tests (no setup exists).
