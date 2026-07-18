# MonedApp

Ledger multi-moneda para freelancers y monotributistas argentinos.
Basado en `wallet-ledger-system`.

## Idea central

La partida doble no es el producto — es la base contable que permite que los
reportes multi-moneda sean confiables. **El usuario nunca ve "Debe/Haber"**.

Nicho: freelancers y monotributistas argentinos con ingresos en múltiples
monedas (ARS, USD, y potencialmente cripto/USDT), que hoy resuelven su control
financiero con planillas de Excel y WhatsApp al contador.

## Funcionalidades clave (MVP)

1. **Esconder la jerga contable**
   - El usuario ve "Ingresos de [Cliente X]" y "cuánto tengo en cada
     billetera", nunca "Cuenta 4105" ni "Debe/Haber".
   - Cada acción del usuario se traduce por detrás a asientos de partida
     doble, de forma transparente.

2. **Onboarding en 3 minutos**
   - Plantillas pre-armadas según perfil ("Soy freelancer de software",
     "Vendo cursos online").
   - Cero carga manual de plan de cuentas: se genera automáticamente según
     la plantilla elegida.

3. **Multi-moneda real, no cosmético**
   - Soporte nativo para ARS + USD + cripto/USDT como "cuenta" adicional.
   - Tipo de cambio (oficial / blue / MEP) registrado en cada asiento en el
     momento en que ocurre, no aplicado retroactivamente al final del
     período.

4. **Integraciones que ahorran carga manual**
   - Mercado Pago vía API para conciliación automática.
   - Importación de resúmenes bancarios (CSV/OFX) como primer paso; open
     banking a futuro.
   - Stripe / Hotmart para cobros en USD de infoproductos y servicios
     digitales.

5. **Reportes que la gente entiende**
   - "Cuánto facturé este mes" y "cuánto me queda libre después de
     impuestos", en vez de Balance General técnico.
   - Alertas proactivas: "Este mes facturaste $X, te acercás al techo de tu
     categoría de monotributo".

6. **Pricing (afecta feature flags desde el diseño)**
   - Freemium: una sola moneda, carga manual de movimientos.
   - Plan Pro (USD 5–10/mes): multi-moneda completo + integraciones
     automáticas.

## Stack técnico

| Capa | Tecnología | Notas |
|---|---|---|
| Backend / API | Node.js + TypeScript + Express | Reutiliza el core de partida doble ya construido |
| ORM / Base de datos | Prisma 7 + PostgreSQL | Un usuario = una organización en el MVP (sin multi-tenant complejo) |
| App móvil | React Native (iOS) | UX que esconda la jerga contable; consume la API REST |
| Módulos nativos | Swift | Para lo que React Native no cubra bien (ej. Face ID / Touch ID, widgets de iOS, notificaciones nativas, Keychain) |
| Networking / estado | TanStack Query (React Query) | Cache y sincronización de datos con la API |
| Estilos | Tailwind (via NativeWind) o StyleSheet nativo | A definir según preferencia de iteración visual |
| Integraciones API | Mercado Pago, Stripe, Hotmart | Conciliación automática de movimientos, consumidas desde el backend |
| Tipo de cambio | API de cotización (oficial/blue/MEP) | Se guarda el valor histórico en cada asiento, no solo el actual |
| Infraestructura | Docker (backend) | Continuidad del setup ya usado en otros proyectos |

## Modelo de datos (propuesta inicial)

Entidades pensadas para Prisma 7 / PostgreSQL. Los campos de partida doble
quedan ocultos detrás de servicios; el usuario nunca los toca directamente.

### `User`
- `id`
- `email`
- `passwordHash`
- `profileTemplate` (ej. `"freelancer_software"`, `"cursos_online"`)
- `monotributoCategory` (opcional, para las alertas de techo de facturación)
- `createdAt`

### `Wallet`
- `id`
- `userId` → `User`
- `currency` (`ARS`, `USD`, `USDT`, ...)
- `name` (ej. "Mercado Pago ARS", "Cuenta USD Stripe")
- `accountRef` → cuenta contable interna asociada (oculta al usuario)

### `Client`
- `id`
- `userId` → `User`
- `name`
- `defaultCurrency`

### `Movement` (lo que el usuario ve y crea)
- `id`
- `userId` → `User`
- `walletId` → `Wallet`
- `clientId` → `Client` (opcional, solo para ingresos)
- `type` (`income`, `expense`, `transfer`)
- `amount`
- `currency`
- `exchangeRateId` → `ExchangeRate` (snapshot al momento del movimiento)
- `description`
- `date`
- `createdAt`

### `LedgerEntry` (partida doble interna, generada automáticamente)
- `id`
- `movementId` → `Movement`
- `debitAccount`
- `creditAccount`
- `amount`
- `currency`

### `ExchangeRate`
- `id`
- `date`
- `type` (`oficial`, `blue`, `mep`)
- `currency`
- `value`
- `source`

### `Integration`
- `id`
- `userId` → `User`
- `provider` (`mercadopago`, `stripe`, `hotmart`)
- `credentials` (encriptado)
- `status` (`connected`, `error`, `disconnected`)
- `lastSyncAt`

## Endpoints REST (MVP)

### Auth
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`

### Onboarding
- `GET /profile-templates` — lista de plantillas disponibles
- `POST /users/me/onboarding` — aplica plantilla elegida, genera plan de cuentas y wallets iniciales

### Wallets
- `GET /wallets`
- `POST /wallets`
- `GET /wallets/:id`
- `PATCH /wallets/:id`
- `DELETE /wallets/:id`

### Clients
- `GET /clients`
- `POST /clients`
- `PATCH /clients/:id`
- `DELETE /clients/:id`

### Movements (el core de uso diario)
- `GET /movements` — con filtros por `walletId`, `clientId`, rango de fechas, `type`
- `POST /movements` — crea el movimiento y dispara la generación del `LedgerEntry` correspondiente
- `GET /movements/:id`
- `PATCH /movements/:id`
- `DELETE /movements/:id`

### Reportes
- `GET /reports/monthly-summary` — "cuánto facturé este mes", "cuánto me queda libre después de impuestos"
- `GET /reports/monotributo-alert` — estado respecto al techo de categoría
- `GET /reports/balance-by-wallet` — saldo actual por billetera/moneda

### Tipo de cambio
- `GET /exchange-rates?currency=USD&date=2026-07-18` — consulta valor oficial/blue/MEP para una fecha

### Integraciones
- `GET /integrations`
- `POST /integrations/:provider/connect` — inicia OAuth o guarda credenciales
- `POST /integrations/:provider/sync` — dispara conciliación manual
- `DELETE /integrations/:provider`

## Simplificaciones respecto a `wallet-ledger-system`

- Sin multi-tenancy complejo.
- Sin API pública.
- Un usuario = una organización.
