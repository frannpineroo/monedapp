# MonedApp

Ledger multi-moneda para freelancers y monotributistas argentinos.  
Spec: [`monedapp_spec.md`](./monedapp_spec.md) · Plan: [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)

## Stack (core vertical)

- **Backend:** Node 22 + Express + TypeScript + Prisma 7 + PostgreSQL
- **Mobile:** Expo (React Native) + TanStack Query + StyleSheet
- **Infra local:** Docker Compose (Postgres en `localhost:5433`, API en `:8100`)

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
# → http://localhost:8100/health
```

### Datos de demo

Para recorrer la app llena en vez de arrancar de cero:

```bash
cd backend
npm run db:seed:demo
```

Deja el usuario **`fran@ejemplo.com` / `fran1234`** con 5 billeteras (ARS, USD, USDT, caja chica y la de Mercado Pago), 3 clientes, categorías propias, 12 meses de movimientos, las cuatro facturas posibles (pendiente, vencida, cobrada a medias y cobrada), un pago importado esperando en "Para revisar" y la categoría de monotributo al 85% del techo, para que se vea el banner de alerta.

Es re-ejecutable: borra el usuario de demo y lo vuelve a crear. No toca ningún otro usuario.

Cada corrida recrea el usuario con otro `id`, así que la sesión abierta en la app queda huérfana: `requireAuth` la rechaza con 401 y la app cierra sesión sola. Volvé a entrar con el usuario de demo.

Si `INTEGRATIONS_ENCRYPTION_KEY` no está en el `.env` o está mal formada, saltea la fila de integración y avisa; el resto de la demo funciona igual. La clave se lee como **base64**: `openssl rand -base64 32` (con `-hex` da 64 caracteres que decodifican a 48 bytes y el backend la rechaza).

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
npm start
# → http://localhost:8181
```

- iOS Simulator: usa `http://localhost:8100`
- Android Emulator: usa `http://10.0.2.2:8100` (ya configurado)
- Device físico: `EXPO_PUBLIC_API_URL=http://<tu-ip-lan>:8100 npx expo start`
- Metro: `http://localhost:8181` (puerto propio para no chocar con otros proyectos)

## Smoke checklist

1. `curl http://localhost:8100/health` → `{ "status": "ok" }`
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
| POST | `/movements` con `type: "invoice"` | Emite una factura (sin billetera, con cliente y vencimiento) |
| POST | `/movements` con `type: "collection"` | Registra un cobro contra una factura |
| GET | `/receivables?status=&clientId=` | Facturas con saldo, estado y días de atraso |
| GET | `/receivables/summary` | Totales por moneda, total ARS y tramos de antigüedad |
| GET | `/reports/balance-by-wallet` | Saldos por billetera |
| GET | `/exchange-rates?currency=USD&date=YYYY-MM-DD` | Cotización real (oficial/blue/mep/cripto) con caché y fallback |
| GET | `/categories?kind=EXPENSE\|INCOME` | Categorías de gasto y rubros de ingreso |
| POST | `/categories` | Crear categoría (409 si el nombre se repite) |
| POST | `/categories/defaults` | Traer el set sugerido (idempotente) |
| PATCH | `/categories/:id` | Renombrar |
| DELETE | `/categories/:id` | 400 si tiene movimientos o es la última del tipo |
| GET | `/reports/by-category?month=YYYY-MM&type=expense` | Totales por categoría en ARS |
| GET | `/reports/monthly-summary?month=YYYY-MM` | Facturado, gastado y neto después de la cuota |
| GET | `/reports/monotributo-alert` | Uso del techo en 12 meses móviles + escalas |
| GET | `/users/me` | Usuario actual |
| PATCH | `/users/me` | Elegir o desactivar la categoría de monotributo |
| DELETE | `/wallets/:id` | 400 si la billetera tiene movimientos |
| DELETE | `/clients/:id` | 400 si el cliente tiene movimientos |

Las escalas de monotributo cargadas **rigen desde el 1/8/2026** ("locaciones y prestaciones de servicios", fuente `afip.gob.ar/monotributo/categorias.asp`). Para actualizarlas se agrega un bloque nuevo con otro `validFrom` en `backend/src/config/monotributoScales.ts` y se corre `npm run db:seed`; el bloque viejo no se toca, es el histórico con el que se calcularon los reportes anteriores. La facturación que cuenta para el techo es la **devengada** (`income` + `invoice`): las transferencias y los cobros de facturas ya emitidas no suman.

`LedgerEntry.changeArs` es el valor del asiento en ARS (con el snapshot del movimiento): es lo que permite balancear un cobro en otra moneda. Borrar una factura con cobros está bloqueado (400); hay que borrar primero los cobros.

## Integraciones

Mercado Pago se conecta con OAuth `authorization_code` + PKCE. El backend es el `redirect_uri` (MP exige HTTPS estático) y después rebota al deep link `monedapp://`. Los tokens se guardan cifrados (AES-256-GCM) en `Integration.credentials` y **nunca** salen por la API.

### Variables

```
MP_CLIENT_ID=
MP_CLIENT_SECRET=
MP_REDIRECT_URI=https://<host-publico>/integrations/mercadopago/callback
MP_WEBHOOK_SECRET=
MP_AUTH_BASE_URL=https://auth.mercadopago.com.ar
MP_API_BASE_URL=https://api.mercadopago.com
INTEGRATIONS_ENCRYPTION_KEY=
MOBILE_DEEP_LINK_SCHEME=monedapp
```

Generar la clave de cifrado:

```bash
openssl rand -base64 32
```

Tiene que decodificar a exactamente 32 bytes.

### Alta de la aplicación en Mercado Pago

1. Crear la app en el panel de desarrolladores.
2. **Habilitar PKCE**: si no, MP rechaza el `code_challenge`.
3. Registrar `redirect_uri` **byte-exacto** contra `MP_REDIRECT_URI`. `monedapp://` no se le pasa nunca a MP.
4. Configurar la notificación de `payment` a `https://<host>/webhooks/mercadopago` y copiar el secreto a `MP_WEBHOOK_SECRET`.

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET | `/integrations` | Estado de las integraciones (nunca devuelve credenciales) |
| POST | `/integrations/mercadopago/connect` | Devuelve la URL de autorización con PKCE |
| GET | `/integrations/mercadopago/callback` | Público: MP vuelve acá y rebota al deep link |
| POST | `/integrations/mercadopago/sync` | Backfill manual (30 días por defecto) |
| DELETE | `/integrations/mercadopago` | Desconecta sin borrar movimientos |
| POST | `/webhooks/mercadopago` | Webhook firmado HMAC-SHA256 |

El access token de MP vive 180 días y el refresh es lazy: si no hay pagos por 180 días la conexión se cae y la pantalla pide "Reconectá Mercado Pago". Un reembolso **no** borra el movimiento original: postea un asiento compensatorio.

### Smoke real (pendiente)

No hay URL HTTPS pública todavía, así que MP no puede llegar al callback ni al webhook. El circuito se verificó con requests sintéticos firmados. Cuando haya host público:

1. Dar de alta la aplicación y habilitar PKCE.
2. Setear `MP_REDIRECT_URI=https://<host>/integrations/mercadopago/callback` — byte-exacto contra el registrado.
3. Apuntar la notificación de `payment` a `https://<host>/webhooks/mercadopago` y copiar el secreto.
4. Conectar desde la app con una cuenta de prueba, generar un pago y verificar que aparece en la bandeja "Revisar" con el monto bruto y su comisión.

## Fuera de este core

Stripe/Hotmart, reportes monotributo, freemium flags, módulos Swift nativos.
