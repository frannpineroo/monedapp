# Spec 1 — Cotización real (dolarapi)

**Estado:** aprobado, sin implementar · **Tamaño:** M

## Contexto

El tipo de cambio es un stub: `STUB_RATES = {oficial:980, blue:1280, mep:1210}` en [exchangeRateService.ts:5](../../../backend/src/services/exchangeRateService.ts#L5) y en [prisma/seed.ts:9](../../../backend/prisma/seed.ts#L9). Cada `Movement` guarda `exchangeRateId` obligatorio, así que hoy todos los movimientos en USD quedan sellados con un número inventado — el snapshot histórico, que es el punto central del spec de producto ("tipo de cambio registrado en cada asiento en el momento en que ocurre", [monedapp_spec.md:29-34](../../../monedapp_spec.md#L29-L34)), no vale nada.

Objetivo: cotización real (oficial/blue/MEP/cripto) con caché en DB y cascada de fallback, y selector de cotización en la app al cargar movimientos en moneda no-ARS.

Fuentes verificadas el 2026-08-14, ambas sin autenticación:

- Actual: `GET https://dolarapi.com/v1/dolares/{casa}` → `{moneda, casa, nombre, compra, venta, fechaActualizacion}`. Casas disponibles: `oficial`, `blue`, `bolsa`, `contadoconliqui`, `mayorista`, `cripto`, `tarjeta`.
- Histórico: `GET https://api.argentinadatos.com/v1/cotizaciones/dolares/{casa}/{yyyy/MM/dd}` → `{casa, compra, venta, fecha}`.

## Decisiones tomadas

- Enum nuevo `ExchangeRateType.cripto` → mapea a `casa=cripto`; es el default para `USDT`.
- `ExchangeRate` guarda `buy` y `sell`; `value` sigue existiendo y queda igual a `sell` (venta), para no romper nada que ya lo lea.
- Fallback en cascada, el movimiento nunca falla: API real → última cotización en DB → constante stub. `source` registra cuál se usó.

## Backend

### 1. Schema + migraciones

```prisma
enum ExchangeRateType { oficial blue mep cripto }

model ExchangeRate {
  // ...existente
  value Decimal  @db.Decimal(18, 6)   // = sell
  buy   Decimal? @db.Decimal(18, 6)
  sell  Decimal? @db.Decimal(18, 6)
}
```

**Dos migraciones separadas, no una.** Postgres no permite usar un valor de enum recién agregado en la misma transacción que el `ALTER TYPE ... ADD VALUE`, y Prisma corre cada migración en una transacción:

1. `add_cripto_exchange_rate_type` — solo `ALTER TYPE "ExchangeRateType" ADD VALUE 'cripto';`
2. `add_exchange_rate_buy_sell` — columnas `buy`/`sell` nullable.

### 2. Nuevo `backend/src/services/fxProvider.ts`

Todo el I/O de red aislado acá, para que el service quede testeable.

- `CASA_BY_TYPE: Record<ExchangeRateType, string>` = `{ oficial:'oficial', blue:'blue', mep:'bolsa', cripto:'cripto' }`.
- `fetchLiveRate(type): Promise<{buy, sell, source:'dolarapi'} | null>` — `fetch` con `AbortSignal.timeout(FX_TIMEOUT_MS)`; valida que `compra`/`venta` sean números finitos; devuelve `null` ante cualquier error, nunca lanza.
- `fetchHistoricalRate(type, date): Promise<{buy, sell, source:'argentinadatos'} | null>` — misma forma, path `yyyy/MM/dd` en UTC.
- Config por env con defaults: `FX_BASE_URL`, `FX_HISTORICAL_BASE_URL`, `FX_TIMEOUT_MS=4000`, `FX_ENABLED=true`. Los tests setean `FX_ENABLED=false` para no pegarle a la red.

### 3. Reescribir `backend/src/services/exchangeRateService.ts`

Mantener las firmas públicas actuales (`ensureRateForDate`, `getRates`, `resolveExchangeRateId`, `parseExchangeRateType`) — las consumen [routes/movements.ts:122](../../../backend/src/routes/movements.ts#L122) y [routes/exchangeRates.ts:25](../../../backend/src/routes/exchangeRates.ts#L25).

- `defaultTypeForCurrency(currency)`: `USDT → cripto`, resto → `blue`. Usarla como default en `resolveExchangeRateId` y en `POST /movements`, en vez del `blue` fijo actual.
- `typesForCurrency(currency)`: `USD → [oficial, blue, mep]`, `USDT → [cripto]`, `ARS → []`.
- `ensureRateForDate(date, currency, type)` pasa a ser la cascada:
  1. `ARS` → upsert `value/buy/sell = 1`, `source: 'fixed'`.
  2. Cache: si existe fila `(date,type,currency)` con `source !== 'stub'` → devolverla sin tocar la red.
  3. Fecha = hoy (UTC) → `fetchLiveRate`; fecha pasada → `fetchHistoricalRate`. Si hay datos → upsert con `value = sell` y el `source` del provider.
  4. Fallback DB: `findFirst` de esa `currency`+`type` ordenado por `date desc` → upsert copiando valores con `source: 'db-fallback'`.
  5. Último recurso: `STUB_RATES` (se conserva la constante) con `source: 'stub'`.
- `getRates`: reemplazar el loop secuencial de [:59-63](../../../backend/src/services/exchangeRateService.ts#L59-L63) por `Promise.all` sobre `typesForCurrency(currency)`.
- `parseExchangeRateType`: mensaje de error actualizado a `(oficial|blue|mep|cripto)`.

### 4. Exposición en la API

- `GET /exchange-rates` ([routes/exchangeRates.ts:26](../../../backend/src/routes/exchangeRates.ts#L26)): agregar `buy` y `sell` al objeto devuelto. `source` ya se devuelve y ahora distingue `dolarapi` / `argentinadatos` / `db-fallback` / `stub` / `fixed`.
- `serializeMovement` ([lib/serializers.ts:23](../../../backend/src/lib/serializers.ts#L23)): agregar `exchangeRate?: {type, value, source, date}` cuando venga incluido; sumar `exchangeRate: { select: {...} }` a `movementInclude` ([routes/movements.ts:18](../../../backend/src/routes/movements.ts#L18)). Así la app muestra el equivalente en ARS sin una request extra.
- `POST /movements`: sin cambios de contrato — ya acepta `exchangeRateType` ([:89](../../../backend/src/routes/movements.ts#L89)); solo cambia el default (por moneda) y ahora acepta `cripto`.

### 5. Seed

[prisma/seed.ts](../../../backend/prisma/seed.ts): intentar `getRates` real para hoy (USD y USDT) y caer al stub actual si no hay red. ARS sigue en 1.

### 6. Tests `backend/tests/exchangeRates.test.ts`

Vitest + supertest como [tests/auth.test.ts](../../../backend/tests/auth.test.ts) (Postgres real). `fetch` mockeado:

- `fetch` OK → fila con `source:'dolarapi'`, `value === sell`.
- `fetch` que rechaza + fila previa en DB → `source:'db-fallback'` con el valor previo.
- `fetch` que rechaza + DB vacía → `source:'stub'`.
- Segunda llamada con misma fecha/tipo no vuelve a llamar `fetch` (cache hit).
- `ARS` → value 1 sin tocar la red.
- `GET /exchange-rates?currency=USD` autenticado → 3 tipos con `buy`/`sell`; `currency=USDT` → `cripto`.
- `POST /movements` con `exchangeRateType:'cripto'` en wallet USDT → 201 y `exchangeRate.type === 'cripto'`.

## Mobile

- [mobile/src/api/types.ts](../../../mobile/src/api/types.ts): `ExchangeRate = {id, date, type, currency, value, buy, sell, source}` y `exchangeRate?: ExchangeRate` en `Movement`.
- [mobile/app/(tabs)/new-movement.tsx](../../../mobile/app/%28tabs%29/new-movement.tsx): cuando la wallet seleccionada tenga `currency !== 'ARS'`,
  - `useQuery` con key `['exchange-rates', currency, today]` → `GET /exchange-rates?currency=…&date=…`, mismo patrón inline de `wallets`/`clients`;
  - fila de chips "Cotización" reusando los estilos `chip/chipActive` de esa pantalla, una por tipo devuelto, con el valor formateado; default = primer tipo (`blue` para USD, `cripto` para USDT);
  - preview bajo el monto: `≈ ARS {amount × sell}`, con nota discreta si `source` es `db-fallback`/`stub` ("cotización estimada");
  - enviar `exchangeRateType` en el body del `POST /movements`.
- [mobile/app/(tabs)/movements.tsx](../../../mobile/app/%28tabs%29/movements.tsx): en items con `currency !== 'ARS'`, subtítulo con el tipo y valor del snapshot (`blue $1.530`), leído de `movement.exchangeRate`.

## Fuera de alcance

Conversión a ARS en el ledger y los reportes (los asientos siguen por moneda), job de refresco programado, casas `tarjeta`/CCL/mayorista, y la pantalla de reportes mensuales.

## Verificación

1. `docker compose up -d db` · `cd backend && npx prisma migrate dev` (las dos migraciones aplican en orden).
2. `npm run seed` → imprime cotizaciones reales del día, o avisa que cayó al fallback.
3. `npm test` → auth + exchange rates en verde.
4. Manual con token:
   - `GET /exchange-rates?currency=USD` → 3 tipos, `source: "dolarapi"`, valores cercanos al mercado.
   - `GET /exchange-rates?currency=USD&date=2026-07-18` → `source: "argentinadatos"`, blue ≈ 1530.
   - Con `FX_ENABLED=false` → `source: "db-fallback"`, sin error 5xx.
   - `POST /movements` en wallet USD con `exchangeRateType:"mep"` → 201, `exchangeRate.type === "mep"`.
5. App: `cd mobile && npx expo start` → un movimiento nuevo en wallet USD muestra chips de cotización y el equivalente en ARS; el movimiento guardado aparece en la lista con el tipo y valor usados.
6. Actualizar `.env.example` con `FX_BASE_URL`, `FX_HISTORICAL_BASE_URL`, `FX_TIMEOUT_MS`, `FX_ENABLED`, y la fila de cotización en `README.md` / `IMPLEMENTATION_PLAN.md` (deja de ser stub).
