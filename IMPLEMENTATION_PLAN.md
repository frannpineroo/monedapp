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
