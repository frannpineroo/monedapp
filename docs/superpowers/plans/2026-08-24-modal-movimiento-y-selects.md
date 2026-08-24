# Modal de nuevo movimiento y selects de consulta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cargar un movimiento salga de abajo como un modal en vez de robarse la pantalla, y que elegir un valor sea siempre el mismo control —un select con pinta de campo— en lugar de pastillas que wrappean.

**Architecture:** El formulario deja de ser una tab y pasa a ser una ruta `formSheet` de Expo Router, que es un contenedor nativo y por eso admite que un `Modal` de React Native se presente encima. Eso habilita `Select`: un trigger con anatomía de `Field` que abre el `Sheet` que ya existe. Cuando el select vive dentro de un `Sheet` ya abierto no monta un segundo `Modal` —React Native no apila `Modal` de forma fiable— sino que despliega las opciones en línea. Cuando no quede ningún uso, `Chip` se borra.

**Tech Stack:** Expo SDK 57 · expo-router (`formSheet`, `js-tabs`) · React Native 0.86 · TypeScript 6 strict. Sin dependencias nuevas.

**Spec:** [docs/superpowers/specs/08-modal-movimiento-y-selects.md](../specs/08-modal-movimiento-y-selects.md)

**Rama:** `codex/f8-modal-movimiento-y-selects`, creada desde `main`. Ya existe.

**Depende de:** el [spec 7](../specs/07-color-y-tema-claro.md), que **ya está mergeado en `main`**. Eso resuelve la bifurcación de la línea 208 del spec 8: `Select` **nace tematizado**, con `useThemeStyles(makeStyles)` y `useThemeColors()`. No existe `import { colors }`.

---

## Correcciones al spec

Dos cosas del spec no sobreviven al contacto con el código instalado. Las dos están verificadas contra `mobile/node_modules`, no deducidas.

### C1 — `Tabs.Screen` no acepta `listeners`

El spec propone (líneas 96–107) interceptar el `+` con `listeners={{ tabPress }}`. Esa prop **no existe**. El tipo, en `expo-router/build/views/Screen.d.ts:3`, es:

```ts
export type ScreenProps<TOptions extends Record<string, any> = Record<string, any>> = {
    name?: string;
    initialParams?: Record<string, any>;
    options?: TOptions;
};
```

Tres props, y `listeners` no está entre ellas. El componente `Screen` de expo-router solo llama a `navigation.setOptions(options)`: no reenvía nada más a React Navigation. Escrito como está en el spec, TypeScript lo rechaza y, si alguien lo forzara, el handler nunca se dispararía.

**El fallback que el spec menciona al pasar (línea 109) es el camino real.** `tabBarButton` sí existe en las opciones, en `expo-router/build/react-navigation/bottom-tabs/types.d.ts:130`:

```ts
tabBarButton?: (props: BottomTabBarButtonProps) => React.ReactNode;
```

Se implementa en la Task 4.

### C2 — `app/new-movement.tsx` colisiona con el stub de la tab

El spec deja `(tabs)/new-movement.tsx` como stub (línea 94) y crea `app/new-movement.tsx` (línea 65). **Las dos resuelven al mismo href.** Los segmentos de grupo son transparentes en la URL: `(tabs)/new-movement` ya es alcanzable como `/new-movement` **hoy**, antes de tocar nada.

Verificado generando los tipos de ruta con los dos archivos presentes. `.expo/types/router.d.ts` queda con las dos entradas a la vez:

```
{ pathname: `/new-movement`; params?: Router.UnknownInputParams; }                    ← app/new-movement.tsx
{ pathname: `${'/(tabs)'}/new-movement` | `/new-movement`; params?: ... }             ← el stub
```

Expo Router **no emite ningún warning**: elige una y sigue. Un `router.push('/new-movement')` queda con dos candidatos y cuál gana depende del orden del árbol de rutas. Es exactamente el tipo de bug que no falla en tu máquina y falla en la de otro.

**Fix, verificado:** renombrar el stub a `app/(tabs)/new.tsx`. El nombre del archivo de la tab solo tiene que ser único; no lo ve nadie. Con ese cambio, regenerando los tipos, `/new-movement` vuelve a tener un único origen. Va en la Task 4.

---

## Global Constraints

- **Leer los docs versionados de Expo SDK 57 antes de escribir código de app**: https://docs.expo.dev/versions/v57.0.0/. Lo pide [mobile/AGENTS.md](../../../mobile/AGENTS.md). Aplica a `presentation: 'formSheet'`, `sheetAllowedDetents` y `tabBarButton`.
- **El color viene del contexto, nunca de un import.** Regla ya vigente en [mobile/AGENTS.md](../../../mobile/AGENTS.md): `useThemeColors()` / `useThemeStyles(makeStyles)`, y toda fábrica `makeStyles` en la columna 0. `npm run check:contrast` lo verifica.
- **Sin dependencias nuevas.** Ni `@gorhom/bottom-sheet`, ni `@react-native-picker/picker`, ni `ActionSheetIOS`.
- **Un `Modal` de RN no se apila sobre otro `Modal` de RN de forma fiable en iOS.** De ahí sale toda la arquitectura: el formulario es ruta nativa (`formSheet`) y por eso el `Sheet` de `Select` puede abrirse encima. Dentro de un `Sheet` ya abierto, `Select` usa `nested` y **no monta un segundo `Modal`**. Romper esta regla produce un sheet que simplemente no aparece, sin error.
- **Cero `Chip`.** No hay excepción de "son solo dos valores". Gastos/Ingresos y ARS/USD/USDT también son `Select`.
- **Nada de agregar filtros que hoy no existen.** Ni factura/cobro en Movimientos, ni `partial` en Te deben. El spec lo marca explícito.
- **No se toca** ningún contrato de API, query key, validación de submit, ni el alta inline de cliente/categoría.
- **Verificación de cada task:** `cd mobile && npx tsc --noEmit && npm run check:contrast`. Desde el spec 7, `tsc` valida las rutas tipadas contra `.expo/types/router.d.ts`, así que un `router.push` a una ruta inexistente **es un error de compilación**. Correr el dev server al menos una vez después de mover rutas para regenerar ese archivo, o `tsc` valida contra un mapa viejo.
- **Commits en inglés**, formato `tipo: mensaje`.
- **`.cursor/rules/push-after-task.mdc` aplica**: al terminar cada task, commitear y `git push -u origin HEAD`. Si el push falla, reportar y parar; nunca force-push.

## Orden de tasks

```
Task 1  Sheet gana `scroll` + maxHeight
   │
Task 2  Select — trigger + modo sheet
   │
Task 3  Select — modo nested
   │
Task 4  Ruta formSheet + stub renombrado + tabBarButton + call sites   ← C1 y C2
   │
   ├── Task 5   new-movement: 7 grupos → Select
   ├── Task 6   movements: 3 Select, se va FilterRow
   ├── Task 7   receivables + categories
   ├── Task 8   reports + movement/[id]
   └── Task 9   wallets + clients (nested)
          │
   Task 10  Borrar Chip + fila 8 del README   ← gate
          │
   Task 11  QA en iOS y Android
```

**Por qué este orden.** `Select` depende de que `Sheet` scrollee, así que la Task 1 va primero. Las Tasks 2 y 3 se separan porque el modo `nested` es una rama de comportamiento distinta y merece su propio gate de revisión. La Task 4 va antes que todos los reemplazos porque es la que tiene riesgo real —las dos correcciones de arriba viven ahí— y porque si el `formSheet` no funciona en Android hay que saberlo antes de escribir nueve pantallas contra él. Las Tasks 5–9 son independientes entre sí y podrían ir en cualquier orden; están ordenadas de más a menos riesgosa. La Task 10 borra `Chip`: si quedó un uso, ahí explota, y es a propósito.

**Punto de corte para revisar:** al terminar la Task 4 el `+` ya abre el modal y el formulario sigue funcionando con chips adentro. Es el momento de decidir si el `formSheet` convence antes de reescribir nueve pantallas.

---

### Task 1: `Sheet` scrollea y se limita al 90%

**Files:**
- Modify: `mobile/src/ui/Sheet.tsx`

**Interfaces:**
- Consumes: `useThemeStyles`, `Colors` del tema.
- Produces: `Sheet` con una prop nueva `scroll?: boolean`. La consumen las Tasks 2 y 3.

Una lista de 12 categorías dentro del `Sheet` actual se sale de la pantalla: el contenedor no tiene techo ni scroll.

- [ ] **Step 1: Agregar la prop y el techo de altura**

En `mobile/src/ui/Sheet.tsx`, el tipo:

```tsx
type Props = {
  visible: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Envuelve el cuerpo en un ScrollView. Para listas largas de opciones. */
  scroll?: boolean
}
```

El cuerpo, reemplazando el bloque que hoy renderiza `{children}` directo:

```tsx
export function Sheet({ visible, title, onClose, children, scroll }: Props) {
  const styles = useThemeStyles(makeStyles)
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} accessibilityLabel="Cerrar" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Txt variant="heading" style={styles.title}>
              {title}
            </Txt>
            {scroll ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
              >
                {children}
              </ScrollView>
            ) : (
              children
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}
```

Agregar `ScrollView` al import de `react-native`.

En la fábrica de estilos, `sheet` gana el techo y aparece una clave nueva:

```tsx
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.borderStrong,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.xxxl,
      gap: spacing.lg,
      // Sin techo, una lista de 12 categorías se sale de la pantalla.
      maxHeight: '90%',
    },
    scrollContent: { paddingBottom: spacing.sm },
```

- [ ] **Step 2: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 3: Verificar que no hay regresión**

`scroll` es opcional y los tres usos actuales (`wallets`, `clients`, `categories`) no la pasan, así que su comportamiento es idéntico. Abrir el alta de billetera y confirmar que el sheet se ve igual y sigue cerrando al tocar fuera.

- [ ] **Step 4: Commit y push**

```bash
git add mobile/src/ui/Sheet.tsx
git commit -m "feat(mobile): let Sheet scroll and cap its height"
git push -u origin HEAD
```

---

### Task 2: `Select` — trigger y modo sheet

**Files:**
- Create: `mobile/src/ui/Select.tsx`
- Modify: `mobile/src/ui/index.ts`

**Interfaces:**
- Consumes: `Sheet` con `scroll` de Task 1; `LinkButton` de `./Button`; `Txt` de `./Text`.
- Produces:
  - `type SelectOption<T extends string> = { value: T; label: string; meta?: string }`
  - `<Select<T> label value options onChange placeholder? footerAction? nested? error? />`

El modo `nested` se escribe en la Task 3; acá el prop existe en el tipo pero todavía no ramifica.

- [ ] **Step 1: Escribir el componente**

Crear `mobile/src/ui/Select.tsx`:

```tsx
import { radius, spacing, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
import Feather from '@expo/vector-icons/Feather'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { LinkButton } from './Button'
import { Sheet } from './Sheet'
import { Txt } from './Text'

export type SelectOption<T extends string> = {
  value: T
  label: string
  /** Línea secundaria opcional (ej. "USD · Mercado Pago"). */
  meta?: string
}

type Props<T extends string> = {
  label: string
  value: T | null
  options: SelectOption<T>[]
  onChange: (value: T) => void
  /** Qué se muestra sin valor elegido. */
  placeholder?: string
  /** Acción extra al pie de la lista (ej. "Nueva categoría"). */
  footerAction?: { label: string; onPress: () => void }
  /**
   * Dentro de un Sheet ya abierto. Despliega las opciones en línea en vez de
   * montar un segundo Modal: React Native no apila Modal de forma fiable y en
   * iOS el segundo directamente no aparece.
   */
  nested?: boolean
  error?: string
}

/**
 * El control de elección de la app. Trigger con anatomía de Field —rótulo
 * arriba, valor adentro, chevron a la derecha— y lista vertical.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Elegí…',
  footerAction,
  nested,
  error,
}: Props<T>) {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  const [open, setOpen] = useState(false)

  const selected = options.find((o) => o.value === value) ?? null
  const shown = selected?.label ?? placeholder

  function choose(next: T) {
    onChange(next)
    setOpen(false)
  }

  const list = (
    <View>
      {options.map((option, index) => (
        <Pressable
          key={option.value}
          onPress={() => choose(option.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: option.value === value }}
          style={({ pressed }) => [
            styles.option,
            index > 0 && styles.optionDivider,
            pressed && styles.optionPressed,
          ]}
        >
          <View style={styles.optionText}>
            <Txt variant="bodyMedium" numberOfLines={1}>
              {option.label}
            </Txt>
            {option.meta ? (
              <Txt variant="caption" tone="faint" numberOfLines={1} style={styles.optionMeta}>
                {option.meta}
              </Txt>
            ) : null}
          </View>
          {option.value === value ? <Feather name="check" size={18} color={c.brand} /> : null}
        </Pressable>
      ))}

      {footerAction ? (
        <View style={styles.footer}>
          <LinkButton
            label={footerAction.label}
            onPress={() => {
              // El alta inline se abre en el formulario padre, no acá adentro.
              setOpen(false)
              footerAction.onPress()
            }}
          />
        </View>
      ) : null}
    </View>
  )

  return (
    <View style={styles.container}>
      <Txt variant="label" tone="faint">
        {label}
      </Txt>

      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="combobox"
        accessibilityLabel={label}
        accessibilityValue={{ text: shown }}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.trigger,
          error ? styles.triggerError : null,
          pressed && styles.triggerPressed,
        ]}
      >
        <Txt
          variant="body"
          tone={selected ? 'ink' : 'faint'}
          numberOfLines={1}
          style={styles.triggerLabel}
        >
          {shown}
        </Txt>
        <Feather name="chevron-down" size={18} color={c.faint} />
      </Pressable>

      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : null}

      <Sheet visible={open} title={label} onClose={() => setOpen(false)} scroll>
        {list}
      </Sheet>
    </View>
  )
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    container: { gap: spacing.sm },
    // Misma anatomía que Field: 48px, hundido, radio md.
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      backgroundColor: c.surfaceSunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      minHeight: 48,
    },
    triggerPressed: { backgroundColor: c.surfaceRaised },
    triggerError: { borderColor: c.danger },
    triggerLabel: { flex: 1 },

    // Filas de 52px, sin borde por fila: la caja ya la pone el Sheet.
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: spacing.md,
      minHeight: 52,
    },
    optionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    optionPressed: { backgroundColor: c.surfaceRaised },
    optionText: { flex: 1 },
    optionMeta: { marginTop: 2 },

    footer: {
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
  })
```

- [ ] **Step 2: Exportar**

En `mobile/src/ui/index.ts`, en orden alfabético (queda entre `Screen` y `Sheet`):

```ts
export { Select, type SelectOption } from './Select'
```

- [ ] **Step 3: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan. `check:contrast` además confirma que `makeStyles` quedó en la columna 0.

- [ ] **Step 4: Probarlo de verdad antes de seguir**

`Select` es el componente del que dependen siete pantallas: vale gastar cinco minutos en verlo funcionar antes de propagarlo. Agregar temporalmente al final de la `Section` "Tus datos" de `app/(tabs)/settings.tsx`:

```tsx
        <Select
          label="Probando"
          value={null}
          options={[
            { value: 'a', label: 'Opción A', meta: 'con meta' },
            { value: 'b', label: 'Opción B' },
            { value: 'c', label: 'Opción C' },
          ]}
          onChange={() => {}}
          footerAction={{ label: 'Acción al pie', onPress: () => {} }}
        />
```

Verificar en la app: el trigger se ve como un `Field`, abre el sheet desde abajo, la opción elegida muestra el check, tocar una la elige y cierra, el backdrop cierra, y el `LinkButton` del pie está separado de la lista por una línea.

**Borrar el bloque temporal** antes de commitear.

- [ ] **Step 5: Commit y push**

```bash
git add mobile/src/ui/Select.tsx mobile/src/ui/index.ts
git commit -m "feat(mobile): add Select, the app's single choice control"
git push -u origin HEAD
```

---

### Task 3: `Select` — modo `nested`

**Files:**
- Modify: `mobile/src/ui/Select.tsx`

**Interfaces:**
- Consumes: lo de Task 2.
- Produces: `Select` con `nested` funcionando. Lo consume la Task 9.

Dentro de un `Sheet` ya abierto, montar otro `Modal` no funciona: en iOS el segundo no aparece y no hay error. `nested` despliega las mismas filas debajo del trigger.

- [ ] **Step 1: Ramificar el render**

Reemplazar el bloque final del JSX —el `<Sheet …>{list}</Sheet>`— por:

```tsx
      {nested ? (
        open ? <View style={styles.inlineList}>{list}</View> : null
      ) : (
        <Sheet visible={open} title={label} onClose={() => setOpen(false)} scroll>
          {list}
        </Sheet>
      )}
```

- [ ] **Step 2: El chevron acompaña el estado**

En modo `nested` el trigger es un acordeón, así que la flecha tiene que decir en qué estado está:

```tsx
        <Feather name={nested && open ? 'chevron-up' : 'chevron-down'} size={18} color={c.faint} />
```

- [ ] **Step 3: El estilo de la lista en línea**

En la fábrica:

```tsx
    // La lista desplegada dentro de un Sheet: caja hundida, no flotante.
    inlineList: {
      backgroundColor: c.surfaceSunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      // Un desplegable dentro de un sheet tampoco puede crecer sin límite.
      maxHeight: 240,
    },
```

`maxHeight` sin `ScrollView` recorta. Envolver la lista en línea:

```tsx
        open ? (
          <ScrollView
            style={styles.inlineList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {list}
          </ScrollView>
        ) : null
```

Agregar `ScrollView` al import de `react-native`. `nestedScrollEnabled` hace falta en Android: sin él, el scroll del `Sheet` padre se come el gesto.

- [ ] **Step 4: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 5: Probar el modo nested en un Sheet real**

Agregar temporalmente un `<Select nested … />` dentro del `Sheet` de alta de `app/wallets.tsx`, con tres opciones cualquiera. Verificar:

- El trigger abre las opciones **en línea**, sin otro sheet encima.
- El chevron pasa a `chevron-up` con la lista abierta.
- Un segundo toque en el trigger cierra.
- Elegir una opción cierra la lista.
- Con más opciones que las que entran, la lista scrollea sin arrastrar el sheet padre.

**Borrar el bloque temporal** antes de commitear. La Task 9 lo hace en serio.

- [ ] **Step 6: Commit y push**

```bash
git add mobile/src/ui/Select.tsx
git commit -m "feat(mobile): add nested mode to Select for use inside a Sheet"
git push -u origin HEAD
```

---

### Task 4: Ruta `formSheet`, stub renombrado y `tabBarButton`

**Files:**
- Create: `mobile/app/new-movement.tsx`
- Delete: `mobile/app/(tabs)/new-movement.tsx`
- Create: `mobile/app/(tabs)/new.tsx`
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx`
- Modify: `mobile/app/(tabs)/index.tsx`
- Modify: `mobile/app/(tabs)/movements.tsx`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: la ruta `/new-movement` presentada como form sheet. La consumen las Tasks 5 y 11.

La task con riesgo real del plan. Acá viven las dos correcciones al spec.

- [ ] **Step 1: Leer los docs antes de escribir**

Obligatorio: https://docs.expo.dev/router/advanced/modals/ y https://docs.expo.dev/versions/v57.0.0/. Confirmar la forma exacta de `sheetAllowedDetents`, `sheetGrabberVisible` y `sheetCornerRadius`, y las limitaciones declaradas de Android.

- [ ] **Step 2: Mover el formulario, tal cual**

```bash
cd mobile
git mv "app/(tabs)/new-movement.tsx" app/new-movement.tsx
```

**Sin tocar el contenido todavía.** Los chips siguen adentro; los reemplaza la Task 5. Separar el movimiento de archivo del cambio de contenido hace que el diff de esta task sea legible.

Dos puntos del spec (líneas 84 y 90) **ya están cumplidos en el código actual** — verificado antes de escribir este plan. No hay nada que hacer y no hay que "arreglarlos":

- El título va en el cuerpo, no en un header nativo: el archivo ya abre con `<Txt variant="title">Nuevo movimiento</Txt>`. Eso es justo lo que el spec pide, porque dentro de un `formSheet` Android no dibuja header nativo.
- El botón de guardar ya usa la prop `footer` de `Screen`, que es un `View` de React Native fijo al pie. **No** es `unstable_sheetFooter`, que es la API experimental que el spec descarta. Se queda como está. Lo único a verificar es que el teclado no lo tape dentro del form sheet, y eso es el criterio 10 en la Task 11.

Lo único que cambia dentro del archivo, al final de la mutación de create: donde hoy navega a Movimientos, ahora cierra el sheet.

```tsx
    onSuccess: async () => {
      // … las mismas invalidaciones de queries que ya hace, sin cambios …
      router.back()
    },
```

Buscar el `router.push('/(tabs)/movements')` o `router.replace(...)` que tenga hoy y reemplazarlo por `router.back()`. El usuario vuelve a donde estaba, no a otra tab.

- [ ] **Step 3: Crear el stub con nombre que NO colisione**

Esto es la corrección C2. `(tabs)/new-movement.tsx` produciría `/new-movement`, igual que el archivo del Step 2, y las dos rutas convivirían sin warning.

Crear `mobile/app/(tabs)/new.tsx`:

```tsx
/**
 * Stub. Existe sólo porque js-tabs necesita una pantalla registrada para
 * dibujar el ícono `+` en la tab bar. Nunca se renderiza: el tabBarButton de
 * (tabs)/_layout.tsx intercepta el toque y navega a /new-movement, que es la
 * ruta de verdad y se presenta como form sheet.
 *
 * El archivo se llama `new` y no `new-movement` a propósito: los segmentos de
 * grupo son transparentes en la URL, así que `(tabs)/new-movement` resolvería
 * al mismo href que `app/new-movement.tsx` y Expo Router elegiría uno de los
 * dos en silencio.
 */
export default function NewMovementTabStub() {
  return null
}
```

- [ ] **Step 4: Registrar la ruta como form sheet**

En `mobile/app/_layout.tsx`, dentro del `<Stack>` de `ThemedApp`, junto a las otras `Stack.Screen`:

```tsx
                <Stack.Screen
                  name="new-movement"
                  options={{
                    presentation: 'formSheet',
                    headerShown: false,
                    // Un solo detent al 94%: se ve que hay pantalla detrás.
                    // No usar 'fitToContents': el form tiene teclado y flex: 1.
                    sheetAllowedDetents: [0.94],
                    sheetGrabberVisible: true,
                    sheetCornerRadius: radius.xxl,
                  }}
                />
```

`radius` ya está disponible desde `@/src/theme`; si el archivo todavía no lo importa, agregarlo al import existente.

- [ ] **Step 5: El `+` de la tab bar — corrección C1**

En `mobile/app/(tabs)/_layout.tsx`. El spec proponía `listeners={{ tabPress }}`, que **no existe** en `Tabs.Screen`. Se usa `tabBarButton`, que sí está en las opciones.

La `Tabs.Screen` del medio pasa a apuntar al stub renombrado y a renderizar su propio botón:

```tsx
      <Tabs.Screen
        name="new"
        options={{
          title: 'Nuevo',
          tabBarButton: (props) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cargar movimiento"
              // Se ignora el onPress de la tab: esto no cambia de tab, navega.
              onPress={() => router.push('/new-movement')}
              style={styles.newButton}
            >
              {props.children}
            </Pressable>
          ),
          tabBarIcon: ({ focused }) => <NewMovementIcon focused={focused} />,
        }}
      />
```

`TabLayout` necesita `const router = useRouter()` y los imports de `Pressable` (de `react-native`) y `useRouter` (de `expo-router`).

En la fábrica de estilos:

```tsx
    // El botón ocupa su celda como cualquier tab, pero no selecciona nada.
    newButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
```

`NewMovementIcon` recibe `focused`, que ahora será siempre `false` porque la tab nunca se selecciona. **Dejar el prop igual**: la Task 11 confirma en dispositivo si el estilo `newIconFocused` quedó muerto, y recién ahí se decide si se borra. Borrarlo ahora sería adivinar.

- [ ] **Step 6: Actualizar los call sites**

Dos archivos hacen `router.push('/(tabs)/new-movement')`:

- `mobile/app/(tabs)/index.tsx` — el `onAction` del `EmptyState` de "Últimos movimientos" y el `onPress` del `Button` "Cargar movimiento" al pie.
- `mobile/app/(tabs)/movements.tsx` — el `onAction` del `EmptyState`.

Los tres pasan a `router.push('/new-movement')`.

```bash
cd mobile && grep -rn "(tabs)/new-movement" app src
```

Esperado después del cambio: sin resultados.

- [ ] **Step 7: Regenerar los tipos de ruta**

**Sin esto, `tsc` valida contra un mapa de rutas viejo** y no ve ni el error ni el acierto:

```bash
cd mobile && rm -rf .expo/types && npx expo start --port 8181
```

Esperar a que arranque, cortar con Ctrl+C.

- [ ] **Step 8: Verificar que la colisión no existe**

```bash
cd mobile && grep -o '`/new-movement`' .expo/types/router.d.ts | wc -l
```

Cada entrada de ruta aparece en tres bloques del archivo (`hrefInputParams`, `hrefOutputParams`, `href`), así que el número esperado es **el mismo que para cualquier otra ruta suelta**. Compararlo contra una ruta que se sabe única:

```bash
cd mobile && for r in new-movement receivables integrations; do
  echo "$r: $(grep -o "\`/$r\`" .expo/types/router.d.ts | wc -l)"
done
```

Los tres números tienen que ser **iguales**. Si `new-movement` da más alto que los otros dos, la colisión sigue viva: revisar que el Step 3 haya creado `new.tsx` y no `new-movement.tsx`.

Además, no puede quedar rastro de la ruta vieja:

```bash
cd mobile && grep -c "(tabs)'}/new-movement" .expo/types/router.d.ts
```

Esperado: `0`.

- [ ] **Step 9: Verificar tipos y build**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast && npx expo export --platform all --output-dir /tmp/f8-smoke && rm -rf /tmp/f8-smoke
```

Esperado: los tres pasan. Con los tipos regenerados, un `router.push` a la ruta vieja sería `TS2345`.

- [ ] **Step 10: Verificar en dispositivo — criterios 1, 2 y 3**

Criterio 1 — tocar el `+`: la tab activa **sigue siendo Inicio** (o la que estuviera), y el formulario entra desde abajo con grabber, dejando ver la pantalla de atrás. **Verificar en iOS y en Android**: `formSheet` tiene limitaciones declaradas en Android y es el punto donde este diseño puede fallar.

Criterio 2 — `router.push('/new-movement')` desde el CTA de Inicio y desde el empty de Movimientos abre el mismo sheet. Swipe hacia abajo lo cierra y vuelve a esa pantalla.

Criterio 3 — guardar un ingreso válido cierra el sheet, y la tab activa **no cambia sola**. El movimiento aparece al ir a Movimientos.

Criterio 10 — tocar el campo de monto: el teclado sube y el input **sigue visible**.

**Si el `formSheet` no funciona en Android, parar acá y reportar.** Es la premisa del spec; no tiene sentido escribir las Tasks 5–9 encima de algo que no se presenta.

- [ ] **Step 11: Commit y push**

```bash
git add mobile/app/new-movement.tsx "mobile/app/(tabs)/new.tsx" "mobile/app/(tabs)/_layout.tsx" mobile/app/_layout.tsx "mobile/app/(tabs)/index.tsx" "mobile/app/(tabs)/movements.tsx"
git commit -m "feat(mobile): present the new movement form as a route form sheet"
git push -u origin HEAD
```

---

### Task 5: `new-movement` — los siete grupos pasan a `Select`

**Files:**
- Modify: `mobile/app/new-movement.tsx`

**Interfaces:**
- Consumes: `Select`, `SelectOption` de Task 2; la ruta de Task 4.
- Produces: nada.

El archivo más grande del cambio. Tiene un helper local `Group` (línea 21 del original) que envuelve `ChipRow`: **desaparece entero**, porque `Select` ya trae su propio rótulo.

- [ ] **Step 1: Inventariar antes de tocar**

```bash
cd mobile && grep -n "Chip\|Group" app/new-movement.tsx
```

Esperado: el helper `Group`, y siete grupos — tipo, moneda de factura, billetera/desde, hacia, cliente, categoría, cotización. Anotarlos: al final tienen que ser cero.

- [ ] **Step 2: Imports y borrado del helper**

```tsx
import { Button, Field, Screen, Select, Txt, type SelectOption } from '@/src/ui'
```

Borrar el helper `Group` completo. Ya no lo usa nadie.

- [ ] **Step 3: Tipo de movimiento**

Reemplaza el `ChipRow` del tipo. Reusa el `typeOptions` que ya existe en el archivo, mapeándolo a la forma de `Select`:

```tsx
      <Select
        label="Tipo"
        value={type}
        options={typeOptions.map((o) => ({ value: o.id, label: o.label }))}
        onChange={(next) => selectType(next)}
      />
```

`selectType` ya existe (línea 181 del original) y resetea los campos dependientes: **no duplicar esa lógica**, llamarla.

- [ ] **Step 4: Los seis grupos restantes**

Misma transformación en cada uno. El JSX condicional que decide **cuál** grupo se muestra según el tipo **no cambia**: sólo cambia el control de adentro.

| Grupo | `label` | `value` | `options` | `onChange` |
|---|---|---|---|---|
| Moneda de factura | `"Moneda"` | `invoiceCurrency` | las monedas que ya lista el archivo | `setInvoiceCurrency` |
| Billetera / Desde | `type === 'transfer' ? 'Desde' : 'Billetera'` | `walletId` | `wallets.data`, `label: w.name`, `meta: w.currency` | `setWalletId` |
| Hacia | `"Hacia"` | `toWalletId` | ídem, excluyendo `walletId` como ya hace hoy | `setToWalletId` |
| Cliente | `type === 'invoice' ? 'Cliente' : 'Cliente (opcional)'` | `clientId` | `clients.data`, más la opción `"Sin cliente"` | `setClientId` |
| Categoría | `"Categoría"` | `categoryId` | `categories.data`, `label: c.name` | `setCategoryId` |
| Cotización | `"Cotización"` | `rateType` | `rates.data`, `label: \`${r.type} ${n}\`` | `setRateType` |

Dos detalles que no se pueden perder:

**La opción "Sin cliente"** hoy es un `Chip` aparte con `selected={clientId === null}`. `Select` tipa `value` como `T | null`, así que `null` no puede ser el `value` de una opción. Se modela con un centinela:

```tsx
        const SIN_CLIENTE = '__none__'

        <Select
          label={type === 'invoice' ? 'Cliente' : 'Cliente (opcional)'}
          value={clientId ?? SIN_CLIENTE}
          options={[
            { value: SIN_CLIENTE, label: 'Sin cliente' },
            ...(clients.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
          onChange={(next) => setClientId(next === SIN_CLIENTE ? null : next)}
          footerAction={{ label: 'Nuevo cliente', onPress: () => setShowNewClient(true) }}
        />
```

Para `invoice`, donde el cliente es obligatorio, **no incluir** la opción `SIN_CLIENTE` y pasar `value={clientId}` derecho, así el placeholder "Elegí…" empuja a elegir.

**"Nuevo cliente" y "Nueva categoría"** hoy son `Chip` con `selected={showNewClient}`. Pasan a `footerAction`, como arriba: el footer cierra el sheet de opciones y prende `showNewClient` / `showNewCategory`. **El bloque de alta inline —el `Field` + botón "Agregar"— se queda exactamente donde está, en el formulario padre.** No se mete adentro del sheet de opciones.

- [ ] **Step 5: Verificar que no quedó ninguno**

```bash
cd mobile && grep -c "Chip" app/new-movement.tsx
```

Esperado: `0`.

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 6: Verificar el criterio 4**

Es un formulario con matriz condicional: hay que recorrer los cuatro tipos.

- [ ] **Ingreso**: billetera, cliente opcional, categoría, cotización si la moneda no es ARS.
- [ ] **Gasto**: billetera, categoría.
- [ ] **Transferencia**: "Desde" y "Hacia", y que "Hacia" no ofrezca la billetera ya elegida en "Desde".
- [ ] **Factura**: moneda, cliente **obligatorio**, vencimiento.
- [ ] Cambiar el tipo con campos ya cargados: los dependientes se resetean (lo hace `selectType`).
- [ ] "Nuevo cliente" desde el footer: cierra el sheet, aparece el alta inline en el formulario, crear uno lo deja elegido.
- [ ] Ídem "Nueva categoría".
- [ ] Guardar con el monto vacío: el error se ve.

- [ ] **Step 7: Commit y push**

```bash
git add mobile/app/new-movement.tsx
git commit -m "feat(mobile): replace every chip group in the movement form with Select"
git push -u origin HEAD
```

---

### Task 6: `movements` — tres selects, se va el acordeón

**Files:**
- Modify: `mobile/app/(tabs)/movements.tsx`

**Interfaces:**
- Consumes: `Select` de Task 2.
- Produces: nada.

Se eliminan el helper `FilterRow`, el `ScrollView` horizontal y el acordeón "Billetera y categoría". Quedan tres selects apilados, **siempre visibles**.

- [ ] **Step 1: Borrar lo que sobra**

- El helper `FilterRow`.
- El estado `showMoreFilters` y su `LinkButton`.
- `extraFilterCount`, si sólo servía para el rótulo del acordeón.
- Los `ScrollView` horizontales de chips.

`typeFilter`, `walletFilter` y `categoryFilter` **se quedan**: la query no cambia.

- [ ] **Step 2: Los tres selects**

```tsx
      <View style={styles.filters}>
        <Select
          label="Tipo"
          value={typeFilter}
          options={typeOptions.map((o) => ({ value: o.id, label: o.label }))}
          onChange={setTypeFilter}
        />
        <Select
          label="Billetera"
          value={walletFilter ?? TODAS}
          options={[
            { value: TODAS, label: 'Todas' },
            ...(wallets.data ?? []).map((w) => ({ value: w.id, label: w.name, meta: w.currency })),
          ]}
          onChange={(next) => setWalletFilter(next === TODAS ? null : next)}
        />
        <Select
          label="Categoría"
          value={categoryFilter ?? TODAS}
          options={[
            { value: TODAS, label: 'Todas' },
            ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
          onChange={(next) => setCategoryFilter(next === TODAS ? null : next)}
        />
      </View>
```

Con el centinela a nivel de módulo:

```tsx
/** `null` no puede ser el value de una opción: este centinela lo representa. */
const TODAS = '__all__'
```

`typeOptions` ya existe y ya incluye `all` con label "Todos" y `review` con "Para revisar". **No agregar factura ni cobro**: el spec lo prohíbe explícitamente.

- [ ] **Step 3: "Limpiar filtros"**

El `EmptyState` con filtros aplicados sigue reseteando los tres:

```tsx
                onAction={() => {
                  setTypeFilter('all')
                  setWalletFilter(null)
                  setCategoryFilter(null)
                }}
```

- [ ] **Step 4: Ajustar los estilos**

`filters` tenía `paddingBottom` y borde inferior pensados para chips. Ahora contiene tres selects apilados: agregarle `gap: spacing.md` y `paddingHorizontal: screenPadding`, que antes ponía cada `FilterRow`. Borrar de la fábrica las claves que quedaron sin uso (`filterRow`, `filterLabel`, `chips`, `moreRow`).

- [ ] **Step 5: Verificar**

```bash
cd mobile && grep -c "Chip" "app/(tabs)/movements.tsx"
```

Esperado: `0`.

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 6: Verificar el criterio 5**

- [ ] No hay chips ni scroll horizontal. Los tres selects se ven sin desplegar nada.
- [ ] Filtrar por tipo `Gastos`: la lista responde.
- [ ] Combinar tipo + billetera + categoría: la query manda los tres parámetros.
- [ ] `Para revisar` sigue mandando `needsReview=true`.
- [ ] Con una combinación sin resultados, "Limpiar filtros" vuelve los tres a "todas/todos".
- [ ] El contador de registros del header sigue bien.

- [ ] **Step 7: Commit y push**

```bash
git add "mobile/app/(tabs)/movements.tsx"
git commit -m "feat(mobile): replace the movements filter chips with three selects"
git push -u origin HEAD
```

---

### Task 7: `receivables` y `categories`

**Files:**
- Modify: `mobile/app/receivables.tsx`
- Modify: `mobile/app/categories.tsx`

**Interfaces:**
- Consumes: `Select` de Task 2.
- Produces: nada.

Un select por pantalla. Los dos son `ChipRow` sueltos, fuera de cualquier `Sheet`, así que van en modo normal.

- [ ] **Step 1: `receivables.tsx` — estado**

```tsx
        <Select
          label="Estado"
          value={filter}
          options={filterOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
          onChange={setFilter}
        />
```

Esos son los valores reales: el archivo ya tiene `filterOptions` a nivel de módulo (línea 21) con exactamente `all`/`pending`/`overdue`/`paid` y esos labels. Conviene mapear ese array en vez de reescribirlo a mano:

```tsx
          options={filterOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
```

El estado se llama `filter`, no `statusFilter`. **No agregar `partial`**: el spec lo prohíbe.

- [ ] **Step 2: `categories.tsx` — tipo**

```tsx
        <Select
          label="Tipo"
          value={kind}
          options={[
            { value: 'EXPENSE', label: 'Gastos' },
            { value: 'INCOME', label: 'Ingresos' },
          ]}
          onChange={setKind}
        />
```

Default `EXPENSE`, como hoy (`useState<Kind>('EXPENSE')`, línea 17). Los dos chips actuales están escritos inline en las líneas 109–110, no en un array: acá sí van los literales. Dos opciones **también** son un `Select`: el spec no admite la excepción de "son sólo dos".

- [ ] **Step 3: Verificar**

```bash
cd mobile && grep -c "Chip" app/receivables.tsx app/categories.tsx
```

Esperado: `0` en los dos.

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 4: Verificar en la app**

Inicio → "Te deben" → Ver detalle: cambiar el estado filtra la lista. Ajustes → Categorías: alternar Gastos/Ingresos cambia la lista, y el alta por `Sheet` sigue funcionando.

- [ ] **Step 5: Commit y push**

```bash
git add mobile/app/receivables.tsx mobile/app/categories.tsx
git commit -m "feat(mobile): use Select for the receivables and categories filters"
git push -u origin HEAD
```

---

### Task 8: `reports` y `movement/[id]`

**Files:**
- Modify: `mobile/app/(tabs)/reports.tsx`
- Modify: `mobile/app/movement/[id].tsx`

**Interfaces:**
- Consumes: `Select` de Task 2.
- Produces: nada.

Tres selects. El de Reportes reemplaza los chips A–K de monotributo; **el selector de mes con flechas no se toca**, no es un grupo de chips.

- [ ] **Step 1: `reports.tsx` — categoría de monotributo**

```tsx
                <Select
                  label="Tu categoría"
                  value={alert.data.category ?? null}
                  options={alert.data.scales.map((scale) => ({
                    value: scale.category,
                    label: scale.category,
                  }))}
                  onChange={(next) => setCategory.mutate(next)}
                />
```

El hint de abajo ("La cuota de la categoría elegida es la que se descuenta arriba") **se queda**. El rótulo `Txt variant="label"` que hoy dice "Tu categoría" se borra: ahora lo pone el `Select`.

Si las escalas traen el límite anual, vale la pena mostrarlo como `meta` — es información que el usuario necesita justo al elegir. Verificar el tipo `MonotributoAlert` en `src/api/types.ts` antes de escribirlo; si el campo no está, dejarlo sin `meta` y no inventarlo.

- [ ] **Step 2: `movement/[id].tsx` — cliente y billetera de cobro**

Dos `ChipRow`. El de cliente necesita el mismo centinela que la Task 5, pero **este es otro archivo**: `SIN_CLIENTE` no cruza de `new-movement.tsx` para acá. Declararlo a nivel de módulo, arriba del componente:

```tsx
/** `null` no puede ser el value de una opción: este centinela lo representa. */
const SIN_CLIENTE = '__none__'
```

Y después:

```tsx
            <Select
              label="Cliente"
              value={clientId ?? SIN_CLIENTE}
              options={[
                { value: SIN_CLIENTE, label: 'Sin cliente' },
                ...(clients.data ?? []).map((client) => ({ value: client.id, label: client.name })),
              ]}
              onChange={(next) => setClientId(next === SIN_CLIENTE ? null : next)}
            />
```

**Cuidado con el nombre:** este archivo usa `c` como parámetro de dos `.map()` y `theme` para la paleta (por el spec 7). En el `.map` de arriba el parámetro se llama `client`, no `c`, para no sumar otra sombra.

El segundo select es "Cobrar en", sobre las billeteras.

- [ ] **Step 3: Verificar**

```bash
cd mobile && grep -c "Chip" "app/(tabs)/reports.tsx" "app/movement/[id].tsx"
```

Esperado: `0` en los dos.

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 4: Verificar en la app**

Reportes: elegir una categoría recalcula "Te queda libre" y la barra del techo. Las flechas del mes siguen funcionando. Detalle de un movimiento: cambiar el cliente lo guarda; en una factura, "Cobrar en" ofrece las billeteras y el cobro se registra.

- [ ] **Step 5: Commit y push**

```bash
git add "mobile/app/(tabs)/reports.tsx" "mobile/app/movement/[id].tsx"
git commit -m "feat(mobile): use Select for the monotributo category and movement detail"
git push -u origin HEAD
```

---

### Task 9: `wallets` y `clients` — el modo `nested` en serio

**Files:**
- Modify: `mobile/app/wallets.tsx`
- Modify: `mobile/app/clients.tsx`

**Interfaces:**
- Consumes: `Select` con `nested` de Task 3.
- Produces: nada.

Los dos chips viven **dentro del `Sheet` de alta**. Es el único lugar donde `nested` es obligatorio: sin él se intentaría montar un `Modal` sobre otro `Modal` y en iOS el sheet de opciones no aparece, sin error.

- [ ] **Step 1: `wallets.tsx` — moneda**

Dentro del `<Sheet>` de alta, reemplazar el `ChipRow` de monedas:

```tsx
        <Select
          nested
          label="Moneda"
          value={currency}
          options={[
            { value: 'ARS', label: 'ARS' },
            { value: 'USD', label: 'USD' },
            { value: 'USDT', label: 'USDT' },
          ]}
          onChange={setCurrency}
        />
```

Las monedas están hoy inline en la línea 157 como `['ARS', 'USD', 'USDT']`, así que esos son los valores reales.

Efecto lateral bueno: ese `.map((c) => …)` hoy **sombrea** la paleta, porque el archivo también tiene `const c = useThemeColors()` desde el spec 7. Al reemplazar el `ChipRow` por un `Select` el map desaparece y con él la sombra.

- [ ] **Step 2: `clients.tsx` — moneda por defecto**

Mismo patrón, con el `label` que ya use el archivo para ese campo.

- [ ] **Step 3: Verificar**

```bash
cd mobile && grep -c "Chip" app/wallets.tsx app/clients.tsx
```

Esperado: `0` en los dos.

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 4: Verificar el criterio 6 — la parte que puede fallar en silencio**

Ajustes → Billeteras → "Nueva billetera":

- [ ] El select de moneda despliega las opciones **en línea, dentro del mismo sheet**. Si no aparece nada al tocarlo, falta el `nested`.
- [ ] Elegir una moneda la deja seleccionada y colapsa la lista.
- [ ] El campo de nombre sigue recibiendo el teclado y el sheet no se cierra al tocar la lista.
- [ ] Guardar crea la billetera con la moneda elegida.

Repetir en Clientes. **Probar en iOS**: es la plataforma donde el `Modal` sobre `Modal` falla sin dar error.

- [ ] **Step 5: Commit y push**

```bash
git add mobile/app/wallets.tsx mobile/app/clients.tsx
git commit -m "feat(mobile): use nested Select for currency inside the create sheets"
git push -u origin HEAD
```

---

### Task 10: Borrar `Chip`

**Files:**
- Delete: `mobile/src/ui/Chip.tsx`
- Modify: `mobile/src/ui/index.ts`
- Modify: `docs/superpowers/specs/README.md`

**Interfaces:**
- Consumes: nada.
- Produces: la ausencia de `Chip`. Es el gate que prueba que el reemplazo terminó.

- [ ] **Step 1: Confirmar que no queda ningún uso**

```bash
cd mobile && grep -rn "Chip" app src
```

Esperado: **cero líneas**, salvo el propio `Chip.tsx` y su export. Si aparece alguna, migrar esa pantalla antes de seguir: el error de compilación también la encontraría, pero el grep es más barato.

- [ ] **Step 2: Borrar**

```bash
cd mobile && git rm src/ui/Chip.tsx
```

Y sacar la línea de `mobile/src/ui/index.ts`:

```ts
export { Chip, ChipRow } from './Chip'
```

- [ ] **Step 3: Verificar el criterio 8**

```bash
cd mobile && grep -rn "<Chip\|ChipRow" . --include=*.tsx --include=*.ts | grep -v node_modules
```

Esperado: sin salida.

```bash
cd mobile && ls src/ui/Chip.tsx
```

Esperado: `No such file or directory`.

- [ ] **Step 4: Verificar los criterios 9 y el build**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast && npx expo export --platform all --output-dir /tmp/f8-final && rm -rf /tmp/f8-final
```

Esperado: los tres pasan. Si `tsc` falla con `has no exported member 'Chip'`, quedó un archivo sin migrar: el error dice cuál.

- [ ] **Step 5: Registrar el spec en el índice**

`docs/superpowers/specs/README.md` no tiene la fila del spec 8. Agregarla debajo de la del 7:

```markdown
| 8 | [Modal de nuevo movimiento y selects](08-modal-movimiento-y-selects.md) | M | Aprobado, sin implementar |
```

Si al llegar acá el spec ya está implementado, poner el estado que corresponda en vez de copiar el de los demás.

- [ ] **Step 6: Commit y push**

```bash
git add mobile/src/ui/index.ts docs/superpowers/specs/README.md
git commit -m "refactor(mobile): delete Chip now that Select replaced every use"
git push -u origin HEAD
```

---

### Task 11: QA en iOS y Android

**Files:**
- Modify: `docs/superpowers/specs/08-modal-movimiento-y-selects.md` (sólo si el Step 5 de la Task 4 dejó deuda de Android)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la evidencia para el PR.

La única task sin código. Este spec cambia **cómo se navega**, así que el riesgo está en el comportamiento, no en los tipos.

- [ ] **Step 1: Verificación automática**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
cd mobile && grep -rn "<Chip\|ChipRow" app src
```

Esperado: los dos comandos pasan, el grep no devuelve nada. El CI (`.github/workflows/ci.yml`) corre esto más el bundle en cada PR.

- [ ] **Step 2: El recorrido del `+`, en las dos plataformas**

Es el criterio 1 y el que más riesgo tiene. **Simulador iOS y emulador Android, los dos.**

- [ ] Tocar el `+` desde Inicio: la tab activa sigue siendo Inicio.
- [ ] El sheet entra desde abajo, con grabber, dejando ver la pantalla de atrás.
- [ ] Swipe hacia abajo lo cierra y vuelve a Inicio.
- [ ] Tocar el `+` desde Movimientos: vuelve a Movimientos al cerrar.
- [ ] El back de Android cierra el sheet, no la app.
- [ ] Guardar cierra el sheet y **no** cambia la tab activa.

- [ ] **Step 3: Un select por pantalla — criterio 6**

- [ ] `new-movement` (los siete)
- [ ] `movements` (tres)
- [ ] `receivables`
- [ ] `categories`
- [ ] `reports`
- [ ] `movement/[id]` (dos)
- [ ] `wallets` (nested)
- [ ] `clients` (nested)

- [ ] **Step 4: Lista larga — criterio 7**

Con el usuario demo (`npm run db:seed:demo` en `backend/`), que tiene categorías de sobra:

- [ ] Abrir el `Select` de categoría con ≥8 opciones: la lista scrollea dentro del sheet.
- [ ] El sheet no pasa del 90% de la pantalla.
- [ ] El backdrop cierra sin elegir nada, y el valor previo se conserva.

- [ ] **Step 5: Teclado — criterio 10**

- [ ] En el form sheet, tocar el monto: el teclado sube y el input sigue visible.
- [ ] Con el teclado abierto, abrir un `Select`: el sheet de opciones aparece por encima.
- [ ] En el `Sheet` de nueva billetera, con el teclado abierto en el nombre, abrir el select `nested`: la lista se despliega y el sheet no se cierra.

- [ ] **Step 6: Regresión de lo que no debía cambiar**

- [ ] Alta de billetera, cliente y categoría por `Sheet`.
- [ ] Las cinco tabs siguen ahí, con el `+` marcado en el medio.
- [ ] Los dos temas: claro y oscuro, en `Select`, en el form sheet y en la lista de opciones. Es lo que agregó el spec 7 y este spec no puede romperlo.
- [ ] Login y cierre de sesión.

- [ ] **Step 7: Capturas para el PR**

El form sheet abierto, un `Select` desplegado, y los filtros de Movimientos — en iOS y Android. Seis capturas.

- [ ] **Step 8: Cerrar la deuda de Android si quedó**

Si el `formSheet` mostró limitaciones en Android en la Task 4, anotarlas en la sección "Fuera de alcance" del spec, con qué se verificó y en qué versión. Si funcionó bien, no tocar el spec y dejar constancia en el PR.

- [ ] **Step 9: Commit y push**

```bash
git add docs/superpowers/specs/08-modal-movimiento-y-selects.md
git commit -m "docs: record the android form sheet findings in spec 8"
git push -u origin HEAD
```

Si no hubo cambios en el spec, saltear el commit.

---

## Cobertura del spec

| Requisito del spec | Task |
|---|---|
| D1 — el alta es una ruta `formSheet` | 4 |
| D2 — `Select` con trigger tipo `Field` | 2 |
| D3 — `nested` sin segundo `Modal` | 3, 9 |
| D4 — `Chip` se borra | 10 |
| D5 — el `+` se queda y no cambia de tab | 4 — **vía `tabBarButton`, no `listeners`; ver corrección C1** |
| D6 — después de guardar, `router.back()` | 4 |
| `Sheet` gana `scroll` y `maxHeight: '90%'` | 1 |
| Contenido del form sheet, en orden | 4, 5 |
| Stub de la tab | 4 — **renombrado a `new.tsx`; ver corrección C2** |
| Call sites `router.push('/new-movement')` | 4 |
| `footerAction` para "Nuevo cliente" / "Nueva categoría" | 2, 5 |
| Movimientos: 3 selects, sin `FilterRow` ni acordeón | 6 |
| Te deben, Categorías | 7 |
| Reportes, Detalle | 8 |
| Billeteras, Clientes (nested) | 9 |
| Fila 8 del README de specs | 10 |
| Criterios de aceptación 1–10 | 4, 5, 6, 9, 10, 11 |
| Título en el cuerpo del sheet (no header nativo) | 4 — **ya cumplido en el código actual**, no hay trabajo |
| Guardar al pie, sin `unstable_sheetFooter` | 4 — **ya cumplido**: usa la prop `footer` de `Screen`, que es RN puro |
| `Select` tematizado (`useThemeStyles`) | 2 — el spec 7 ya está mergeado, así que nace así |

## Rollback

Solo UI. Revertir el PR restaura la tab-formulario y los chips. No hay persistencia nueva, ni migración, ni cambio de contrato de API.

La única parte que no es un revert limpio es el movimiento de archivos de la Task 4: al revertir, `app/new-movement.tsx` vuelve a `app/(tabs)/new-movement.tsx` y `(tabs)/new.tsx` desaparece. Después de revertir hay que **regenerar los tipos de ruta** (`rm -rf mobile/.expo/types && npx expo start`), o `tsc` sigue validando contra el mapa nuevo y marca errores en rutas que volvieron a existir.
