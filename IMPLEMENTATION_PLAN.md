# MonedApp Core Vertical — Plan de Implementación

> Spec de producto: [`monedapp_spec.md`](monedapp_spec.md).

**Goal:** Entregar un flujo usable: registrarse → elegir plantilla → ver billeteras → cargar ingresos/gastos → ver saldo por moneda, sin exponer Debe/Haber.

**Architecture:** Monorepo `backend/` + `mobile/`. El backend traduce cada `Movement` a asientos de partida doble (patrón de `wallet-ledger-system`). La app RN consume REST; el scaffold SwiftUI actual no se usa en este plan (queda para módulos nativos futuros).

**Tech stack:** Node 22 + Express + TypeScript + Prisma 7 + PostgreSQL + Docker · Expo (React Native) + TanStack Query · JWT auth · StyleSheet nativo.

**Decisiones fijadas:** 1A React Native · 2A solo core vertical · StyleSheet (no NativeWind aún) · cotización con seed/stub (API real en plan futuro) · Expo managed.

## Global Constraints

- Un usuario = una organización (sin multi-tenant).
- El usuario nunca ve Debe/Haber ni plan de cuentas crudo.
- Multi-moneda nativa: cada movimiento guarda snapshot de tipo de cambio.
- Reutilizar el enfoque de ledger de `wallet-ledger-system` (cuentas + journal entries balanceados), no copiar el frontend web.
- Fuera de alcance: Mercado Pago / Stripe / Hotmart, alertas monotributo, freemium flags, CSV/OFX, Face ID/widgets.

## Estructura

```
monedapp/
├── IMPLEMENTATION_PLAN.md
├── monedapp_spec.md
├── docker-compose.yml
├── .env.example
├── backend/
├── mobile/
└── monedapp/   # scaffold SwiftUI (sin tocar en core)
```

## Tasks (implementadas)

1. Scaffold monorepo + Docker + health
2. Schema Prisma dominio core + migración
3. Auth JWT register/login/refresh
4. Onboarding por plantillas + seed cuentas/wallets
5. Wallets + Clients CRUD (Account oculta)
6. FX stub + Movements + ledger oculto
7. GET /reports/balance-by-wallet
8. App Expo auth/onboarding/wallets/movimientos
9. README + smoke checklist end-to-end

## Criterio de hecho del core

Un usuario nuevo puede, en <5 minutos locales: registrarse, elegir “Soy freelancer de software”, ver wallets ARS/USD, cargar un ingreso en USD, y ver el saldo actualizado — sin ninguna mención a asientos contables en la UI.

---

# Roadmap post-core

Seis specs aprobados, ninguno implementado. El detalle de cada uno (archivos, endpoints, casos de test) vive en [docs/superpowers/specs/](docs/superpowers/specs/). Acá queda el orden y el porqué.

## Orden de ejecución

| # | Fase | Tamaño | Por qué va acá |
|---|---|---|---|
| 1 | [Cotización real (dolarapi)](docs/superpowers/specs/01-cotizacion-real-dolarapi.md) ✅ implementada | M | Es el único cuyo retraso deja **daño permanente**: cada movimiento se sella con `exchangeRateId`, así que todo lo que se cargue mientras el FX sea stub queda con una cotización inventada para siempre. Además Mercado Pago (fase 4) postea con `'blue'`: si el FX ya es real, hereda cotización real sin tocar nada. |
| 2 | [ABM de billeteras y clientes](docs/superpowers/specs/02-abm-billeteras-clientes.md) ✅ implementada | S | Independiente y chico. Aporta el tab **Ajustes** (donde después cuelgan categorías e integraciones) y el campo `Client.phone` (que usa el recordatorio de cobranzas). Cierra dos bugs de borrado. |
| 3 | [Categorías de gasto y rubros de ingreso](docs/superpowers/specs/03-categorias.md) ✅ implementada | M | Antes de cualquier reporte, si no el reporte mensual se escribe dos veces. También define el rubro que usan la factura (fase 5) y la comisión de Mercado Pago (fase 4, que si no cae en “Gastos operativos”). |
| 4 | [Integración Mercado Pago](docs/superpowers/specs/04-mercadopago.md) ✅ implementada (falta el smoke real, ver plan) | XL | Es la promesa central del spec (“integraciones que ahorran carga manual”) y el mayor salto de valor. Va antes de cobrables porque su parte bloqueante es externa (falta una URL HTTPS pública para callback y webhook): conviene empezarla temprano y dejar la verificación real en espera mientras se avanza con lo demás. |
| 5 | [Cuentas por cobrar](docs/superpowers/specs/05-cuentas-por-cobrar.md) ✅ implementada | L | Necesita `phone` (fase 2) y el rubro de ingreso (fase 3). Introduce `LedgerEntry.changeArs` y reescribe `assertBalanced`, que hoy suma monedas distintas como si fueran comparables — hacerlo con los tests de ledger de Mercado Pago ya en verde da red de seguridad. |
| 6 | [Reportes mensuales + monotributo](docs/superpowers/specs/06-reportes-monotributo.md) | M/L | Último a propósito: consume categorías (desglose), devengado (“facturé” = `invoice`, no cobranza), `changeArs` (conversión a ARS resuelta) y los movimientos importados de MP. Con el FX real de la fase 1, los números valen. |

### Dependencias

```
FX real ──────────────────────────────────────────────┐
ABM ──► (tab Ajustes, Client.phone) ──┐               │
Categorías ──► (rubro, comisión MP) ──┴──► Mercado Pago┤
                                                       ├──► Cobrables ──► Reportes + monotributo
                                          (changeArs) ─┘
```

## Qué entrega cada fase

**1. Cotización real.** `ExchangeRateType.cripto`, `buy`/`sell` en `ExchangeRate`, provider `dolarapi` (actual) + `argentinadatos` (histórico) con cascada API → última fila en DB → stub, registrada en `source`. En la app, chips de cotización y equivalente en ARS al cargar un movimiento en moneda extranjera.

**2. ABM de billeteras y clientes.** Tab Ajustes con perfil y logout; pantallas de alta/edición/baja. Backend: borrar cliente con movimientos pasa a 400 (hoy la FK es `ON DELETE SET NULL` y los movimientos pierden el cliente en silencio) y renombrar billetera renombra la cuenta espejo.

**3. Categorías.** Una categoría **es** una `Account` (`EXPENSE`/`INCOME`); `Movement.categoryAccountId` con backfill desde el ledger; ABM de categorías; `GET /reports/by-category`. En la app, chips de categoría con alta inline y bloque “En qué se te fue”.

**4. Mercado Pago.** OAuth `authorization_code` + PKCE con el backend como `redirect_uri` (MP exige HTTPS estático) y rebote al deep link `monedapp://`; tokens AES-256-GCM en `Integration.credentials`; webhooks firmados HMAC-SHA256 con verificación de manifiesto, deduplicados por `IntegrationWebhookEvent` y `Movement @@unique([userId, externalProvider, externalId])`; auto-posteo del pago aprobado (ingreso bruto + gasto de comisión) en una billetera “Mercado Pago” autoprovista, marcado `needsReview` para que el usuario le ponga cliente y descripción; `POST /integrations/:provider/sync` como backfill manual; reembolsos y contracargos como asiento compensatorio, nunca borrando el movimiento original.

**5. Cuentas por cobrar.** Tipos `invoice` y `collection`, cuenta “Deudores por ventas”, cobros parciales con vencimiento, diferencia de cambio automática cuando se cobra en otra moneda, `GET /receivables` con antigüedad y recordatorio por WhatsApp.

**6. Reportes + monotributo.** `GET /reports/monthly-summary` y `/reports/monotributo-alert` con ventana de 12 meses móviles, escalas de ARCA en tabla seedeada, `PATCH /users/me` para la categoría, y pestaña Reportes con barra de uso del techo.

## Choques entre specs a resolver al implementar

- **Barra de tabs.** Los specs suman por su cuenta “Revisar” (MP), “Ajustes” (ABM) y “Reportes” — con Inicio/Movimientos/Nuevo serían seis. Decisión propuesta: dejar cinco tabs (Inicio · Movimientos · Nuevo · Reportes · Ajustes) y resolver la bandeja de revisión como filtro `needsReview` dentro de Movimientos más un banner en Inicio; “Por cobrar” e “Integraciones” quedan como pantallas stack.
- **`serializeMovement`** lo tocan tres fases: `needsReview`/`source` (MP), `category` (categorías) y `dueDate`/`invoiceId`/`outstanding` (cobrables). Cada una suma campos, ninguna reemplaza.
- **Detalle de movimiento.** MP crea `mobile/app/movement/[id].tsx` para editar y confirmar; cobrables necesita un detalle de factura. Reusar la misma pantalla en vez de escribir dos.
- **`assertBalanced`.** El spec de MP lo anota como riesgo pre-existente (aritmética float); el de cobrables lo reescribe sobre `changeArs`. Cerrarlo en la fase 5, no antes.
- **Comisión de MP.** Hoy iría a `getDefaultExpenseAccountId`; con categorías ya implementadas debe apuntar a “Comisiones bancarias”.

## Backlog sin spec

Detectado en la revisión, todavía sin plan escrito: recuperar contraseña (bloqueante para lanzar), paginación y búsqueda de movimientos, adjuntar comprobante, export para el contador, movimientos recurrentes, apartados automáticos por regla, vencimientos impositivos, facturación electrónica ARCA, Stripe/Hotmart, y tests en la app (hoy solo hay tests de backend).

## Backlog sin spec

Detectado en la revisión, todavía sin plan escrito: recuperar contraseña (bloqueante para lanzar), paginación y búsqueda de movimientos, adjuntar comprobante, export para el contador, movimientos recurrentes, apartados automáticos por regla, vencimientos impositivos, facturación electrónica ARCA, y tests en la app (hoy solo hay tests de backend).
