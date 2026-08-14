# Spec 2 — ABM de billeteras y clientes

**Estado:** aprobado, sin implementar · **Tamaño:** S

## Contexto

El backend expone el CRUD completo de wallets ([routes/wallets.ts](../../../backend/src/routes/wallets.ts)) y clients ([routes/clients.ts](../../../backend/src/routes/clients.ts)), pero la app solo consume `GET /wallets`, `GET /clients` y `POST /clients` — este último escondido como "nuevo cliente" dentro del formulario de movimiento ([new-movement.tsx:49](../../../mobile/app/%28tabs%29/new-movement.tsx#L49)). El usuario no puede crear una billetera: se queda para siempre con las dos que le dejó el onboarding ("Efectivo ARS" y "Cuenta USD", [onboardingService.ts:33-34](../../../backend/src/services/onboardingService.ts#L33-L34)), ni renombrar ni borrar nada. Tampoco hay lugar donde vivan los ajustes de la cuenta: "Salir" es un texto suelto en el header de Inicio ([index.tsx:68](../../../mobile/app/%28tabs%29/index.tsx#L68)).

Además hay dos agujeros de backend que este spec cierra:

- `DELETE /clients/:id` borra sin condiciones y la FK es `ON DELETE SET NULL` ([migration.sql:206](../../../backend/prisma/migrations/20260718231215_create_core_tables/migration.sql#L206)): los movimientos pierden el cliente en silencio y el reporte por cliente queda mal para siempre.
- `PATCH /wallets/:id` renombra la wallet pero no la `Account` espejo, que queda con el nombre viejo (`Efectivo ARS (ARS)`) — invisible para el usuario, pero ensucia el ledger.

Resultado esperado: tab "Ajustes" con billeteras, clientes y perfil; alta, edición y baja funcionando end-to-end, con los borrados protegidos.

## Decisiones tomadas

- Pantallas colgando de un **tab nuevo "Ajustes"**, que además se queda con el email y el botón Salir.
- Borrar cliente con movimientos: **bloquear con 400**, igual que wallets.
- Renombrar billetera: **renombrar también la cuenta contable** en la misma transacción.

## Backend

Cambios chicos, mismo estilo inline del resto (`asyncHandler`, `AppError`, `paramId`, serializers de [lib/serializers.ts](../../../backend/src/lib/serializers.ts)).

1. **[routes/clients.ts](../../../backend/src/routes/clients.ts#L91)** — en `DELETE /:id`, antes de borrar: `prisma.movement.count({ where: { clientId: existing.id } })`; si es > 0 → `AppError(400, 'No se puede borrar un cliente con movimientos')`. Mismo criterio que [wallets.ts:114-117](../../../backend/src/routes/wallets.ts#L114-L117).
2. **[routes/wallets.ts](../../../backend/src/routes/wallets.ts#L96)** — `PATCH /:id` pasa a `prisma.$transaction`: actualiza `wallet.name` y `account.name = "${name.trim()} (${existing.currency})"`, misma convención que usa el POST al crear la cuenta ([wallets.ts:44](../../../backend/src/routes/wallets.ts#L44)). Ojo con `@@unique([userId, name])` de `Account`: si el nombre ya existe, Prisma tira P2002 y el `asyncHandler` ya lo mapea a 409 ([lib/asyncHandler.ts](../../../backend/src/lib/asyncHandler.ts)); la app muestra ese mensaje.
3. **Campo `phone` en `Client`** (migración): lo usa el recordatorio de WhatsApp del spec de [cuentas por cobrar](05-cuentas-por-cobrar.md).

### Tests `backend/tests/wallets-clients.test.ts`

Estilo [tests/auth.test.ts](../../../backend/tests/auth.test.ts): Postgres real, email único por `Date.now()`, onboarding previo.

- `POST /wallets` crea wallet + cuenta espejo; `GET /wallets` la lista.
- `PATCH /wallets/:id` renombra y la `Account` asociada queda con `Nombre (MONEDA)` (verificar con `prisma.account.findUnique`).
- `PATCH /wallets/:id` con un nombre ya usado → 409.
- `DELETE /wallets/:id` sin movimientos → 204; con un movimiento cargado → 400.
- `DELETE /clients/:id` sin movimientos → 204; con un ingreso asociado → 400, y el movimiento conserva su `clientId`.
- Wallet o cliente de otro usuario → 404 (aislamiento por `userId`).

## Mobile

### Navegación

- [mobile/app/(tabs)/_layout.tsx](../../../mobile/app/%28tabs%29/_layout.tsx): tab nueva `settings`, título "Ajustes", icono FontAwesome `cog`, última en la barra.
- Rutas de detalle como stack fuera de tabs: `mobile/app/wallets.tsx` y `mobile/app/clients.tsx`. El `Stack` raíz tiene `headerShown: false` ([app/_layout.tsx](../../../mobile/app/_layout.tsx)) → agregar `<Stack.Screen name="wallets" options={{ headerShown: true, title: 'Billeteras', headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false }} />` e ídem `clients`, para tener back nativo.

### Pantallas

- `mobile/app/(tabs)/settings.tsx`: filas navegables "Billeteras" y "Clientes" con el conteo de cada una (leído de las queries `['wallets']` / `['clients']` que ya están cacheadas), y bloque Perfil con el email y "Cerrar sesión" (`logout` de [AuthContext](../../../mobile/src/auth/AuthContext.tsx)). Sacar el "Salir" del header de Inicio.
- `mobile/app/wallets.tsx`: `FlatList` con nombre, moneda y saldo (reusar `['balance-by-wallet']` y `formatAmount` de [lib/format.ts](../../../mobile/src/lib/format.ts)). Botón "Nueva billetera" abre un `Modal` con nombre + chips de moneda (ARS/USD/USDT); tocar una fila abre el mismo modal en modo edición, solo nombre — el backend no permite cambiar la moneda, y está bien: la cuenta y los movimientos ya están atados a ella. Borrar desde el modal con `Alert.alert` de confirmación.
- `mobile/app/clients.tsx`: misma estructura, con nombre, teléfono y moneda por defecto (el `PATCH` acepta los tres).
- Mutaciones con `useMutation` + `queryClient.invalidateQueries` sobre `['wallets']`, `['clients']` y `['balance-by-wallet']`, como ya hace [new-movement.tsx:82-84](../../../mobile/app/%28tabs%29/new-movement.tsx#L82-L84).
- **Errores visibles**: mostrar `ApiError.message` tal cual viene del backend ([api/client.ts:9](../../../mobile/src/api/client.ts#L9)). Los 400 de "no se puede borrar" y el 409 de nombre duplicado ya están redactados en castellano y son la mitad del valor de estas pantallas.

### Estilos compartidos

Los estilos `input`, `button`, `chip/chipActive` y `error` están duplicados casi verbatim en login, register, onboarding, movements y new-movement. Extraer solo lo que necesitan las pantallas nuevas a `mobile/src/ui/formStyles.ts` (un `StyleSheet.create` exportado, sin componentes nuevos ni librerías). **No** refactorizar las pantallas existentes en este spec — queda como deuda anotada.

## Fuera de alcance

Soft delete o archivado de clientes, reordenar o marcar billetera favorita, ícono y color por billetera, refactor de las pantallas viejas a los estilos compartidos, y la edición de movimientos.

## Verificación

1. `docker compose up -d db` · `cd backend && npm test` → auth + wallets-clients en verde.
2. Manual con token:
   - `POST /wallets {"name":"Mercado Pago","currency":"ARS"}` → 201; `select name from accounts` muestra `Mercado Pago (ARS)`.
   - `PATCH /wallets/:id {"name":"MP"}` → 200 y la cuenta pasa a `MP (ARS)`.
   - Cargar un ingreso con cliente → `DELETE /clients/:id` → 400, y el movimiento sigue con su `clientId`.
   - `DELETE /wallets/:id` de una billetera con movimientos → 400; de una vacía → 204.
3. App: `cd mobile && npx expo start` → tab Ajustes; crear una billetera ARS y verla aparecer en Inicio y en el selector de Nuevo movimiento sin reiniciar; renombrarla; intentar borrar una con movimientos y ver el mensaje del backend; crear, editar y borrar un cliente; cerrar sesión desde Ajustes.
4. Actualizar `README.md` con la nota de que borrar clientes con movimientos está bloqueado.
