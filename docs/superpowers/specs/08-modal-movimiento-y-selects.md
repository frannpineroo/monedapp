# Spec 8 — Modal de nuevo movimiento y selects de consulta

**Estado:** propuesto · **Tamaño:** M · **Alcance:** solo `mobile/`, sin cambios de backend

## Contexto

Hoy cargar un movimiento es una **tab completa** (`(tabs)/new-movement`). El formulario ocupa 491 líneas y elige casi todo con `Chip`/`ChipRow`: pastillas que se acomodan una al lado de la otra y, cuando no entran, wrappean. El mismo patrón se copia a los filtros de listas.

El pedido: que el alta **salga de abajo como un modal**, y que **cualquier grupo de botones lado a lado para elegir un valor** pase a un option select. No es un retoque visual de una pantalla: es el control de elección de la app.

Medición (2026-08-24, rama `codex/f6-reportes-monotributo`):

```
<Chip  en 8 archivos, 33 usos
ChipRow en 7 archivos
Sheet   ya existe y se usa en wallets / clients / categories
new-movement es tab, no Sheet
```

| Archivo | Grupos Chip | Qué eligen |
|---|---|---|
| `(tabs)/new-movement.tsx` | 7 | tipo, moneda, billetera, destino, cliente, categoría, cotización |
| `(tabs)/movements.tsx` | 3 | tipo, billetera, categoría (filtros, con scroll horizontal) |
| `receivables.tsx` | 1 | estado |
| `categories.tsx` | 1 | gastos / ingresos |
| `wallets.tsx` | 1 | moneda, **dentro** del Sheet de alta |
| `clients.tsx` | 1 | moneda por defecto, **dentro** del Sheet de alta |
| `(tabs)/reports.tsx` | 1 | categoría de monotributo (A–K) |
| `movement/[id].tsx` | 2 | cliente; billetera de cobro |

Fuentes consultadas (Context7 + docs Expo SDK 57, 2026-08-24):

- [Expo Router — Modals / form sheet](https://docs.expo.dev/router/advanced/modals/): `presentation: 'formSheet'` con `sheetAllowedDetents`, `sheetGrabberVisible`, `sheetCornerRadius`. El `Modal` de RN queda para interacciones que **no** son ruta.
- RN `Modal`: `animationType="slide"` + `transparent` (es lo que ya hace [`Sheet.tsx`](../../../mobile/src/ui/Sheet.tsx)). `presentationStyle: 'formSheet'` del `Modal` de RN **solo aplica en iPad / plus**, no es el bottom sheet de iPhone.
- RN `ActionSheetIOS`: nativo iOS, sin paridad Android, pensado para 2–5 acciones, no para 12 categorías. Se descarta.
- `@react-native-picker/picker` (rueda): no está en el proyecto y es el patrón viejo para listas nombradas. Se descarta. No se agrega dependencia.

## Decisiones

| # | Decisión | Elegida |
|---|---|---|
| D1 | Cómo sale el alta | **Ruta `formSheet` de Expo Router**, no una tab y no el `Sheet` casero. |
| D2 | Cómo se elige un valor | **`Select` nuevo**: trigger con pinta de `Field` + lista vertical. Cero chips. |
| D3 | Select dentro de un Sheet ya abierto | **Lista inline**, sin segundo `Modal`. RN no apila `Modal` de forma fiable. |
| D4 | Destino de `Chip` | **Se borra** `Chip.tsx` / `ChipRow` cuando no quede ningún uso. |
| D5 | El `+` de la tab bar | **Se queda.** El press no cambia de tab: hace `router.push('/new-movement')`. |
| D6 | Después de guardar | **Se cierra el sheet** (`router.back()`). El usuario sigue en Inicio o Movimientos, no lo mandamos a otra tab. |

### Por qué D1 no reusa `Sheet`

[`Sheet.tsx`](../../../mobile/src/ui/Sheet.tsx) ya es un bottom sheet (RN `Modal` + slide + handle + backdrop). Sirve para altas cortas (billetera, cliente, categoría). El alta de movimiento es un formulario largo, con teclado, y tiene que convivir con `Select` que **también** abre un sheet.

Si ambos fueran RN `Modal`, el segundo no aparece en iOS. Expo Router `formSheet` es un `UIViewController` nativo; un `Modal` de RN **sí** se puede presentar encima. Esa es la combinación que documenta Expo: form sheet para el flujo que es ruta; `Modal` para el picker temporal.

El `+` no puede ser la escena activa: hoy, al tocarlo, desaparecen Inicio/Movimientos y queda un formulario a pantalla completa. El form sheet deja la tab de fondo dimmeada y se arrastra para cerrar (`sheetGrabberVisible: true`).

### Por qué D2 no es ActionSheet ni rueda

Las listas reales son largas (billeteras, clientes, categorías, escalas A–K) y tienen que verse igual en iOS y Android. El trigger de un select de consulta, hoy, es un campo: rótulo arriba, valor actual adentro, chevron a la derecha. Eso es lo que el usuario pidió en lugar de pastillas wrappeadas.

## Forma

### 1. Form sheet de nuevo movimiento

Mover el formulario de [`mobile/app/(tabs)/new-movement.tsx`](../../../mobile/app/(tabs)/new-movement.tsx) a [`mobile/app/new-movement.tsx`](../../../mobile/app/new-movement.tsx). En [`mobile/app/_layout.tsx`](../../../mobile/app/_layout.tsx):

```tsx
<Stack.Screen
  name="new-movement"
  options={{
    presentation: 'formSheet',
    headerShown: false,
    sheetAllowedDetents: [0.94],
    sheetGrabberVisible: true,
    sheetCornerRadius: 24, // = radius.xxl del tema
  }}
/>
```

Un solo detent al 94%: se ve que hay pantalla detrás, no es un page sheet a pantalla completa. No usar `'fitToContents'`: el form tiene teclado y `flex: 1` (documentado en SDK 55+ para detents numéricos).

Contenido, en este orden:

1. Título "Nuevo movimiento" (el header nativo no existe dentro de formSheet en Android — [docs Expo](https://docs.expo.dev/router/advanced/modals/#android-limitations) — así que el título va en el cuerpo, igual que `Sheet`).
2. `Select` **Tipo** — Ingreso / Gasto / Transferencia / Factura.
3. Card de monto (igual que ahora: moneda + `TextInput` grande a la derecha).
4. `Field` Descripción.
5. Los `Select` que correspondan al tipo (misma lógica condicional que hoy: billetera vs moneda+vencimiento; destino; cliente; categoría; cotización).
6. Error, si hay.
7. Botón "Guardar movimiento" al pie del scroll, no con `unstable_sheetFooter` (API experimental Android).

Cerrar: swipe down, tap fuera si el detent lo permite, o después de un save OK.

El archivo `(tabs)/new-movement.tsx` **deja de ser el formulario**. Queda un stub vacío cuya única razón de existir es que `js-tabs` necesita un `name` para el ícono `+`. El `tabPress` se cancela:

```tsx
<Tabs.Screen
  name="new-movement"
  listeners={{
    tabPress: (e) => {
      e.preventDefault()
      router.push('/new-movement')
    },
  }}
  options={{ title: 'Nuevo', tabBarIcon: … }}
/>
```

El stub de `(tabs)/new-movement.tsx` renderiza `null`. Si `js-tabs` no dispara `tabPress` (verificar en la implementación: la API es la de React Navigation), el fallback es un `tabBarButton` que llama `router.push` y no marca la tab.

Call sites que hoy hacen `router.push('/(tabs)/new-movement')` pasan a `router.push('/new-movement')`:

- `(tabs)/index.tsx` (empty state + botón)
- `(tabs)/movements.tsx` (empty state)

La mutación de create, al éxito: invalida las mismas queries de hoy y `router.back()`. **No** `router.push('/(tabs)/movements')`.

### 2. Componente `Select`

Archivo nuevo: `mobile/src/ui/Select.tsx`. Exportado desde `mobile/src/ui/index.ts`.

```ts
type SelectOption<T extends string> = {
  value: T
  label: string
  /** Línea secundaria opcional (ej. "USD · Mercado Pago"). */
  meta?: string
}

type SelectProps<T extends string> = {
  label: string
  value: T | null
  options: SelectOption<T>[]
  onChange: (value: T) => void
  placeholder?: string // default "Elegí…"
  /** Acción extra al pie de la lista (ej. "Nueva categoría"). */
  footerAction?: { label: string; onPress: () => void }
  /** Dentro de un Sheet ya abierto: no monta otro Modal. */
  nested?: boolean
  error?: string
}
```

**Trigger** (siempre):

- Misma anatomía que [`Field`](../../../mobile/src/ui/Field.tsx): rótulo `variant="label"` `tone="faint"`, caja 48px, `backgroundColor: colors.surfaceSunken`, `borderRadius: radius.md`, `minHeight: 48`.
- Izquierda: valor elegido (`tone="ink"`) o placeholder (`tone="faint"`).
- Derecha: ícono `chevron-down` Feather, `colors.faint`, 18px.
- `accessibilityRole="combobox"` (si el runtime no lo acepta, `"button"`) + `accessibilityLabel={label}` + `accessibilityValue={{ text: label mostrado }}`.

**Opciones, caso normal (`nested={false}`):**

- Abre el `Sheet` existente, `title={label}`.
- Lista vertical scrollable. Cada fila: título + meta opcional + check a la derecha si está seleccionada (`Feather check`, `colors.brand`).
- No reusar `ListRow` tal cual: `ListRow` tiene borde y 64px y está pensado para listas de pantalla. Las opciones del sheet son filas de 52px, sin borde por fila, separadas por hairline. Extraer no es necesario: el markup vive en `Select.tsx`.
- Tap elige, llama `onChange`, cierra.
- `footerAction`, si existe, es un `LinkButton` debajo de la lista, no una opción más. Ej.: "Nuevo cliente", "Nueva categoría". El alta inline (el `Field`+`Agregar` que hoy aparece bajo los chips) se abre **en el formulario padre**, no dentro del sheet de opciones: el footer cierra el sheet de opciones y setea `showNewClient` / `showNewCategory` como ahora.

**Opciones, caso `nested={true}`:**

- El trigger es idéntico.
- Tap **no** abre `Sheet`. Expande/colapsa las mismas filas de opción **debajo del trigger**, dentro del padre. Un segundo tap en el trigger cierra. Elegir una opción colapsa.
- Uso obligatorio en [`wallets.tsx`](../../../mobile/app/wallets.tsx) y [`clients.tsx`](../../../mobile/app/clients.tsx), que ya viven dentro de `Sheet`.

### 3. Extensión de `Sheet`

[`Sheet.tsx`](../../../mobile/src/ui/Sheet.tsx) gana:

- `scroll?: boolean` — el cuerpo va en `ScrollView` con `keyboardShouldPersistTaps="handled"`.
- El contenedor del sheet tiene `maxHeight: '90%'` para que una lista de 20 categorías no se salga de pantalla.
- Sigue cerrándose tocando el backdrop y con `onRequestClose`.

No se agrega `@gorhom/bottom-sheet` ni otra lib.

### 4. Reemplazo por pantalla

Cada grupo de la tabla del contexto se vuelve **un** `Select`. No hay excepción de "son solo dos valores, dejemos chips". Gastos/Ingresos y ARS/USD/USDT también son `Select`.

**Movimientos.** Se eliminan `FilterRow`, el `ScrollView` horizontal y el accordion "Billetera y categoría". Quedan tres `Select` apilados, siempre visibles, compactos (3 × ~48px + rótulos vs. tres filas de chips que wrappean):

| Select | Valor vacío / "todas" |
|---|---|
| Tipo | `all` → label "Todos". Opciones: Todos, Para revisar, Ingresos, Gastos, Transferencias. (Factura y cobro no están hoy en `typeOptions`; **no se agregan**.) |
| Billetera | `null` → "Todas" |
| Categoría | `null` → "Todas" |

El empty state "Limpiar filtros" sigue reseteando los tres.

**Te deben (`receivables`).** Un `Select` "Estado": Todas / Pendientes / Vencidas / Cobradas. El option `partial` no está en los chips actuales; **no se agrega**.

**Categorías.** Un `Select` "Tipo": Gastos / Ingresos. Default `EXPENSE`, como ahora.

**Reportes.** Un `Select` "Tu categoría" con `alert.data.scales`. El hint de la cuota se queda debajo. El selector de mes (flechas) **no** se toca: no es un grupo de chips.

**Detalle de movimiento.** `Select` Cliente (incluye opción `null` "Sin cliente") y `Select` "Cobrar en".

**Alta de movimiento.** Misma matriz condicional que el JSX actual, con `Select` en lugar de `Group`+`ChipRow`. Opciones con `value` estable (`wallet.id`, `category.id`, `r.type`, moneda). Labels: `w.name`, `c.name`, `` `${r.type} ${n}` ``.

### 5. Borrado de `Chip`

Cuando grep de `<Chip` y `ChipRow` en `mobile/` dé 0, se borra [`mobile/src/ui/Chip.tsx`](../../../mobile/src/ui/Chip.tsx) y su export en [`index.ts`](../../../mobile/src/ui/index.ts). No se deja el archivo "por si acaso".

## Lo que no cambia

- Contratos de API, query keys, validación del submit, alta inline de cliente/categoría, tipos de movimiento, cotización.
- `Sheet` para crear/editar billetera, cliente y categoría.
- Tab bar: cinco ítems, el del medio sigue siendo el `+` marcado.
- Tipografía, spacing, radios, paleta. Este spec no pisa al [spec 7](07-color-y-tema-claro.md). Si el spec 7 se implementa antes, `Select` y el form sheet usan `useThemeColors` / `makeStyles` como el resto; si se implementa después, `Select` nace con `colors` de módulo y el spec 7 lo migra en el barrido de `src/ui/`.

## Criterios de aceptación

1. Tocar el `+` de la tab bar **no** selecciona la tab "Nuevo": Inicio (o la tab previa) sigue focused y se presenta el form sheet desde abajo, con grabber, al ~94% de altura. Verificar en iPhone 17 Pro y en un emulador Android.
2. `router.push('/new-movement')` desde Inicio y desde el empty de Movimientos abre el mismo sheet. El back / swipe lo cierra y vuelve a esa pantalla.
3. Guardar un ingreso válido cierra el sheet, el movimiento aparece al ir a Movimientos (pull o navegación), y **no** cambia sola la tab activa.
4. En el form sheet no hay ningún `Chip`. Tipo, billetera, cliente, categoría, cotización y moneda de factura se eligen con `Select`. "Nuevo cliente" / "Nueva categoría" siguen pudiendo crear en el momento.
5. En Movimientos no hay chips ni scroll horizontal de filtros. Los tres `Select` filtran igual que hoy (`type` / `needsReview`, `walletId`, `categoryId`). "Limpiar filtros" vuelve los tres al valor "todas/todos".
6. En Te deben, Categorías, Reportes (categoría de monotributo), Detalle de movimiento, Nueva billetera y Nuevo cliente: cero chips. Nueva billetera y Nuevo cliente usan `nested` para la moneda.
7. Abrir el `Select` de categoría con ≥8 categorías: la lista scrollea dentro del sheet y no tapa el trigger de forma irrecuperable. Cerrar tocando el backdrop.
8. `rg "<Chip" mobile` y `rg "ChipRow" mobile` no matchean. `Chip.tsx` no existe.
9. `npx tsc --noEmit` en `mobile/` pasa.
10. Teclado en el monto del form sheet: el input sigue visible (KeyboardAvoidingView o equivalente). Verificar en iOS simulator.

## Plan de testing

`mobile/` no tiene runner. Este spec no agrega uno.

| Capa | Qué | Cómo |
|---|---|---|
| Tipos | Compila | `npx tsc --noEmit` |
| Manual | Criterios 1–3, 10 | Simulador iOS + emulador Android, tab `+` y CTA de Inicio |
| Manual | Criterio 4 | Alta ingreso, gasto, transferencia, factura (con cliente nuevo) |
| Manual | Criterio 5 | Combinar tipo + billetera + categoría; empty + limpiar |
| Manual | Criterio 6 | Un select por pantalla de la tabla |
| Manual | Criterio 7 | Usuario demo (`npm run db:seed:demo`) tiene categorías de sobra |
| Grep | Criterio 8 | `rg "<Chip|ChipRow" mobile` |

## Rollback

Solo UI. Revertir el PR restaura la tab-formulario y los chips. No hay persistencia nueva ni migración.

## Esfuerzo

| Pieza | Trabajo | Humano | Con agente |
|---|---|---|---|
| `Select` + extensión de `Sheet` | Componente, nested, a11y | 3h | 25min |
| Form sheet + tab intercept + rutas | Mover archivo, `_layout`, call sites | 2h | 20min |
| Reemplazo en 7 pantallas restantes | 3 filtros + 5 selects sueltos | 3h | 25min |
| Borrar `Chip`, tsc, QA en dos plataformas | Criterios 1–10 | 3h | 2h |
| | **Total** | **~11h** | **~3.5h** |

## Archivos

| Archivo | Cambio |
|---|---|
| `mobile/src/ui/Select.tsx` | **Nuevo** |
| `mobile/src/ui/Sheet.tsx` | `scroll`, `maxHeight: '90%'` |
| `mobile/src/ui/index.ts` | export `Select`; saca `Chip`/`ChipRow` |
| `mobile/src/ui/Chip.tsx` | **Eliminado** al final |
| `mobile/app/new-movement.tsx` | **Nuevo** — formulario, era tab |
| `mobile/app/(tabs)/new-movement.tsx` | Stub para el ícono `+` |
| `mobile/app/(tabs)/_layout.tsx` | `tabPress` → `router.push('/new-movement')` |
| `mobile/app/_layout.tsx` | `Stack.Screen` formSheet |
| `mobile/app/(tabs)/index.tsx` | href del CTA |
| `mobile/app/(tabs)/movements.tsx` | 3 `Select`; se va `FilterRow` |
| `mobile/app/(tabs)/reports.tsx` | `Select` de categoría |
| `mobile/app/receivables.tsx` | `Select` de estado |
| `mobile/app/categories.tsx` | `Select` de kind |
| `mobile/app/wallets.tsx` | `Select nested` de moneda |
| `mobile/app/clients.tsx` | `Select nested` de moneda |
| `mobile/app/movement/[id].tsx` | 2 `Select` |
| `docs/superpowers/specs/README.md` | Fila del spec 8 |

## Fuera de alcance

- Backend, Prisma, serializers.
- Date picker nativo para el vencimiento de factura (sigue el `Field` `YYYY-MM-DD`).
- Agregar filtros que hoy no existen (factura/cobro en Movimientos, `partial` en Te deben).
- `@gorhom/bottom-sheet`, `@react-native-picker/picker`, `ActionSheetIOS`.
- Cambiar la paleta o el tema claro (spec 7).
- Tests E2E / Jest en `mobile/`.
- Deep link marketing `monedapp://new-movement` más allá de lo que Expo Router ya resuelve al registrar la ruta.
