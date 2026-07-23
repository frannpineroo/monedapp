# MonedApp

Ledger multi-moneda para freelancers y monotributistas argentinos.  
Spec: [`monedapp_spec.md`](./monedapp_spec.md) · Plan: [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)

## Stack (core vertical)

- **Backend:** Node 22 + Express + TypeScript + Prisma 7 + PostgreSQL
- **Mobile:** Expo (React Native) + TanStack Query + StyleSheet
- **Infra local:** Docker Compose (Postgres en `localhost:5433`)

## Setup rápido

### 1. Variables de entorno

```bash
cp .env.example .env
# Ajustá secrets JWT si querés. DATABASE_URL local apunta a localhost:5433
cp .env backend/.env
```

### 2. Base de datos

```bash
docker compose up -d db
cd backend
npm install
npx prisma migrate dev
npm run db:seed
```

### 3. API

```bash
cd backend
npm run dev
# → http://localhost:8000/health
```

### Tests de auth

Con Postgres levantado (`docker compose up -d db`):

```bash
cd backend
npm test
```

### 4. App móvil

```bash
cd mobile
npm install
npx expo start
```

- iOS Simulator: usa `http://localhost:8000`
- Android Emulator: usa `http://10.0.2.2:8000` (ya configurado)
- Device físico: `EXPO_PUBLIC_API_URL=http://<tu-ip-lan>:8000 npx expo start`

## Smoke checklist

1. `curl http://localhost:8000/health` → `{ "status": "ok" }`
2. Registrar usuario: `POST /auth/register`
3. Onboarding: `POST /users/me/onboarding` con `freelancer_software`
4. `GET /wallets` → billeteras ARS y USD
5. `POST /movements` (income USD) → movimiento creado
6. `GET /reports/balance-by-wallet` → saldo USD actualizado
7. En DB: `sum(change)` de `ledger_entries` = `0`
8. En la app: login → elegir plantilla → ver saldos → cargar movimiento → ver lista

## API core

| Método | Ruta | Notas |
|---|---|---|
| POST | `/auth/register` `/auth/login` `/auth/refresh` | JWT |
| GET | `/profile-templates` | Público |
| POST | `/users/me/onboarding` | Auth |
| CRUD | `/wallets` `/clients` | Auth; sin exponer cuentas internas |
| CRUD | `/movements` | Genera partida doble oculta |
| GET | `/reports/balance-by-wallet` | Saldos por billetera |
| GET | `/exchange-rates?currency=USD&date=YYYY-MM-DD` | Stub oficial/blue/mep |

## Fuera de este core

Integraciones (MP/Stripe/Hotmart), reportes monotributo, freemium flags, cotización real, módulos Swift nativos.
