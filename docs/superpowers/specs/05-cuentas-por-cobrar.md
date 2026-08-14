# Spec 5 — Cuentas por cobrar (facturas emitidas y cobros)

**Estado:** aprobado, sin implementar · **Tamaño:** L

## Contexto

El sistema hoy es puro caja: un `Movement` de tipo `income` mueve plata a una billetera en el momento ([ledgerService.ts:33-38](../../../backend/src/services/ledgerService.ts#L33-L38)). Pero el freelancer factura y cobra a 30, 60 o cuando el cliente se acuerda. Con el modelo actual, mientras la plata no entra, la factura no existe en ningún lado: no hay "quién me debe", no hay antigüedad de deuda, y "cuánto facturé este mes" ([monedapp_spec.md:42](../../../monedapp_spec.md#L42)) mide cobranza y no facturación — que es justo lo que ARCA cuenta para monotributo.

`Client` ya existe y `Movement.clientId` también, así que falta la mitad devengada: emitir la factura, seguir el saldo pendiente y registrar los cobros contra ella.

## Decisiones tomadas

- **Tipos de movimiento nuevos** `invoice` y `collection`, con cuenta "Deudores por ventas". "Quién me debe" sale del saldo de esa cuenta — el ledger ya sabe hacerlo.
- **Cobros parciales** y `dueDate`; el estado (pendiente / parcial / vencida / cobrada) se **deriva**, no se guarda.
- Cobro **en otra moneda permitido**, con asiento automático de **diferencia de cambio**.
- Recordatorio vía **deep link a WhatsApp** con el texto armado.

## Backend

### 1. Schema + migración `add_receivables`

- `enum MovementType` suma `invoice` y `collection`. **Migración aparte** para los valores del enum, antes de la que los usa — Postgres no deja usar un valor recién agregado en la misma transacción (mismo cuidado que el spec de [cotización real](01-cotizacion-real-dolarapi.md)).
- `Movement`:
  - `walletId` pasa a **nullable** (una factura no tiene billetera). Validación por tipo en la ruta: `income`/`expense`/`transfer`/`collection` la exigen, `invoice` la prohíbe.
  - `dueDate DateTime? @db.Date` — solo `invoice`.
  - `invoiceId String?` + auto-relación `invoice Movement? @relation("InvoiceCollections", fields: [invoiceId], references: [id])` / `collections Movement[] @relation("InvoiceCollections")`, con índice.
- `LedgerEntry` suma `changeArs Decimal(18,2)` — el valor del asiento en ARS con el snapshot del movimiento. Backfill en la migración: `change × exchange_rates.value` vía join por `movementId`. Es lo que permite balancear asientos multi-moneda (ver punto 3), y de paso le sirve al spec de [reportes](06-reportes-monotributo.md).
- `Client` suma `phone String?` si no lo agregó antes el spec de [ABM](02-abm-billeteras-clientes.md) — lo usa el deep link de WhatsApp.

### 2. Cuentas de sistema

En [services/onboardingService.ts](../../../backend/src/services/onboardingService.ts), junto al set de cuentas por plantilla: **"Deudores por ventas"** (`ASSET`, sin `currency`, acumula varias) y **"Diferencia de cambio"** (`INCOME`, admite saldo negativo). Exportar `ensureSystemAccounts(userId)` idempotente por `@@unique([userId, name])`, llamado desde `applyOnboarding` y también al crear la primera factura, para que los usuarios ya onboardeados no queden afuera. Estas dos cuentas **no** se listan como categorías: el `GET /categories` del spec 3 debe excluirlas por nombre reservado.

### 3. Ledger: asientos nuevos y balance multi-moneda

[services/ledgerService.ts](../../../backend/src/services/ledgerService.ts):

- `assertBalanced` pasa a validar **suma 0 en ARS** (`changeArs`) siempre, y suma 0 por moneda **salvo** que el asiento incluya la cuenta de diferencia de cambio. Hoy suma montos de distintas monedas como si fueran comparables ([ledgerService.ts:7-12](../../../backend/src/services/ledgerService.ts#L7-L12)) — con un solo asiento multi-moneda eso se vuelve un bug silencioso.
- `invoice`: Deudores **+monto** / cuenta de ingreso (el rubro elegido, o el default de [onboardingService.ts:101](../../../backend/src/services/onboardingService.ts#L101)) **−monto**. No toca ninguna billetera, así que `GET /reports/balance-by-wallet` no cambia.
- `collection`: billetera **+monto cobrado** (moneda de la billetera) / Deudores **−saldo aplicado** (moneda de la factura) / Diferencia de cambio por el resto en ARS.

  Ejemplo: factura USD 1.000 emitida a 1.500 → Deudores 1.000 USD (ARS 1.500.000). Cobro de ARS 1.400.000 → billetera +1.400.000, Deudores −1.000 USD (−1.500.000 ARS), diferencia de cambio +100.000 ARS. Balancea en ARS.

### 4. Rutas

- [routes/movements.ts](../../../backend/src/routes/movements.ts#L64) `POST`:
  - `type: 'invoice'` → exige `clientId`, `amount`, `currency` explícita (no hay billetera de dónde tomarla; hoy sale de `wallet.currency` en [movements.ts:133](../../../backend/src/routes/movements.ts#L133)), `dueDate` y `description`; `categoryId` opcional como rubro.
  - `type: 'collection'` → exige `invoiceId` y `walletId`; valida que la factura sea del usuario, que no esté saldada y que el monto no exceda el saldo pendiente (400 `'El cobro supera el saldo pendiente'`), aplicando la conversión con los snapshots de ambas fechas.
- `DELETE /movements/:id` de una factura con cobros → 400; borrar un cobro revierte solo ese asiento.
- Nuevo `backend/src/services/receivablesService.ts`: `listReceivables(userId, { status, clientId })` devolviendo por factura `amount`, `collected`, `outstanding`, `status` (`pending|partial|overdue|paid`), `daysOverdue` y sus `collections`; más `receivablesSummary(userId)` con total por moneda, total ARS y tramos de antigüedad (0-30 / 31-60 / 61+).
- Nueva ruta `backend/src/routes/receivables.ts` montada en `/receivables`: `GET /receivables?status=&clientId=` y `GET /receivables/summary`.
- `serializeMovement` ([lib/serializers.ts:23](../../../backend/src/lib/serializers.ts#L23)): sumar `dueDate`, `invoiceId` y, para facturas, `outstanding`/`status` cuando vengan calculados.

### 5. Tests `backend/tests/receivables.test.ts`

- Emitir factura → 201, sin `walletId`, `GET /reports/balance-by-wallet` sin cambios, y el asiento suma 0 (Deudores + / Ingresos −).
- `GET /receivables` → `outstanding` = monto, `status: 'pending'`.
- Cobro parcial → `status: 'partial'`, `outstanding` correcto, billetera acreditada.
- Cobro que completa → `status: 'paid'`, `outstanding` 0.
- Cobro que excede el saldo → 400.
- Factura con `dueDate` pasada e impaga → `status: 'overdue'` con `daysOverdue` > 0.
- Factura USD cobrada en ARS a otra cotización → asiento de tres patas, `changeArs` sumando 0 y la diferencia imputada a "Diferencia de cambio".
- Borrar factura con cobros → 400; factura de otro usuario → 404.
- `GET /receivables/summary` → totales por moneda y tramos de antigüedad coherentes.

## Mobile

- [mobile/app/(tabs)/new-movement.tsx](../../../mobile/app/%28tabs%29/new-movement.tsx): cuarto chip **"Factura"** junto a Ingreso/Gasto/Transferencia. Al elegirlo: cliente **obligatorio** (reusando el selector y el alta inline que ya están, [:193-248](../../../mobile/app/%28tabs%29/new-movement.tsx#L193-L248)), moneda por chips (no billetera) y fecha de vencimiento.
- `mobile/app/receivables.tsx` (ruta stack con header propio — el `Stack` raíz tiene `headerShown:false`): lista de facturas agrupada por estado, cada fila con cliente, monto, saldo pendiente y días de atraso en `colors.danger` cuando está vencida. Filtros por estado con los chips que ya existen en [movements.tsx](../../../mobile/app/%28tabs%29/movements.tsx#L57).
- Detalle de factura: historial de cobros, botón **"Registrar cobro"** (billetera + monto precargado con el saldo pendiente + fecha) y botón **"Recordar por WhatsApp"** → `Linking.openURL('https://wa.me/{telefono}?text={mensaje}')` con el texto armado (cliente, monto pendiente, días de atraso); si el cliente no tiene teléfono, abre `wa.me` sin número para elegir contacto. Reusar la pantalla de detalle de movimiento del spec de [Mercado Pago](04-mercadopago.md) (`mobile/app/movement/[id].tsx`) en vez de escribir una segunda.
- [mobile/app/(tabs)/index.tsx](../../../mobile/app/%28tabs%29/index.tsx): tarjeta **"Te deben"** con el total (de `GET /receivables/summary`) y el vencido en rojo, que navega a la pantalla. Va arriba de "Tus billeteras".
- Invalidar `['receivables']`, `['movements']` y `['balance-by-wallet']` tras cada cobro.

## Fuera de alcance

Emisión de factura electrónica ARCA, numeración y PDF de la factura, notas de crédito, intereses por mora, recordatorios automáticos programados, y cuentas por **pagar** (el espejo de esto).

## Verificación

1. `docker compose up -d db` · `cd backend && npx prisma migrate dev` (dos migraciones, enum primero) → `select count(*) from ledger_entries where "changeArs" is null` da 0.
2. `npm test` → auth + receivables en verde.
3. Manual con token:
   - `POST /movements {"type":"invoice","clientId":…,"amount":1000,"currency":"USD","dueDate":"2026-07-01","description":"Sprint 12"}` → 201 y `balance-by-wallet` sin cambios.
   - `GET /receivables` → `outstanding: 1000`, `status: "overdue"`, `daysOverdue` correcto.
   - `POST /movements {"type":"collection","invoiceId":…,"walletId":<ARS>,"amount":1400000}` → 201; `select "changeArs" from ledger_entries where "movementId"=…` suma 0 y hay una pata en "Diferencia de cambio".
   - Cobrar de más → 400. Borrar la factura con cobros → 400.
   - `GET /receivables/summary` → total por moneda + tramos de antigüedad.
4. App: `npx expo start` → cargar una factura desde Nuevo movimiento; ver "Te deben" en Inicio; abrir el detalle, registrar un cobro parcial y ver bajar el saldo; tocar "Recordar por WhatsApp" y verificar que abre con el texto armado.
5. Actualizar `README.md` e `IMPLEMENTATION_PLAN.md` con `/receivables` y los tipos `invoice`/`collection`.
