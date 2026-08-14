# Spec 3 — Categorías de gasto y rubros de ingreso

**Estado:** aprobado, sin implementar · **Tamaño:** M

## Contexto

Hoy **todos** los gastos de un usuario van a una única cuenta contable: `getDefaultExpenseAccountId` toma la primera cuenta `EXPENSE` que encuentre ([ledgerService.ts:40](../../../backend/src/services/ledgerService.ts#L40) → [onboardingService.ts:121](../../../backend/src/services/onboardingService.ts#L121)), y el onboarding solo crea "Gastos operativos" ([onboardingService.ts:35](../../../backend/src/services/onboardingService.ts#L35)). Lo mismo pasa con los ingresos, que siempre caen en la primera cuenta `INCOME`. Resultado: la app puede decir "gastaste $X" pero nunca "en qué". El spec de producto promete "reportes que la gente entiende" ([monedapp_spec.md:42](../../../monedapp_spec.md#L42)) y sin categorías ese reporte es un solo número.

La estructura contable ya soporta la solución sin inventar nada: `Account` admite N cuentas por `kind` y `LedgerEntry` ya guarda `accountId`. Falta que el usuario pueda elegir cuál, que existan categorías útiles desde el minuto cero, y que los reportes agrupen por ellas.

## Decisiones tomadas

- Una categoría **es** una `Account` (`kind = EXPENSE` para gastos, `INCOME` para rubros de ingreso). Sin modelo paralelo.
- Alcance: **gastos + rubros de ingreso** — el ingreso ya se segmenta por cliente; el rubro es la otra mitad.
- Categorías **sembradas por plantilla de onboarding + ABM** del usuario.
- El movimiento guarda **`categoryAccountId` explícito** (migración + backfill desde el ledger existente).

## Backend

### 1. Schema + migración `add_movement_category`

```prisma
model Movement {
  // ...
  categoryAccountId String?
  categoryAccount   Account? @relation("MovementCategory", fields: [categoryAccountId], references: [id])
  @@index([categoryAccountId])
}

model Account {
  // ...
  categorizedMovements Movement[] @relation("MovementCategory")
}
```

FK con `ON DELETE RESTRICT` (una categoría con movimientos no se borra). **Backfill en la misma migración**, exacto, leyendo el asiento que ya existe:

```sql
UPDATE "movements" m SET "categoryAccountId" = le."accountId"
FROM "ledger_entries" le
JOIN "accounts" a ON a.id = le."accountId"
WHERE le."movementId" = m.id
  AND ((m.type = 'expense' AND a.kind = 'EXPENSE') OR (m.type = 'income' AND a.kind = 'INCOME'));
```

### 2. Categorías por plantilla + helper idempotente

En [services/onboardingService.ts](../../../backend/src/services/onboardingService.ts):

- Extender `accountsForTemplate` con el set de gasto base: **Herramientas y software · Internet y teléfono · Equipamiento · Impuestos y tasas · Comisiones bancarias · Otros gastos**. Se conserva "Gastos operativos" para no romper a los usuarios ya onboardeados. Rubros de ingreso: `freelancer_software` → "Ingresos servicios" (ya existe) + "Otros ingresos"; `cursos_online` → suma "Ingresos cursos" (ya existe).
- Exportar `ensureDefaultCategories(userId)`: upsert idempotente de ese set por `(userId, name)` — la `@@unique([userId, name])` de `Account` lo hace trivial. Lo llama `applyOnboarding` y también `POST /categories/defaults`, para que un usuario viejo (que solo tiene "Gastos operativos") pueda traerse las sugeridas desde la app.

### 3. Nuevo `backend/src/routes/categories.ts` (montado en `/categories`)

Mismo estilo inline del resto (`requireAuth` a nivel router, `asyncHandler`, `AppError`, `paramId`):

- `GET /categories?kind=EXPENSE|INCOME` — sin `kind` devuelve ambos. **Nunca** expone cuentas `ASSET`/`EQUITY` (las de billetera son ASSET), ni las cuentas de sistema del spec de [cuentas por cobrar](05-cuentas-por-cobrar.md) ("Deudores por ventas", "Diferencia de cambio").
- `POST /categories { name, kind }` — 409 automático por P2002 si el nombre se repite ([lib/asyncHandler.ts](../../../backend/src/lib/asyncHandler.ts)).
- `PATCH /categories/:id { name }`.
- `DELETE /categories/:id` — 400 si tiene movimientos (`movement.count({ where: { categoryAccountId } })`) o si es la **última** de su `kind` (el ledger necesita un default; misma lógica defensiva que [wallets.ts:114](../../../backend/src/routes/wallets.ts#L114)).
- `POST /categories/defaults` — `ensureDefaultCategories`, devuelve la lista final.
- Serializer nuevo `serializeCategory` en [lib/serializers.ts](../../../backend/src/lib/serializers.ts) → `{ id, name, kind }`, sin exponer nada contable más.

### 4. Movimientos

- [services/ledgerService.ts](../../../backend/src/services/ledgerService.ts): `createLedgerForMovement` acepta `categoryAccountId?`; si viene, se usa como contrapartida en lugar de `getDefaultIncomeAccountId`/`getDefaultExpenseAccountId`, que quedan como fallback. `assertBalanced` no cambia.
- [routes/movements.ts](../../../backend/src/routes/movements.ts#L64): `POST` acepta `categoryId` — valida pertenencia al usuario y que el `kind` coincida con el `type` (`expense`→EXPENSE, `income`→INCOME, `transfer`→debe venir vacío, 400 si no). Se persiste en `categoryAccountId`.
- `PATCH /movements/:id`: permitir cambiar `categoryId`. Como el monto y el tipo no cambian, la regeneración es acotada — dentro de una `$transaction`: `ledgerEntry.deleteMany({ where: { movementId } })` + `createLedgerForMovement(...)` con la categoría nueva. La edición de monto, tipo y billetera sigue fuera de alcance.
- `GET /movements`: nuevo filtro `categoryId`, junto a los de [movements.ts:42](../../../backend/src/routes/movements.ts#L42).
- `serializeMovement` ([lib/serializers.ts:23](../../../backend/src/lib/serializers.ts#L23)): agregar `category: { id, name } | null`; sumar `categoryAccount: { select: { id: true, name: true } }` a `movementInclude`.

### 5. Reporte por categoría

`GET /reports/by-category?month=YYYY-MM&type=expense|income` en [routes/reports.ts](../../../backend/src/routes/reports.ts): total por categoría del mes, **convertido a ARS con el snapshot de cada movimiento** (`exchangeRate.value`), transferencias excluidas, ordenado descendente, con `percent` sobre el total.

Esa conversión es la misma que necesita el spec de [reportes mensuales](06-reportes-monotributo.md). Crear ya `backend/src/services/reportService.ts` con `toArs(amount, rateValue)` y `sumByCategory(...)` para que ese spec lo reuse en vez de duplicarlo.

### 6. Tests `backend/tests/categories.test.ts`

- Onboarding deja ≥ 6 categorías EXPENSE y ≥ 1 INCOME; `GET /categories?kind=EXPENSE` no incluye cuentas de billetera.
- `POST /movements` con `categoryId` de gasto → el `LedgerEntry` de contrapartida apunta a esa cuenta (verificar con `prisma.ledgerEntry.findMany`).
- `categoryId` de kind equivocado (INCOME en un gasto) → 400; categoría de otro usuario → 404; `transfer` con `categoryId` → 400.
- `PATCH /movements/:id` cambiando categoría → asiento regenerado, sigue balanceado (suma 0) y apunta a la cuenta nueva.
- `GET /movements?categoryId=` filtra bien.
- `DELETE /categories/:id` con movimientos → 400; última del kind → 400; libre → 204.
- `GET /reports/by-category` con un gasto ARS y uno USD → totales en ARS con el snapshot, y `percent` sumando 100.

## Mobile

- [mobile/src/api/types.ts](../../../mobile/src/api/types.ts): `Category = { id, name, kind }`; `category` en `Movement`.
- [mobile/app/(tabs)/new-movement.tsx](../../../mobile/app/%28tabs%29/new-movement.tsx): fila de chips "Categoría" según el tipo elegido (query `['categories', kind]`), con chip "Nueva categoría" que abre el input inline y hace `POST /categories` — **calcado del patrón de "Nuevo cliente"** que ya está en esa pantalla ([:216-246](../../../mobile/app/%28tabs%29/new-movement.tsx#L216-L246)). Enviar `categoryId` en el POST; validar en `submit()` que haya categoría cuando el tipo no es transferencia.
- [mobile/app/(tabs)/movements.tsx](../../../mobile/app/%28tabs%29/movements.tsx): mostrar la categoría en la línea meta (`Gasto · Efectivo ARS · Herramientas`) y agregar fila de chips de filtro por categoría, junto a los de tipo y billetera.
- `mobile/app/categories.tsx` (ABM): lista por kind con crear, renombrar y borrar, con los mensajes de error del backend visibles. Entrada desde el tab Ajustes del spec de [ABM](02-abm-billeteras-clientes.md).
- Desglose visual: bloque "En qué se te fue" con las 5 categorías top del mes, barras hechas con `View` de ancho `%` sobre `colors.accentSoft`/`colors.accent`, sin librerías nuevas.

## Fuera de alcance

Jerarquía de categorías (subcategorías), presupuesto por categoría, color o ícono por categoría, categorización automática por descripción, y la edición de monto/tipo/billetera de un movimiento.

## Verificación

1. `docker compose up -d db` · `cd backend && npx prisma migrate dev` → si había movimientos previos, `select count(*) from movements where "categoryAccountId" is null` da 0 para gastos e ingresos.
2. `npm test` → auth + categories en verde.
3. Manual con token:
   - `GET /categories?kind=EXPENSE` → set sembrado por la plantilla.
   - `POST /movements` con `categoryId` → 201, y `select "accountId" from ledger_entries where "movementId"=…` muestra la cuenta elegida.
   - `PATCH /movements/:id {"categoryId": otra}` → 200, el asiento apunta a la nueva y suma 0.
   - `DELETE /categories/:id` de una con movimientos → 400.
   - `GET /reports/by-category?month=YYYY-MM&type=expense` → totales en ARS y `percent` coherentes.
4. App: `npx expo start` → cargar un gasto eligiendo categoría; crear una categoría desde el formulario y verla seleccionada; filtrar la lista por esa categoría; ver el bloque "En qué se te fue".
5. Actualizar `README.md` e `IMPLEMENTATION_PLAN.md` con el endpoint `/categories` y el reporte por categoría.
