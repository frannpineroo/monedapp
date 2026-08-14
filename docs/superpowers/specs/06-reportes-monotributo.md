# Spec 6 — Reportes mensuales + alerta de monotributo

**Estado:** aprobado, sin implementar · **Tamaño:** M/L

## Contexto

Hoy el único reporte es `GET /reports/balance-by-wallet` ([routes/reports.ts:10](../../../backend/src/routes/reports.ts#L10)), que responde "cuánto tengo". Falta lo que el spec de producto marca como diferencial ([monedapp_spec.md:42-46](../../../monedapp_spec.md#L42-L46)): "cuánto facturé este mes", "cuánto me queda libre después de impuestos" y la alerta de techo de monotributo. El campo `User.monotributoCategory` existe desde el schema inicial pero nunca se setea ni se lee: no hay endpoint ni UI.

La partida doble ya guarda todo lo necesario: cada `Movement` tiene `exchangeRateId` obligatorio, así que un ingreso en USD se convierte a ARS con **su** cotización histórica, no con la de hoy.

## Decisiones tomadas

- Ventana de la alerta: **12 meses móviles** (criterio de recategorización de ARCA).
- Escalas de monotributo: **tabla en DB cargada por seed**, con `validFrom` para conservar histórico.
- "Cuánto me queda libre" = `ingresos − gastos − cuota mensual de monotributo`.
- Resumen mensual: **desglose por moneda + total ARS consolidado**. El total ARS alimenta la alerta.

## Dependencias con otros specs

- Con [cotización real](01-cotizacion-real-dolarapi.md) implementado, los totales en ARS valen de verdad; sin él, los reportes son correctos pero sobre cotizaciones inventadas.
- Con [categorías](03-categorias.md), reusar `reportService.toArs` y `sumByCategory` en vez de duplicarlos.
- Con [cuentas por cobrar](05-cuentas-por-cobrar.md), "cuánto facturé" debe contar `invoice` (devengado) y **no** `income`, y la conversión a ARS puede salir directo de `LedgerEntry.changeArs`.

## Backend

### 1. Schema + migración `add_monotributo_scales`

```prisma
model MonotributoScale {
  id                 String   @id @default(cuid())
  category           String   // "A".."K"
  validFrom          DateTime @db.Date
  annualGrossLimit   Decimal  @db.Decimal(18, 2)
  monthlyFeeServices Decimal  @db.Decimal(18, 2)
  createdAt          DateTime @default(now())

  @@unique([category, validFrom])
  @@index([validFrom])
  @@map("monotributo_scales")
}
```

### 2. Escalas + seed

`backend/src/config/monotributoScales.ts` (nuevo) con la tabla vigente **desde 2026-08-01** (fuente: `afip.gob.ar/monotributo/categorias.asp`, "locaciones y prestaciones de servicios"), en pesos: límite anual / cuota mensual.

| Cat. | Límite anual | Cuota mensual |
|---|---|---|
| A | 12.009.410,45 | 49.527,18 |
| B | 17.595.182,74 | 56.379,08 |
| C | 24.670.494,31 | 66.020,12 |
| D | 30.628.651,43 | 84.612,93 |
| E | 36.028.231,33 | 119.811,45 |
| F | 45.151.659,41 | 150.784,21 |
| G | 53.995.798,87 | 230.312,94 |
| H | 81.924.660,37 | 522.706,68 |
| I | 91.699.761,90 | 963.747,86 |
| J | 105.012.519,20 | 1.167.299,76 |
| K | 126.610.838,75 | 1.614.446,04 |

`ensureMonotributoScales()` exportado del mismo módulo: upsert idempotente por `(category, validFrom)`. Lo llama [prisma/seed.ts](../../../backend/prisma/seed.ts) y también los tests, así no dependen del seed manual. Actualizar escalas a futuro = agregar un bloque con otro `validFrom` y correr el seed; las consultas toman siempre el `validFrom` más reciente ≤ fecha de referencia.

### 3. `backend/src/services/reportService.ts`

- `activeScales(at: Date)` — escalas del `validFrom` máximo ≤ `at`, ordenadas por límite ascendente.
- `toArs(amount, exchangeRateValue)` — `amount × value`; para ARS el value ya es 1 (garantizado por la rama ARS de `ensureRateForDate`, [exchangeRateService.ts:20](../../../backend/src/services/exchangeRateService.ts#L20)).
- `getMonthlySummary(userId, month /* "YYYY-MM", default mes actual */)`:
  - `movement.findMany` del rango en UTC, con `include: { exchangeRate: { select: { value: true, type: true } }, client: { select: { id: true, name: true } } }`.
  - Agregación en JS (el volumen es chico y evita SQL crudo): `byCurrency: { [currency]: { income, expense, net } }`, `incomeArs`, `expenseArs`.
  - `topClients`: top 5 por ingreso en ARS del mes (`clientId` null → "Sin cliente").
  - `tax`: cuota de la categoría del usuario; si `monotributoCategory` es null, usa la **sugerida** por la alerta y lo marca con `taxSource: 'suggested' | 'user'`.
  - `netAfterTax = incomeArs − expenseArs − monthlyFee`.
  - Las transferencias se excluyen de ingresos y gastos: mueven plata entre billeteras propias, no facturan.
- `getMonotributoAlert(userId, now = new Date())`:
  - Ventana `now − 12 meses` → `now`; suma ingresos convertidos a ARS, sin transferencias.
  - `suggestedCategory` = primera escala con `annualGrossLimit ≥ incomeArs12m`; si ninguna alcanza → `null` con `status: 'exceeded'`.
  - `status`: `'unset'` (sin categoría elegida) · `'ok'` (<80% del límite de su categoría) · `'warning'` (80–100%) · `'exceeded'` (>100%).
  - Devuelve además `limit`, `percentUsed`, `remaining`, `windowFrom`/`windowTo`, `monthlyFee` y el listado de `scales`, para que la app arme el selector sin request extra.

### 4. Rutas

- [routes/reports.ts](../../../backend/src/routes/reports.ts): `GET /reports/monthly-summary?month=YYYY-MM` (400 si no matchea `^\d{4}-\d{2}$`) y `GET /reports/monotributo-alert`. `router.use(requireAuth)` ya está arriba.
- `backend/src/routes/users.ts` (nuevo, montado `app.use('/users', usersRouter)` en [app.ts:22](../../../backend/src/app.ts#L22), antes del `onboardingRouter` — no colisiona con `POST /users/me/onboarding`, que cae por `next()`):
  - `GET /users/me`
  - `PATCH /users/me { monotributoCategory }` — valida contra `activeScales`, acepta `null` para desactivar.
  - Reusar el serializador `publicUser` de [routes/auth.ts:16](../../../backend/src/routes/auth.ts#L16): moverlo a [lib/serializers.ts](../../../backend/src/lib/serializers.ts) como `serializeUser` e importarlo desde `auth.ts`, `onboarding.ts` y `users.ts` — hoy la forma está duplicada en los tres lugares.

### 5. Tests `backend/tests/reports.test.ts`

Setup: registrar usuario → onboarding `freelancer_software` → `ensureMonotributoScales()`.

- Ingreso ARS + ingreso USD en el mismo mes → `byCurrency` correcto e `incomeArs` = ARS + USD×cotización.
- Gasto ARS → `expenseArs` y `netAfterTax = income − expense − cuota`.
- Transferencia entre wallets → **no** mueve `incomeArs` ni `expenseArs`.
- Movimiento de otro mes → no entra en el resumen del mes pedido.
- `month` inválido → 400.
- Alerta sin categoría → `status: 'unset'` + `suggestedCategory` coherente con el ingreso cargado.
- `PATCH /users/me` con categoría válida → 200 y la alerta pasa a `ok`/`warning` según el monto; categoría inexistente → 400.
- Movimiento de hace 13 meses → queda fuera de la ventana móvil.

## Mobile

- [mobile/src/api/types.ts](../../../mobile/src/api/types.ts): `MonthlySummary`, `MonotributoAlert`, `MonotributoScale`.
- [mobile/app/(tabs)/_layout.tsx](../../../mobile/app/%28tabs%29/_layout.tsx): pestaña `reports`, título "Reportes", icono FontAwesome `pie-chart`.
- `mobile/app/(tabs)/reports.tsx`, siguiendo el patrón de [index.tsx](../../../mobile/app/%28tabs%29/index.tsx) (`useQuery` inline, `RefreshControl`, `StyleSheet` local, `colors` de [theme.ts](../../../mobile/src/theme.ts)):
  - Selector de mes con flechas ‹ › sobre un `useState('YYYY-MM')`; query key `['monthly-summary', month]`.
  - Tarjeta "Facturaste": total ARS grande + desglose por moneda; tarjeta "Gastaste"; tarjeta "Te queda libre" con la línea `− cuota monotributo (cat. X)` y aclaración si la categoría es sugerida.
  - Lista de top clientes del mes.
  - Bloque monotributo: barra de progreso (`View` con ancho `%` sobre `colors.accentSoft`/`colors.accent` — hoy `accentSoft` está definido y sin uso), texto "Usaste X% del techo de la categoría Y", y chips A–K que hacen `PATCH /users/me` vía `useMutation` → `invalidateQueries(['monotributo-alert'])` + `setUser` de [AuthContext](../../../mobile/src/auth/AuthContext.tsx).
  - Estados de error visibles (`isError`), a diferencia de las pantallas actuales que muestran vacío ante un fallo.
- [mobile/src/lib/format.ts](../../../mobile/src/lib/format.ts): agregar `formatArs(value)` (sin decimales, es plata grande) y `formatPercent`; reusar `formatAmount` para el desglose por moneda.
- [mobile/app/(tabs)/index.tsx](../../../mobile/app/%28tabs%29/index.tsx): banner compacto cuando `status` sea `warning` o `exceeded`, que navega a Reportes. Reusa la query `['monotributo-alert']`.

## Fuera de alcance

Recategorización automática, componente impositivo/previsional desglosado, escalas de "venta de cosas muebles", export a PDF/CSV para el contador, y notificaciones push de la alerta.

## Verificación

1. `docker compose up -d db` · `cd backend && npx prisma migrate dev` · `npm run seed` → 11 escalas cargadas (`select count(*) from monotributo_scales;`).
2. `npm test` → auth + reports en verde.
3. Manual con token, tras cargar un ingreso ARS, uno USD y un gasto:
   - `GET /reports/monthly-summary` sin `month` → mes actual, `byCurrency` con ARS y USD, `incomeArs` = suma convertida, `netAfterTax` = ingresos − gastos − cuota.
   - `GET /reports/monotributo-alert` → `status: "unset"`, `suggestedCategory: "A"` con montos chicos.
   - `PATCH /users/me {"monotributoCategory":"A"}` → 200; repetir la alerta → `status: "ok"` y `percentUsed` coherente.
   - `PATCH /users/me {"monotributoCategory":"Z"}` → 400.
4. App: `cd mobile && npx expo start` → la pestaña Reportes muestra los tres números, cambiar de mes trae otros datos, elegir categoría actualiza la barra sin recargar la app; Inicio muestra el banner al superar el 80%.
5. Actualizar `README.md` e `IMPLEMENTATION_PLAN.md` con los endpoints nuevos y la nota de vigencia de las escalas (1/08/2026).
