# ABM de billeteras y clientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el usuario pueda crear, renombrar y borrar billeteras y clientes desde un tab nuevo "Ajustes", con los borrados protegidos en el backend y la cuenta contable espejo siempre sincronizada con el nombre de la billetera.

**Architecture:** El backend ya tiene el CRUD completo de wallets y clients; este plan cierra dos agujeros (borrar cliente con movimientos, renombrar sin renombrar la `Account` espejo), suma `Client.phone`, y agrega toda la superficie de app que faltaba: tab Ajustes más dos pantallas stack (`wallets`, `clients`) con modales de alta/edición y borrado confirmado. Los errores del backend se muestran tal cual: ya están redactados en castellano y son la mitad del valor de estas pantallas.

**Tech Stack:** Node 22 · Express 5 · TypeScript · Prisma 7 + PostgreSQL · Vitest + supertest (Postgres real) · Expo (React Native) + expo-router + TanStack Query · StyleSheet nativo.

**Spec:** [docs/superpowers/specs/02-abm-billeteras-clientes.md](../specs/02-abm-billeteras-clientes.md)

**Rama:** `codex/f2-abm-billeteras-clientes` (implementada y mergeada a `main`). Crear desde `main`. No reutilizar ramas de otras fases.

## Global Constraints

- El usuario nunca ve Debe/Haber ni el plan de cuentas: la `Account` espejo se mantiene sincronizada por detrás, sin aparecer en la UI.
- Convención del nombre de la cuenta espejo: `` `${name.trim()} (${currency})` ``, la misma que ya usa `POST /wallets` en [backend/src/routes/wallets.ts:44](../../../backend/src/routes/wallets.ts#L44).
- `Account` tiene `@@unique([userId, name])`: un nombre repetido tira P2002, que `asyncHandler` ya mapea a **409** con `{ error: 'El registro ya existe' }`. No agregar manejo propio.
- Borrar con movimientos asociados se bloquea con **400**, tanto en wallets (ya está) como en clients (lo agrega este plan). Nunca se borra en cascada ni se deja el `clientId` en null.
- Aislamiento por `userId` en todas las rutas: recurso de otro usuario → **404**, nunca 403.
- Estilo del backend: `asyncHandler`, `AppError`, `paramId`, serializers de `backend/src/lib/serializers.ts`. Nada de librerías nuevas.
- Estilo de la app: `StyleSheet` nativo, `useQuery`/`useMutation` inline en la pantalla, sin librerías nuevas ni componentes compartidos más allá de un `StyleSheet` exportado.
- **No** refactorizar las pantallas existentes (login, register, onboarding, movements, new-movement) para usar los estilos compartidos: queda como deuda anotada.
- Mensajes de error en la app: mostrar `ApiError.message` tal cual llega del backend.
- La app no tiene suite de tests todavía: las tasks de mobile se verifican con `npx tsc --noEmit` más una pasada manual en el simulador.
- **Commits en inglés**, formato `tipo: mensaje` (`feat:`, `fix:`, `test:`, `docs:`), como todo el historial del repo. `.cursor/rules/push-after-task.mdc` además pide commitear y pushear al terminar cada task, sin esperar que lo pidan.

---

### Task 1: Suite de tests de wallets y clients

**Files:**
- Create: `backend/tests/wallets-clients.test.ts`

**Interfaces:**
- Consumes: `createApp` de `backend/src/app.ts`, `prisma` de `backend/src/prisma/prisma.ts`.
- Produces: helpers que usan todas las tasks 2-4:
  - `setupUser(): Promise<{ token: string; wallets: { id: string; name: string; currency: string }[] }>`
  - `createWallet(token, name, currency): Promise<{ id: string; name: string; currency: string }>`
  - `createMovement(token, walletId, extra?): Promise<request.Response>`

- [ ] **Step 1: Levantar la DB local**

```bash
docker compose up -d db
```

- [ ] **Step 2: Escribir el archivo de tests con los casos que ya deberían pasar**

Crear `backend/tests/wallets-clients.test.ts`:

```ts
import 'dotenv/config'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/prisma/prisma'

const app = createApp()

function uniqueEmail() {
  return `wc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
}

/** Usuario registrado + onboarding aplicado (deja billeteras "Efectivo ARS" y "Cuenta USD"). */
async function setupUser() {
  const registered = await request(app)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: 'password123' })
  const token = registered.body.accessToken as string

  await request(app)
    .post('/users/me/onboarding')
    .set('Authorization', `Bearer ${token}`)
    .send({ templateId: 'freelancer_software' })

  const wallets = await request(app).get('/wallets').set('Authorization', `Bearer ${token}`)
  return { token, wallets: wallets.body as { id: string; name: string; currency: string }[] }
}

async function createWallet(token: string, name: string, currency = 'ARS') {
  const res = await request(app)
    .post('/wallets')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, currency })
  return res.body as { id: string; name: string; currency: string }
}

async function createMovement(
  token: string,
  walletId: string,
  extra: Record<string, unknown> = {}
) {
  return request(app)
    .post('/movements')
    .set('Authorization', `Bearer ${token}`)
    .send({
      walletId,
      type: 'income',
      amount: 1000,
      description: 'Cobro de prueba',
      ...extra,
    })
}

describe('wallets', () => {
  it('POST /wallets crea la billetera y su cuenta espejo', async () => {
    const { token } = await setupUser()

    const res = await request(app)
      .post('/wallets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mercado Pago', currency: 'ARS' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Mercado Pago')

    const wallet = await prisma.wallet.findUnique({ where: { id: res.body.id } })
    const account = await prisma.account.findUnique({ where: { id: wallet!.accountId } })
    expect(account!.name).toBe('Mercado Pago (ARS)')

    const list = await request(app).get('/wallets').set('Authorization', `Bearer ${token}`)
    expect(list.body.map((w: { name: string }) => w.name)).toContain('Mercado Pago')
  })

  it('DELETE /wallets/:id sin movimientos → 204', async () => {
    const { token } = await setupUser()
    const wallet = await createWallet(token, 'Billetera vacía')

    const res = await request(app)
      .delete(`/wallets/${wallet.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(204)
  })

  it('DELETE /wallets/:id con movimientos → 400', async () => {
    const { token } = await setupUser()
    const wallet = await createWallet(token, 'Billetera con plata')
    const movement = await createMovement(token, wallet.id)
    expect(movement.status).toBe(201)

    const res = await request(app)
      .delete(`/wallets/${wallet.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('No se puede borrar una billetera con movimientos')
  })

  it('billetera de otro usuario → 404', async () => {
    const owner = await setupUser()
    const intruder = await setupUser()
    const wallet = await createWallet(owner.token, 'Privada')

    const res = await request(app)
      .patch(`/wallets/${wallet.id}`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .send({ name: 'Robada' })

    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 3: Correr la suite**

Run: `cd backend && npx vitest run tests/wallets-clients.test.ts`
Expected: PASS (4 tests). Si alguno falla, es un bug real del backend actual — arreglarlo antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/wallets-clients.test.ts
git commit -m "test: cover wallet create, delete and isolation"
```

---

### Task 2: `PATCH /wallets/:id` renombra la cuenta espejo

**Files:**
- Modify: `backend/src/routes/wallets.ts:78-101` (handler `patch('/:id')`)
- Test: `backend/tests/wallets-clients.test.ts`

**Interfaces:**
- Consumes: helpers de la Task 1.
- Produces: `PATCH /wallets/:id` actualiza `wallet.name` y `account.name` en una sola transacción; nombre de cuenta duplicado → 409.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar dentro del `describe('wallets')` de `backend/tests/wallets-clients.test.ts`:

```ts
  it('PATCH /wallets/:id renombra la billetera y su cuenta espejo', async () => {
    const { token } = await setupUser()
    const wallet = await createWallet(token, 'Mercado Pago', 'ARS')

    const res = await request(app)
      .patch(`/wallets/${wallet.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'MP' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('MP')

    const updated = await prisma.wallet.findUnique({ where: { id: wallet.id } })
    const account = await prisma.account.findUnique({ where: { id: updated!.accountId } })
    expect(account!.name).toBe('MP (ARS)')
  })

  it('PATCH /wallets/:id con un nombre ya usado → 409', async () => {
    const { token } = await setupUser()
    await createWallet(token, 'Mercado Pago', 'ARS')
    const otra = await createWallet(token, 'Banco', 'ARS')

    const res = await request(app)
      .patch(`/wallets/${otra.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mercado Pago' })

    expect(res.status).toBe(409)
  })
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/wallets-clients.test.ts`
Expected: FAIL — la cuenta sigue llamándose `Mercado Pago (ARS)` en el primero; el segundo devuelve 200 en vez de 409.

- [ ] **Step 3: Implementar**

En `backend/src/routes/wallets.ts`, reemplazar el `prisma.wallet.update` del handler `PATCH /:id` por:

```ts
    const wallet = await prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: existing.id },
        data: { name: name.trim() },
      })
      // La cuenta espejo no se ve en la app, pero un nombre viejo ensucia el ledger.
      await tx.account.update({
        where: { id: existing.accountId },
        data: { name: `${name.trim()} (${existing.currency})` },
      })
      return updated
    })
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx vitest run tests/wallets-clients.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/wallets.ts backend/tests/wallets-clients.test.ts
git commit -m "fix: rename the mirror account when renaming a wallet"
```

---

### Task 3: `DELETE /clients/:id` bloquea si hay movimientos

**Files:**
- Modify: `backend/src/routes/clients.ts:91-104` (handler `delete('/:id')`)
- Test: `backend/tests/wallets-clients.test.ts`

**Interfaces:**
- Consumes: helpers de la Task 1.
- Produces: `DELETE /clients/:id` con movimientos → `400 'No se puede borrar un cliente con movimientos'`; sin movimientos → 204.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `backend/tests/wallets-clients.test.ts`:

```ts
describe('clients', () => {
  async function createClient(token: string, name: string) {
    const res = await request(app)
      .post('/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
    return res.body as { id: string; name: string }
  }

  it('DELETE /clients/:id sin movimientos → 204', async () => {
    const { token } = await setupUser()
    const client = await createClient(token, 'Cliente sin historia')

    const res = await request(app)
      .delete(`/clients/${client.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(204)
  })

  it('DELETE /clients/:id con un ingreso asociado → 400 y el movimiento conserva el cliente', async () => {
    const { token, wallets } = await setupUser()
    const client = await createClient(token, 'Cliente con ingreso')
    const movement = await createMovement(token, wallets[0].id, { clientId: client.id })
    expect(movement.status).toBe(201)

    const res = await request(app)
      .delete(`/clients/${client.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('No se puede borrar un cliente con movimientos')

    const stored = await prisma.movement.findUnique({ where: { id: movement.body.id } })
    expect(stored!.clientId).toBe(client.id)
  })

  it('cliente de otro usuario → 404', async () => {
    const owner = await setupUser()
    const intruder = await setupUser()
    const client = await createClient(owner.token, 'Privado')

    const res = await request(app)
      .delete(`/clients/${client.id}`)
      .set('Authorization', `Bearer ${intruder.token}`)

    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd backend && npx vitest run tests/wallets-clients.test.ts`
Expected: FAIL — el borrado con movimientos devuelve 204 y el `clientId` del movimiento queda en `null` (la FK es `ON DELETE SET NULL`).

- [ ] **Step 3: Implementar**

En `backend/src/routes/clients.ts`, en el handler `DELETE /:id`, después del chequeo de `existing`:

```ts
    const movementCount = await prisma.movement.count({ where: { clientId: existing.id } })
    if (movementCount > 0) {
      throw new AppError(400, 'No se puede borrar un cliente con movimientos')
    }
```

- [ ] **Step 4: Correr toda la suite**

Run: `cd backend && npm test`
Expected: PASS — auth, exchange rates y wallets-clients (9 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/clients.ts backend/tests/wallets-clients.test.ts
git commit -m "fix: block deleting clients that have movements"
```

---

### Task 4: Campo `phone` en `Client`

**Files:**
- Modify: `backend/prisma/schema.prisma:100-113` (model Client)
- Create: `backend/prisma/migrations/<timestamp>_add_client_phone/migration.sql`
- Modify: `backend/src/routes/clients.ts` (POST y PATCH)
- Modify: `backend/src/lib/serializers.ts:11-20` (`serializeClient`)
- Test: `backend/tests/wallets-clients.test.ts`

**Interfaces:**
- Consumes: helpers de la Task 1.
- Produces: `Client.phone` (`String?`); `POST`/`PATCH /clients` aceptan `phone`; `serializeClient` devuelve `phone`. Lo consume la pantalla de clientes (Task 10) y, más adelante, el recordatorio de cobranzas de la fase 5.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar dentro del `describe('clients')`:

```ts
  it('POST /clients guarda el teléfono y PATCH lo actualiza', async () => {
    const { token } = await setupUser()

    const created = await request(app)
      .post('/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Estudio Contable', phone: '+5491122334455', defaultCurrency: 'USD' })

    expect(created.status).toBe(201)
    expect(created.body.phone).toBe('+5491122334455')
    expect(created.body.defaultCurrency).toBe('USD')

    const patched = await request(app)
      .patch(`/clients/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '' })

    expect(patched.status).toBe(200)
    expect(patched.body.phone).toBeNull()
  })
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd backend && npx vitest run tests/wallets-clients.test.ts`
Expected: FAIL — `created.body.phone` es `undefined`.

- [ ] **Step 3: Agregar la columna**

En `backend/prisma/schema.prisma`:

```prisma
model Client {
  id              String   @id @default(cuid())
  userId          String
  name            String
  phone           String?
  defaultCurrency Currency @default(ARS)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  movements Movement[]

  @@index([userId])
  @@map("clients")
}
```

```bash
cd backend && npx prisma migrate dev --name add_client_phone
```

El SQL generado debe ser:

```sql
ALTER TABLE "clients" ADD COLUMN "phone" TEXT;
```

- [ ] **Step 4: Aceptar y devolver el teléfono**

En `backend/src/routes/clients.ts`, agregar el parser junto a `parseCurrency`:

```ts
/** '' y null limpian el campo; cualquier otro tipo es un error del cliente. */
function parsePhone(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new AppError(400, 'El teléfono es inválido')
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
```

En el `POST`, leer `phone` del body y sumarlo al `create`:

```ts
    const { name, phone, defaultCurrency } = req.body as {
      name?: unknown
      phone?: unknown
      defaultCurrency?: unknown
    }
```

```ts
    const client = await prisma.client.create({
      data: {
        userId,
        name: name.trim(),
        phone: parsePhone(phone),
        defaultCurrency: parseCurrency(defaultCurrency),
      },
    })
```

En el `PATCH`, leer `phone` del body igual que arriba y sumarlo al `data`:

```ts
    const data: { name?: string; phone?: string | null; defaultCurrency?: Currency } = {}
```

```ts
    if (phone !== undefined) {
      data.phone = parsePhone(phone)
    }
```

En `backend/src/lib/serializers.ts`, dentro de `serializeClient`, después de `name`:

```ts
    phone: client.phone,
```

- [ ] **Step 5: Correr toda la suite**

Run: `cd backend && npm test`
Expected: PASS (10 tests de wallets-clients + el resto).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/routes/clients.ts backend/src/lib/serializers.ts backend/tests/wallets-clients.test.ts
git commit -m "feat: add phone to clients"
```

---

### Task 5: Tab Ajustes con perfil

**Files:**
- Create: `mobile/src/ui/formStyles.ts`
- Create: `mobile/app/(tabs)/settings.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx` (tab nueva, última)
- Modify: `mobile/app/(tabs)/index.tsx:62-71` (sacar el "Salir" del header)

**Interfaces:**
- Consumes: `useAuth` (`user`, `accessToken`, `logout`), queries `['wallets']` y `['clients']` ya cacheadas.
- Produces: `formStyles` (usado por las Tasks 7, 8, 10, 11) con las claves `label`, `input`, `button`, `buttonText`, `chip`, `chipActive`, `chipText`, `chipTextActive`, `rowWrap`, `error`.

- [ ] **Step 1: Extraer los estilos compartidos**

Crear `mobile/src/ui/formStyles.ts`:

```ts
import { colors } from '@/src/theme'
import { StyleSheet } from 'react-native'

/**
 * Estilos de formulario compartidos por las pantallas nuevas de ABM.
 * Deuda anotada: login, register, onboarding, movements y new-movement
 * siguen con su copia local — migrarlas queda fuera de este alcance.
 */
export const formStyles = StyleSheet.create({
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.ink,
    fontSize: 14,
  },
  chipTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
  },
})
```

- [ ] **Step 2: Escribir la pantalla de Ajustes**

Crear `mobile/app/(tabs)/settings.tsx`:

```tsx
import { apiRequest } from '@/src/api/client'
import type { Client, Wallet } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

export default function SettingsScreen() {
  const { accessToken, user, logout } = useAuth()
  const router = useRouter()

  const wallets = useQuery({
    queryKey: ['wallets'],
    queryFn: () => apiRequest<Wallet[]>('/wallets', { token: accessToken }),
    enabled: !!accessToken,
  })

  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiRequest<Client[]>('/clients', { token: accessToken }),
    enabled: !!accessToken,
  })

  const rows = [
    { href: '/wallets' as const, label: 'Billeteras', count: wallets.data?.length },
    { href: '/clients' as const, label: 'Clientes', count: clients.data?.length },
  ]

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>Tu cuenta</Text>
      <View style={styles.card}>
        {rows.map((row) => (
          <Pressable key={row.href} style={styles.row} onPress={() => router.push(row.href)}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <View style={styles.rowRight}>
              <Text style={styles.rowCount}>{row.count ?? '—'}</Text>
              <FontAwesome name="chevron-right" size={13} color={colors.muted} />
            </View>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Perfil</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Email</Text>
          <Text style={styles.rowValue}>{user?.email}</Text>
        </View>
        <Pressable style={styles.row} onPress={() => logout()}>
          <Text style={styles.logout}>Cerrar sesión</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40, gap: 10 },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 10,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 16, color: colors.ink },
  rowValue: { fontSize: 14, color: colors.muted },
  rowCount: { fontSize: 14, color: colors.muted },
  logout: { fontSize: 16, color: colors.danger, fontWeight: '600' },
})
```

- [ ] **Step 3: Registrar la tab**

En `mobile/app/(tabs)/_layout.tsx`, después del `Tabs.Screen` de `new-movement`:

```tsx
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ajustes',
          tabBarIcon: ({ color }) => <TabIcon name="cog" color={String(color)} />,
        }}
      />
```

- [ ] **Step 4: Sacar el "Salir" del header de Inicio**

En `mobile/app/(tabs)/index.tsx`, reemplazar el bloque `headerRow` por:

```tsx
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.hello}>Hola</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
      </View>
```

Sacar `logout` del destructuring de `useAuth` (queda `const { accessToken, user } = useAuth()`) y borrar el estilo `logout` de ese archivo, que queda sin uso.

- [ ] **Step 5: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
npx expo start --ios
```

Expected: aparece la tab "Ajustes" al final de la barra, con los conteos de billeteras y clientes; "Cerrar sesión" vuelve al login; Inicio ya no tiene el "Salir".

- [ ] **Step 6: Commit**

```bash
git add mobile/src/ui/formStyles.ts mobile/app/\(tabs\)/settings.tsx mobile/app/\(tabs\)/_layout.tsx mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): add settings tab with profile and wallet/client entries"
```

---

### Task 6: Pantalla de billeteras (listado)

**Files:**
- Create: `mobile/app/wallets.tsx`
- Modify: `mobile/app/_layout.tsx:57-63` (`Stack` raíz)

**Interfaces:**
- Consumes: `WalletBalance` de `mobile/src/api/types.ts`, `formatAmount` de `mobile/src/lib/format.ts`, query `['balance-by-wallet']` (devuelve **todas** las billeteras, con saldo).
- Produces: ruta `/wallets` navegable desde Ajustes, con header nativo y back.

- [ ] **Step 1: Registrar la ruta en el Stack raíz**

En `mobile/app/_layout.tsx`, dentro del `<Stack>`, después de `<Stack.Screen name="(tabs)" />`:

```tsx
            <Stack.Screen
              name="wallets"
              options={{
                headerShown: true,
                title: 'Billeteras',
                headerStyle: { backgroundColor: colors.bg },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="clients"
              options={{
                headerShown: true,
                title: 'Clientes',
                headerStyle: { backgroundColor: colors.bg },
                headerShadowVisible: false,
              }}
            />
```

Agregar el import `import { colors } from '@/src/theme'`.

El `Stack.Screen` de `clients` queda declarado acá aunque el archivo llegue recién en la Task 9. Si expo-router avisa `No route named "clients" exists`, mover ese bloque a la Task 9 y dejar solo el de `wallets`.

- [ ] **Step 2: Escribir el listado**

Crear `mobile/app/wallets.tsx`:

```tsx
import { apiRequest } from '@/src/api/client'
import type { WalletBalance } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
import { useQuery } from '@tanstack/react-query'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'

export default function WalletsScreen() {
  const { accessToken } = useAuth()

  const balances = useQuery({
    queryKey: ['balance-by-wallet'],
    queryFn: () =>
      apiRequest<WalletBalance[]>('/reports/balance-by-wallet', { token: accessToken }),
    enabled: !!accessToken,
  })

  return (
    <View style={styles.container}>
      {balances.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={balances.data ?? []}
          keyExtractor={(item) => item.wallet.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={balances.isFetching}
              onRefresh={() => balances.refetch()}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>Todavía no tenés billeteras.</Text>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.wallet.name}</Text>
                <Text style={styles.meta}>{item.currency}</Text>
              </View>
              <Text style={styles.balance}>{formatAmount(item.balance, item.currency)}</Text>
            </Pressable>
          )}
        />
      )}

      <View style={styles.footer}>
        <Pressable style={formStyles.button}>
          <Text style={formStyles.buttonText}>Nueva billetera</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  balance: { fontSize: 15, fontWeight: '700', color: colors.accent },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
})
```

El botón y las filas todavía no hacen nada: el modal llega en la Task 7.

- [ ] **Step 3: Chequear tipos y probar la navegación**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. En el simulador, Ajustes → Billeteras abre la pantalla con header "Billeteras", back nativo y las billeteras del onboarding con su saldo.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/wallets.tsx mobile/app/_layout.tsx
git commit -m "feat(mobile): list wallets with their balance"
```

---

### Task 7: Alta y edición de billeteras

**Files:**
- Modify: `mobile/app/wallets.tsx`

**Interfaces:**
- Consumes: `POST /wallets` (`{ name, currency }` → 201), `PATCH /wallets/:id` (`{ name }` → 200, 409 si el nombre está usado), `formStyles` (Task 5).
- Produces: modal reusado para alta y edición; en edición la moneda queda fija.

- [ ] **Step 1: Agregar estado y mutaciones**

En `mobile/app/wallets.tsx`, sumar imports (`useState`, `Modal`, `TextInput`, `useMutation`, `useQueryClient`, `ApiError`, `Wallet`) y dentro del componente:

```tsx
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Wallet | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('ARS')
  const [error, setError] = useState<string | null>(null)

  const open = Boolean(editing) || creating

  function openCreate() {
    setEditing(null)
    setCreating(true)
    setName('')
    setCurrency('ARS')
    setError(null)
  }

  function openEdit(wallet: Wallet) {
    setCreating(false)
    setEditing(wallet)
    setName(wallet.name)
    setCurrency(wallet.currency)
    setError(null)
  }

  function close() {
    setCreating(false)
    setEditing(null)
    setError(null)
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['wallets'] })
    await queryClient.invalidateQueries({ queryKey: ['balance-by-wallet'] })
  }

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiRequest<Wallet>(`/wallets/${editing.id}`, {
            method: 'PATCH',
            token: accessToken,
            body: { name: name.trim() },
          })
        : apiRequest<Wallet>('/wallets', {
            method: 'POST',
            token: accessToken,
            body: { name: name.trim(), currency },
          }),
    onSuccess: async () => {
      await refresh()
      close()
    },
    // El backend ya manda el mensaje en castellano (409 = nombre repetido).
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo guardar'),
  })

  function submit() {
    setError(null)
    if (!name.trim()) {
      setError('Escribí un nombre')
      return
    }
    save.mutate()
  }
```

- [ ] **Step 2: Conectar el botón y las filas**

Cambiar el `Pressable` de la fila a `onPress={() => openEdit(item.wallet)}` y el del footer a `onPress={openCreate}`.

- [ ] **Step 3: Renderizar el modal**

Antes del `</View>` que cierra el `container`:

```tsx
      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {editing ? 'Editar billetera' : 'Nueva billetera'}
            </Text>

            <Text style={formStyles.label}>Nombre</Text>
            <TextInput
              style={formStyles.input}
              placeholder="Ej. Mercado Pago"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
            />

            {editing ? (
              <Text style={styles.note}>La moneda ({editing.currency}) no se puede cambiar.</Text>
            ) : (
              <>
                <Text style={formStyles.label}>Moneda</Text>
                <View style={formStyles.rowWrap}>
                  {['ARS', 'USD', 'USDT'].map((c) => (
                    <Pressable
                      key={c}
                      style={[formStyles.chip, currency === c && formStyles.chipActive]}
                      onPress={() => setCurrency(c)}
                    >
                      <Text
                        style={[
                          formStyles.chipText,
                          currency === c && formStyles.chipTextActive,
                        ]}
                      >
                        {c}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {error ? <Text style={formStyles.error}>{error}</Text> : null}

            <Pressable style={formStyles.button} onPress={submit} disabled={save.isPending}>
              {save.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={formStyles.buttonText}>Guardar</Text>
              )}
            </Pressable>
            <Pressable onPress={close}>
              <Text style={styles.cancel}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
```

Agregar los estilos:

```ts
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  note: { fontSize: 13, color: colors.muted },
  cancel: { color: colors.muted, textAlign: 'center', paddingVertical: 8 },
```

- [ ] **Step 4: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. En el simulador: crear "Mercado Pago" ARS y verla aparecer en la lista, en Inicio y en el selector de Nuevo movimiento sin reiniciar; renombrarla; intentar renombrarla con el nombre de otra billetera y ver el mensaje del 409.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/wallets.tsx
git commit -m "feat(mobile): create and rename wallets"
```

---

### Task 8: Borrado de billeteras

**Files:**
- Modify: `mobile/app/wallets.tsx`

**Interfaces:**
- Consumes: `DELETE /wallets/:id` (204, o 400 `'No se puede borrar una billetera con movimientos'`).
- Produces: botón Borrar dentro del modal de edición, con `Alert.alert` de confirmación.

- [ ] **Step 1: Agregar la mutación de borrado**

Sumar `Alert` al import de `react-native` y, después de la mutación `save`:

```tsx
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/wallets/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      await refresh()
      close()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo borrar'),
  })

  function confirmRemove() {
    if (!editing) return
    Alert.alert('Borrar billetera', `¿Borrar "${editing.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => remove.mutate(editing.id) },
    ])
  }
```

- [ ] **Step 2: Mostrar el botón solo en edición**

En el modal, entre el botón Guardar y el Cancelar:

```tsx
            {editing ? (
              <Pressable onPress={confirmRemove} disabled={remove.isPending}>
                <Text style={styles.delete}>Borrar billetera</Text>
              </Pressable>
            ) : null}
```

y el estilo:

```ts
  delete: { color: colors.danger, textAlign: 'center', paddingVertical: 8, fontWeight: '600' },
```

- [ ] **Step 3: Chequear tipos y probar los dos caminos**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. En el simulador: borrar una billetera vacía la saca de la lista; intentar borrar una con movimientos deja el modal abierto con el texto `No se puede borrar una billetera con movimientos`.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/wallets.tsx
git commit -m "feat(mobile): delete wallets with confirmation"
```

---

### Task 9: Pantalla de clientes (listado)

**Files:**
- Create: `mobile/app/clients.tsx`
- Modify: `mobile/src/api/types.ts:32-39` (type `Client`)

**Interfaces:**
- Consumes: `GET /clients`, `Client.phone` (Task 4).
- Produces: `Client = { id, name, phone, defaultCurrency, createdAt, updatedAt }` y la ruta `/clients` (ya registrada en el Stack por la Task 6).

- [ ] **Step 1: Sumar `phone` al tipo**

En `mobile/src/api/types.ts`, dentro de `Client`, después de `name`:

```ts
  phone: string | null
```

- [ ] **Step 2: Escribir el listado**

Crear `mobile/app/clients.tsx`:

```tsx
import { apiRequest } from '@/src/api/client'
import type { Client } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
import { useQuery } from '@tanstack/react-query'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'

export default function ClientsScreen() {
  const { accessToken } = useAuth()

  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiRequest<Client[]>('/clients', { token: accessToken }),
    enabled: !!accessToken,
  })

  return (
    <View style={styles.container}>
      {clients.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={clients.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={clients.isFetching} onRefresh={() => clients.refetch()} />
          }
          ListEmptyComponent={<Text style={styles.empty}>Todavía no tenés clientes.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.defaultCurrency}
                  {item.phone ? ` · ${item.phone}` : ''}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <View style={styles.footer}>
        <Pressable style={formStyles.button}>
          <Text style={formStyles.buttonText}>Nuevo cliente</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
})
```

- [ ] **Step 3: Chequear tipos y probar la navegación**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. Ajustes → Clientes abre la pantalla con header "Clientes"; los clientes creados desde Nuevo movimiento aparecen listados.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/clients.tsx mobile/src/api/types.ts
git commit -m "feat(mobile): list clients with phone and currency"
```

---

### Task 10: Alta y edición de clientes

**Files:**
- Modify: `mobile/app/clients.tsx`

**Interfaces:**
- Consumes: `POST /clients` (`{ name, phone, defaultCurrency }` → 201), `PATCH /clients/:id` (los tres campos, todos opcionales).
- Produces: modal de alta/edición; el `PATCH` manda `phone: ''` para limpiar el campo (el backend lo guarda como `null`).

- [ ] **Step 1: Agregar estado y la mutación**

Sumar imports (`useState`, `Modal`, `TextInput`, `useMutation`, `useQueryClient`, `ApiError`) y dentro del componente:

```tsx
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Client | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [currency, setCurrency] = useState('ARS')
  const [error, setError] = useState<string | null>(null)

  const open = Boolean(editing) || creating

  function openCreate() {
    setEditing(null)
    setCreating(true)
    setName('')
    setPhone('')
    setCurrency('ARS')
    setError(null)
  }

  function openEdit(client: Client) {
    setCreating(false)
    setEditing(client)
    setName(client.name)
    setPhone(client.phone ?? '')
    setCurrency(client.defaultCurrency)
    setError(null)
  }

  function close() {
    setCreating(false)
    setEditing(null)
    setError(null)
  }

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), phone: phone.trim(), defaultCurrency: currency }
      return editing
        ? apiRequest<Client>(`/clients/${editing.id}`, {
            method: 'PATCH',
            token: accessToken,
            body,
          })
        : apiRequest<Client>('/clients', { method: 'POST', token: accessToken, body })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      close()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo guardar'),
  })

  function submit() {
    setError(null)
    if (!name.trim()) {
      setError('Escribí un nombre')
      return
    }
    save.mutate()
  }
```

- [ ] **Step 2: Conectar el botón y las filas**

Fila: `onPress={() => openEdit(item)}`. Footer: `onPress={openCreate}`.

- [ ] **Step 3: Renderizar el modal**

Antes del `</View>` que cierra el `container`:

```tsx
      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editing ? 'Editar cliente' : 'Nuevo cliente'}</Text>

            <Text style={formStyles.label}>Nombre</Text>
            <TextInput
              style={formStyles.input}
              placeholder="Ej. Estudio Contable"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
            />

            <Text style={formStyles.label}>Teléfono (opcional)</Text>
            <TextInput
              style={formStyles.input}
              keyboardType="phone-pad"
              placeholder="+54 9 11 2233 4455"
              placeholderTextColor={colors.muted}
              value={phone}
              onChangeText={setPhone}
            />

            <Text style={formStyles.label}>Moneda por defecto</Text>
            <View style={formStyles.rowWrap}>
              {['ARS', 'USD', 'USDT'].map((c) => (
                <Pressable
                  key={c}
                  style={[formStyles.chip, currency === c && formStyles.chipActive]}
                  onPress={() => setCurrency(c)}
                >
                  <Text
                    style={[formStyles.chipText, currency === c && formStyles.chipTextActive]}
                  >
                    {c}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error ? <Text style={formStyles.error}>{error}</Text> : null}

            <Pressable style={formStyles.button} onPress={submit} disabled={save.isPending}>
              {save.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={formStyles.buttonText}>Guardar</Text>
              )}
            </Pressable>
            <Pressable onPress={close}>
              <Text style={styles.cancel}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
```

Agregar los estilos `backdrop`, `sheet`, `sheetTitle` y `cancel`, con los mismos valores que en `mobile/app/wallets.tsx`:

```ts
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  cancel: { color: colors.muted, textAlign: 'center', paddingVertical: 8 },
```

- [ ] **Step 4: Chequear tipos y probar**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. En el simulador: crear un cliente con teléfono, editarlo, borrarle el teléfono (queda sin el ` · +54…` en la lista) y verlo aparecer en el selector de cliente de Nuevo movimiento.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/clients.tsx
git commit -m "feat(mobile): create and edit clients"
```

---

### Task 11: Borrado de clientes

**Files:**
- Modify: `mobile/app/clients.tsx`

**Interfaces:**
- Consumes: `DELETE /clients/:id` (204, o 400 `'No se puede borrar un cliente con movimientos'` desde la Task 3).
- Produces: botón Borrar en el modal de edición con `Alert.alert`.

- [ ] **Step 1: Agregar la mutación de borrado**

Sumar `Alert` al import de `react-native` y, después de la mutación `save`:

```tsx
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/clients/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      close()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo borrar'),
  })

  function confirmRemove() {
    if (!editing) return
    Alert.alert('Borrar cliente', `¿Borrar "${editing.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => remove.mutate(editing.id) },
    ])
  }
```

- [ ] **Step 2: Mostrar el botón solo en edición**

En el modal, entre Guardar y Cancelar:

```tsx
            {editing ? (
              <Pressable onPress={confirmRemove} disabled={remove.isPending}>
                <Text style={styles.delete}>Borrar cliente</Text>
              </Pressable>
            ) : null}
```

y el estilo:

```ts
  delete: { color: colors.danger, textAlign: 'center', paddingVertical: 8, fontWeight: '600' },
```

- [ ] **Step 3: Chequear tipos y probar los dos caminos**

```bash
cd mobile && npx tsc --noEmit
```

Expected: sin errores. En el simulador: borrar un cliente sin movimientos lo saca de la lista; intentar borrar uno que tiene un ingreso asociado muestra `No se puede borrar un cliente con movimientos` y el movimiento sigue mostrando su cliente en la lista de Movimientos.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/clients.tsx
git commit -m "feat(mobile): delete clients with confirmation"
```

---

### Task 12: Documentación y verificación end-to-end

**Files:**
- Modify: `README.md`
- Modify: `IMPLEMENTATION_PLAN.md` (fila 2 del roadmap)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Documentar la regla de borrado**

En `README.md`, en la tabla de endpoints, dejar explícito el bloqueo en las filas de borrado:

```
| DELETE | `/wallets/:id` | 400 si la billetera tiene movimientos |
| DELETE | `/clients/:id` | 400 si el cliente tiene movimientos |
```

Si esas filas no existen tal cual, agregarlas al final de la tabla respetando el formato de las que ya están.

- [ ] **Step 2: Marcar la fase 2 en el roadmap**

En `IMPLEMENTATION_PLAN.md`, en la fila 2 de la tabla "Orden de ejecución", cambiar el título a `[ABM de billeteras y clientes](docs/superpowers/specs/02-abm-billeteras-clientes.md) ✅ implementada`.

- [ ] **Step 3: Verificación de backend**

```bash
docker compose up -d db
cd backend && npx prisma migrate dev && npm test
```

Expected: la migración `add_client_phone` aplica; la suite entera en verde (auth, exchange rates, wallets-clients).

Con el server arriba (`npm run dev`) y un token válido:

```bash
TOKEN=... # accessToken de POST /auth/login
curl -s -X POST localhost:8000/wallets -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Mercado Pago","currency":"ARS"}'
```

Expected: 201. Verificar la cuenta espejo:

```bash
docker compose exec db psql -U monedapp_user -d monedapp -c "select name from accounts order by \"createdAt\" desc limit 3;"
```

Expected: aparece `Mercado Pago (ARS)`. Después de un `PATCH /wallets/:id {"name":"MP"}`, la misma consulta muestra `MP (ARS)`.

- [ ] **Step 4: Verificación de app**

```bash
cd mobile && npx expo start --ios
```

Recorrido completo: tab Ajustes → crear billetera ARS → verla en Inicio y en el selector de Nuevo movimiento sin reiniciar → renombrarla → intentar borrar una con movimientos y ver el mensaje del backend → crear, editar y borrar un cliente → cerrar sesión desde Ajustes.

- [ ] **Step 5: Commit**

```bash
git add README.md IMPLEMENTATION_PLAN.md
git commit -m "docs: document wallet and client management"
```
