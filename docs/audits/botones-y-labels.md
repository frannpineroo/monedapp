# Auditoría: botones y labels (mobile)

**Fecha:** 2026-09-11  
**Alcance:** `mobile/` — primitivos de `src/ui/` y pantallas de `app/`  
**Estado:** hallazgos guardados; fixes pendientes  
**Contexto:** prioridad pedida por el usuario — primero botones/labels que no funcionen o se puedan mejorar; el rediseño más profesional viene después.

Repo: `frannpineroo/monedapp` · rama de referencia al auditar: `main`

---

## P0 — roto / no cumple lo que promete

### 1. Badge de pendientes nunca se muestra
- **Dónde:** `app/(tabs)/_layout.tsx`
- **Qué pasa:** se fetcha `pendingCount` y existe `tabBarBadgeStyle`, pero ningún `Tabs.Screen` setea `tabBarBadge`.
- **Por qué importa:** se paga una query y el estilo existe, pero el usuario no ve el contador en la tab.
- **Fix sugerido:** `tabBarBadge: pendingCount || undefined` en la tab `movements` (o Inicio).

### 2. Banner "para revisar" no aplica el filtro
- **Dónde:** `app/(tabs)/index.tsx` → `/(tabs)/movements?review=1` + `app/(tabs)/movements.tsx`
- **Qué pasa:** `typeFilter` se inicializa con `useState(params.review ? 'review' : 'all')` solo al mount. Las tabs suelen quedar montadas: si ya entraste a Movimientos, el deep link del banner deja el filtro en "Todos".
- **Por qué importa:** el CTA principal del home parece no hacer nada útil.
- **Fix sugerido:** `useEffect` / `useFocusEffect` que sincronice `params.review` → `setTypeFilter('review')` (y limpiar el param al "Limpiar filtros").

---

## P1 — funciona, pero confunde o es UX floja

### 3. Tab "Nuevo" quirky
- **Dónde:** `app/(tabs)/new.tsx` + `_layout.tsx`
- **Qué pasa:** stub que `return null`; el toque va a `/new-movement` vía `tabBarButton`. Título visible "Nuevo" vs `accessibilityLabel` "Cargar movimiento"; si la ruta `new` queda seleccionada, pantalla en blanco; `focused` del `+` casi no aplica.
- **Fix sugerido:** alinear copy a11y/título, navegación más robusta, y evitar foco en la stub (o redirigir en mount).

### 4. Destructivos sin confirmación
- **Dónde:** `settings.tsx` ("Cerrar sesión"), `integrations.tsx` ("Desconectar")
- **Qué pasa:** billeteras/clientes/categorías sí usan `Alert.alert`; logout y desconectar MP no.
- **Fix sugerido:** mismo patrón `Alert` cancelar / confirmar.

### 5. Filas tappeables sin rol a11y
- **Dónde:** `ListRow.tsx`, `Card.tsx`, filas de `settings.tsx`
- **Qué pasa:** son `Pressable` tappeables sin `accessibilityRole="button"` / label (`Button` sí lo tiene).
- **Fix sugerido:** role + label (o heredar el `title`/texto de la fila).

### 6. EmptyState de "Te deben" sin CTA
- **Dónde:** `receivables.tsx`
- **Qué pasa:** solo título/body; con filtro no ofrece "Limpiar"; vacío total no lleva a crear factura.
- **Fix sugerido:** `actionLabel` / `onAction` (limpiar filtro o `router.push('/new-movement')` con tipo factura).

### 7. Filtros como Selects apilados (tipos incompletos)
- **Dónde:** `movements.tsx` / `receivables.tsx`
- **Qué pasa:** tres Selects verticales comen mucha pantalla; `typeLabel` tiene Factura/Cobro pero `typeOptions` no.
- **Fix sugerido:** chips horizontales para tipo/estado; sumar Factura (y Cobro si aplica).

### 8. Tarjetas de billetera en Inicio no son tappeables
- **Dónde:** `index.tsx` (`walletCard` = `View`)
- **Qué pasa:** parecen cards; solo el `LinkButton` "Administrar" navega.
- **Fix sugerido:** `onPress` → `/wallets` (o detalle).

### 9. Flechas de mes solo-ícono
- **Dónde:** `reports.tsx` (`MonthArrow`)
- **Qué pasa:** `accessibilityRole="button"` sin `accessibilityLabel` ("Mes anterior/siguiente").
- **Fix sugerido:** labels explícitos.

### 10. `Field` no asocia label al input
- **Dónde:** `Field.tsx`
- **Qué pasa:** el rótulo es `Txt` suelto; el `TextInput` no recibe `accessibilityLabel={label}`.
- **Fix sugerido:** pasar label al input (y hint si hay error).

---

## P2 — polish

### 11. `Button.onPress` opcional
- **Dónde:** `Button.tsx`
- **Qué pasa:** permite botones con look de CTA y sin handler.
- **Fix sugerido:** `onPress` required (salvo `loading`/`disabled`).

### 12. Onboarding: cards "muertas" al elegir
- **Dónde:** `onboarding.tsx`
- **Qué pasa:** con `busyId`, `onPress` pasa a `undefined` (deja de ser Pressable) pero siguen el chevron/look tappable.
- **Fix sugerido:** mantener Pressable `disabled` + opacity, o spinner en todas.

---

## Notas

- `pendingCount` en Inicio **sí** se usa en el banner; el muerto es solo el de la tab bar.
- Empty states de movimientos / clientes / wallets / categorías sí traen CTA decente.
- Primitivos relacionados: `LinkButton` y `EmptyState`/`Badge` viven en `src/ui/Button.tsx` y `Section.tsx`.

## Siguiente paso

Cuando se retome: arrancar por los **P0**, luego P1, y recién después el rediseño visual más profesional.
