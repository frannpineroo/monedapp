# Recalibración de color + tema claro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un ingreso y un gasto se distingan de un vistazo por color, y que el usuario pueda poner la app en claro, oscuro o automático desde Ajustes, con el cambio aplicándose al instante.

**Architecture:** El color deja de ser una constante de módulo y pasa a venir de un contexto de React. `StyleSheet.create` a nivel de módulo se convierte en una fábrica `makeStyles(c)` memoizada por tema, así cada fábrica se ejecuta como máximo dos veces en toda la vida de la app. Durante la migración, el barrel `src/theme/index.ts` exporta un `colors` de compatibilidad clavado al tema oscuro: eso mantiene los 25 archivos compilando mientras se migran de a uno, y **borrar ese export es el gate que prueba que la migración terminó**. La semántica de color (gasto en rojo, alerta en ámbar) se aplica al final, cuando ya hay un solo lugar donde tocarla.

**Tech Stack:** Expo SDK 57 · React Native 0.86 · React 19.2 · expo-router · TypeScript 6 (strict) · AsyncStorage · StyleSheet nativo. Sin dependencias nuevas.

**Spec:** [docs/superpowers/specs/07-color-y-tema-claro.md](../specs/07-color-y-tema-claro.md)

**Rama:** `codex/f7-color-y-tema-claro`, creada desde `main`. Ya existe.

**Depende de:** nada. No toca backend, ni schema, ni contratos de API. Es compatible con los specs 1–6 estén implementados o no.

**Conflicto conocido:** el [spec 8](../specs/08-modal-movimiento-y-selects.md) toca `(tabs)/new-movement.tsx` y `src/ui/Sheet.tsx`, que este plan también migra (Tasks 6 y 12). Si los dos avanzan en paralelo, el que mergee segundo resuelve el conflicto a mano. Mergear este primero es más barato: deja `new-movement.tsx` ya migrado y el spec 8 escribe encima con el patrón nuevo.

## Global Constraints

- **Leer los docs versionados de Expo SDK 57 antes de escribir código de app**: https://docs.expo.dev/versions/v57.0.0/. Lo pide [mobile/AGENTS.md](../../../mobile/AGENTS.md) y aplica a `useColorScheme`, `expo-splash-screen` y `expo-status-bar`.
- **Sin dependencias nuevas.** Ni ESLint, ni runner de tests, ni librería de color. Todo lo que hace falta está en Node y en React Native.
- **`makeStyles` siempre en la columna 0.** Una fábrica declarada dentro de un componente es una identidad nueva por render y hace crecer el `WeakMap` de caché sin límite. Se verifica en Task 1.
- **En React Native las fuentes propias no sintetizan peso.** Nunca usar `fontWeight` junto a las familias `Archivo_*`. Esta regla ya está en el código y no cambia.
- **Nada de `fontWeight`, `elevation` ni sombras nuevas.** Este plan cambia color, y solo color. No se toca tipografía, espaciado, radios, iconografía ni layout.
- **Los dos temas exponen exactamente los mismos tokens.** El tipo `Colors` lo garantiza en compilación y el script de contraste lo verifica en runtime.
- **Regla de forma, normativa:** `expense` (rojo) aparece solo como color de **texto de montos** y como relleno de las barras de categoría de Inicio. `danger` (rojo) aparece solo como **relleno, borde o regla de margen**, con una única excepción de texto: el monto rotulado "Excedido" en Reportes. "Vencido" va en `attention` (ámbar), nunca en `danger`.
- **El color nunca es el único portador del signo.** Todo monto de ingreso o gasto lleva `+` o `-` explícito. Es la mitigación de daltonismo y no es negociable.
- **Verificación de cada task de app:** `cd mobile && npx tsc --noEmit`. La app no tiene suite de tests y este plan no introduce una (fuera de alcance del spec). Lo único con test automático real es el script de contraste, en Task 1.
- **Commits en inglés**, formato `tipo: mensaje` (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`), como todo el historial.
- **`.cursor/rules/push-after-task.mdc` aplica**: al terminar cada task, commitear y `git push -u origin HEAD` sin esperar que lo pidan. Si el push falla, reportar y parar; nunca force-push.

## Orden de tasks

```
Task 1  Paleta + script de contraste  (único con TDD real)
   │
Task 2  ThemeProvider + hooks + barrel con `colors` de compatibilidad
   │      A partir de acá la app ya se ve con el oscuro recalibrado.
   ├── Task 3  Text.tsx        (Tone: +expense, −warning) ── bloquea a todos los consumidores
   │      │
   │      ├── Task 4  ThemedRefreshControl + Screen
   │      ├── Task 5  Card, ListRow, Chip, Sheet, Wordmark
   │      ├── Task 6  Button, Field
   │      └── Task 7  Section (BadgeTone)
   │             │
   │             ├── Task 8   (tabs)/_layout
   │             ├── Task 9   (tabs)/index
   │             ├── Task 10  (tabs)/movements + (tabs)/settings
   │             ├── Task 11  (tabs)/reports
   │             ├── Task 12  (tabs)/new-movement
   │             ├── Task 13  wallets, receivables, categories, clients, (auth)/_layout
   │             └── Task 14  integrations, onboarding, movement/[id]
   │                    │
   │             Task 15  app/_layout raíz: navTheme, StatusBar, gate de carga
   │                    │
   │             Task 16  Plataforma: app.json, +html.tsx, splash
   │                    │
   │             Task 17  Borrar el `colors` de compatibilidad  ← gate de migración
   │                    │
   │             ├── Task 18  Semántica: toneForType en Inicio, Movimientos, detalle
   │             └── Task 19  Semántica: Reportes
   │                    │
   │             Task 20  Ajustes: sección Apariencia
   │                    │
   │             Task 21  QA de las 15 rutas en ambos temas
```

**Por qué este orden.** Task 1 fija los valores y su verificación antes de que nadie los consuma. Task 2 monta el provider y deja el `colors` de compatibilidad, que es lo que permite migrar de a un archivo sin romper la app en ningún commit intermedio. Task 3 va sola y primero porque cambia el tipo `Tone`, que consumen todos los demás. Tasks 4–14 son mecánicas e independientes entre sí. Task 15 y 16 conectan el tema con la navegación y con la plataforma. Task 17 borra la compatibilidad: si algo quedó sin migrar, ahí explota, y es a propósito. Las Tasks 18–19 aplican la semántica de color al final, cuando ya hay un solo lugar donde tocarla; hacerlo antes obligaría a escribirla dos veces, una en cada forma del código. Task 20 va después porque el selector no sirve de nada hasta que 3–16 hagan que el cambio de tema se vea.

**Punto de corte para revisar:** al terminar Task 17 la app está completa en ambos temas pero **visualmente casi idéntica a hoy** (solo el oscuro recalibrado). Es un buen lugar para frenar y mirar antes de cambiar la semántica.

---

### Task 1: Paleta de los dos temas y script de contraste

**Files:**
- Create: `mobile/src/theme/palettes.ts`
- Create: `mobile/scripts/check-contrast.mjs`
- Modify: `mobile/package.json`

**Interfaces:**
- Consumes: nada.
- Produces: `type Colors` (21 claves), `darkColors: Colors`, `lightColors: Colors`, todos exportados desde `mobile/src/theme/palettes.ts`. El comando `npm run check:contrast` desde `mobile/`.

**Requiere Node ≥ 22.18 o ≥ 24** para que `--experimental-strip-types` pueda importar el `.ts` desde el `.mjs`. Verificado en Node 24.16.0.

- [ ] **Step 1: Escribir el script de verificación, que va a fallar porque no existe la paleta**

Crear `mobile/scripts/check-contrast.mjs`:

```js
/**
 * Verifica los umbrales de contraste del sistema de color y la regla de que
 * toda fábrica `makeStyles` viva en la columna 0.
 *
 * Correr con:  npm run check:contrast   (desde mobile/)
 * Sale con código 1 y lista cada violación si algo no cumple.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { darkColors, lightColors } from '../src/theme/palettes.ts'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

// ---------- utilidades de color ----------

function rgb(hexValue) {
  const h = hexValue.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`hex inválido: ${hexValue}`)
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

function channel(c) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function luminance(hexValue) {
  const [r, g, b] = rgb(hexValue)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Contraste WCAG 2.1 entre dos colores opacos. */
function ratio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Tono en grados, 0–359. */
function hue(hexValue) {
  const [r, g, b] = rgb(hexValue).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return Math.round((h * 60 + 360) % 360)
}

/** Separación angular más corta entre dos tonos. */
function hueGap(a, b) {
  const d = Math.abs(hue(a) - hue(b))
  return Math.min(d, 360 - d)
}

// ---------- reglas ----------

const failures = []

function expect(label, actual, min) {
  if (actual + 1e-9 < min) {
    failures.push(`${label}: ${actual.toFixed(2)} — mínimo ${min.toFixed(2)}`)
  }
}

/** Texto normal AA. `faint` es la única excepción documentada: 3.0. */
const TEXT_TOKENS = ['ink', 'muted', 'brand', 'positive', 'expense', 'attention']
const ACCENTS = ['brand', 'positive', 'expense', 'attention', 'danger']

function checkTheme(name, c) {
  for (const token of TEXT_TOKENS) {
    expect(`${name}.${token} sobre surface`, ratio(c[token], c.surface), 4.5)
    expect(`${name}.${token} sobre bg`, ratio(c[token], c.bg), 4.5)
  }

  expect(`${name}.faint sobre surface`, ratio(c.faint, c.surface), 3.0)
  expect(`${name}.faint sobre bg`, ratio(c.faint, c.bg), 3.0)

  // danger nunca es texto de cuerpo, salvo el monto rotulado "Excedido".
  expect(`${name}.danger sobre surface`, ratio(c.danger, c.surface), 4.5)

  for (const token of ACCENTS) {
    const tint = `${token}Soft`
    expect(`${name}.${token} sobre ${tint}`, ratio(c[token], c[tint]), 4.5)
    expect(`${name}.${token} no-texto sobre surface`, ratio(c[token], c.surface), 3.0)
  }

  expect(`${name}.onBrand sobre brand`, ratio(c.onBrand, c.brand), 4.5)

  // Los dos rojos del sistema se separan por forma, pero expense y attention
  // sí o sí tienen que verse distintos: es la corrección a D4 del spec.
  const gap = hueGap(c.expense, c.attention)
  if (gap < 20) {
    failures.push(`${name}: expense y attention a ${gap}° de tono — mínimo 20°`)
  }
}

function checkParity() {
  const d = Object.keys(darkColors).sort()
  const l = Object.keys(lightColors).sort()
  const soloDark = d.filter((k) => !l.includes(k))
  const soloLight = l.filter((k) => !d.includes(k))
  if (soloDark.length) failures.push(`tokens solo en dark: ${soloDark.join(', ')}`)
  if (soloLight.length) failures.push(`tokens solo en light: ${soloLight.join(', ')}`)
  if (d.length < 21) failures.push(`la paleta tiene ${d.length} tokens, se esperaban 21`)
}

/** Una fábrica indentada es una fábrica declarada dentro de una función. */
function checkMakeStylesAtColumnZero() {
  const bad = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(full)) continue
      const lines = readFileSync(full, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (/^\s+const make[A-Za-z]*Styles\s*=/.test(line)) {
          bad.push(`${relative(ROOT, full)}:${i + 1}`)
        }
      })
    }
  }
  walk(join(ROOT, 'app'))
  walk(join(ROOT, 'src'))
  for (const location of bad) {
    failures.push(`makeStyles indentado (declarado dentro de una función): ${location}`)
  }
}

// ---------- correr ----------

checkParity()
checkTheme('dark', darkColors)
checkTheme('light', lightColors)
checkMakeStylesAtColumnZero()

if (failures.length) {
  console.error(`\n✗ ${failures.length} violación(es):\n`)
  for (const f of failures) console.error(`  - ${f}`)
  console.error('')
  process.exit(1)
}

console.log('✓ contraste, paridad de tokens y makeStyles: todo en regla')
```

- [ ] **Step 2: Registrar el comando**

En `mobile/package.json`, dentro de `"scripts"`, agregar:

```json
    "check:contrast": "node --experimental-strip-types scripts/check-contrast.mjs"
```

- [ ] **Step 3: Correr el script y verificar que falla**

```bash
cd mobile && npm run check:contrast
```

Esperado: FALLA con `Cannot find module` apuntando a `../src/theme/palettes.ts`.

- [ ] **Step 4: Escribir la paleta**

Crear `mobile/src/theme/palettes.ts`:

```ts
/**
 * Sistema de color de MonedApp — "Grafito recalibrado".
 *
 * El grafito sigue siendo el lienzo. Lo que cambia es que el color ahora
 * codifica significado en vez de ser solo decoración apagada:
 *
 * - `brand` (azul pizarra) es acción y estado activo. Nunca alerta.
 * - `positive` (verde) es plata que entra: ingresos y cobros.
 * - `expense` (rojo) es plata que sale. Solo aparece como texto de monto y
 *   como relleno de las barras de categoría de Inicio.
 * - `attention` (ámbar) es lo que pide una acción antes de que salga mal:
 *   vencido, para revisar, 80–100% del techo de monotributo.
 * - `danger` (rojo) es lo que ya salió mal, o lo destructivo. Solo aparece
 *   como relleno, borde o regla de margen. Única excepción de texto: el
 *   monto rotulado "Excedido".
 *
 * `expense` y `danger` comparten tono a propósito: nunca comparten forma.
 * `attention` está a 27–33° de tono de los dos, que es lo que los hace
 * distinguibles. Los ratios están verificados por scripts/check-contrast.mjs.
 */

export type Colors = {
  bg: string
  surface: string
  surfaceSunken: string
  surfaceRaised: string
  border: string
  borderStrong: string
  ink: string
  muted: string
  faint: string
  brand: string
  brandPressed: string
  brandSoft: string
  onBrand: string
  positive: string
  positiveSoft: string
  expense: string
  expenseSoft: string
  attention: string
  attentionSoft: string
  danger: string
  dangerSoft: string
}

export const darkColors: Colors = {
  bg: '#141414',
  surface: '#1E1E1E',
  surfaceSunken: '#101010',
  surfaceRaised: '#282828',

  border: '#2E2E2E',
  borderStrong: '#3D3D3D',

  ink: '#EDEDEC',
  muted: '#A3A39F',
  faint: '#75756F',

  brand: '#7FA9C6',
  brandPressed: '#6E97B4',
  brandSoft: '#23313C',
  onBrand: '#0F1519',

  positive: '#63C98B',
  positiveSoft: '#1C2F23',

  expense: '#FF8A75',
  expenseSoft: '#38221D',

  attention: '#E8A33C',
  attentionSoft: '#332815',

  danger: '#EE7259',
  dangerSoft: '#3A231E',
}

export const lightColors: Colors = {
  bg: '#F6F6F4',
  surface: '#FFFFFF',
  surfaceSunken: '#EFEFEC',
  surfaceRaised: '#F2F2F0',

  border: '#E4E4E1',
  borderStrong: '#CFCFCB',

  ink: '#1C1C1B',
  muted: '#5C5C58',
  faint: '#787873',

  brand: '#2F6E92',
  brandPressed: '#27607F',
  brandSoft: '#E6EFF5',
  onBrand: '#FFFFFF',

  positive: '#137A4E',
  positiveSoft: '#E3F2E9',

  expense: '#B93A26',
  expenseSoft: '#FBEAE6',

  attention: '#7E5A0D',
  attentionSoft: '#F8F0DD',

  danger: '#9C2F12',
  dangerSoft: '#F9E7E2',
}
```

- [ ] **Step 5: Correr el script y verificar que pasa**

```bash
cd mobile && npm run check:contrast
```

Esperado: `✓ contraste, paridad de tokens y makeStyles: todo en regla`

Si alguna línea falla, **no ajustar el umbral**: ajustar el color hasta que cumpla. Los umbrales son el contrato.

- [ ] **Step 6: Verificar que la regla de `makeStyles` realmente detecta violaciones**

Un checker que nunca falló no está probado. Agregar temporalmente al final de `mobile/src/ui/Card.tsx`:

```ts
function tmp() {
  const makeTmpStyles = () => ({})
  return makeTmpStyles
}
```

```bash
cd mobile && npm run check:contrast
```

Esperado: FALLA con `makeStyles indentado (declarado dentro de una función): src/ui/Card.tsx:NN`.

Borrar el bloque temporal y volver a correr. Esperado: pasa.

- [ ] **Step 7: Commit y push**

```bash
git add mobile/src/theme/palettes.ts mobile/scripts/check-contrast.mjs mobile/package.json
git commit -m "feat(mobile): add dual color palette with contrast verification"
git push -u origin HEAD
```

---

### Task 2: ThemeProvider, hooks y barrel con `colors` de compatibilidad

**Files:**
- Create: `mobile/src/theme/tokens.ts`
- Create: `mobile/src/theme/ThemeProvider.tsx`
- Create: `mobile/src/theme/index.ts`
- Delete: `mobile/src/theme.ts`
- Modify: `mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `Colors`, `darkColors`, `lightColors` de Task 1.
- Produces:
  - `type ThemeName = 'dark' | 'light'`
  - `type ThemePreference = 'system' | 'dark' | 'light'`
  - `<ThemeProvider>` con prop `children`
  - `useTheme(): { name, colors, preference, setPreference, loading }`
  - `useThemeColors(): Colors`
  - `useThemeStyles<T>(factory: (c: Colors) => T): T`
  - `colors: Colors & { warning, warningSoft, attentionEdge }` — **export temporal**, se borra en Task 17
  - Re-exports de `spacing`, `radius`, `fonts`, `type`, `RULE_WIDTH`

- [ ] **Step 1: Mover los tokens que no dependen del tema**

`spacing`, `radius`, `fonts`, `type` y `RULE_WIDTH` no cambian con el tema. Se mueven tal cual.

```bash
cd mobile
mkdir -p src/theme
git mv src/theme.ts src/theme/tokens.ts
```

Ahora editar `src/theme/tokens.ts`: **borrar** los bloques `export const palette = {...}` y `export const colors = {...}` (los que hoy están en las líneas 16–90), y borrar el comentario de cabecera del archivo, que describe la paleta vieja. Lo que queda —`spacing`, `radius`, `fonts`, `tabular`, `type`, `RULE_WIDTH`— no se toca.

La cabecera nueva del archivo:

```ts
/**
 * Tokens de MonedApp que no dependen del tema: espaciado, radios, familias
 * tipográficas y escala de texto. El color vive en palettes.ts.
 */
```

- [ ] **Step 2: Escribir el provider y los hooks**

Crear `mobile/src/theme/ThemeProvider.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { darkColors, lightColors, type Colors } from './palettes'

export type ThemeName = 'dark' | 'light'
/** Lo que el usuario elige. `system` sigue el ajuste del teléfono. */
export type ThemePreference = 'system' | 'dark' | 'light'

const STORAGE_KEY = 'monedapp.theme'

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'dark' || value === 'light'
}

type ThemeValue = {
  /** El tema ya resuelto. Es lo que hay que mirar para pintar. */
  name: ThemeName
  colors: Colors
  preference: ThemePreference
  setPreference: (next: ThemePreference) => void
  /** Verdadero mientras se lee la preferencia del disco. */
  loading: boolean
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme()
  const [preference, setPreferenceState] = useState<ThemePreference>('system')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (alive && isPreference(stored)) setPreferenceState(stored)
      })
      .catch(() => {
        // Sin preferencia legible se usa 'system', que es el default.
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const setPreference = useCallback((next: ThemePreference) => {
    // El estado se actualiza en el mismo tick: el toggle no espera al disco.
    setPreferenceState(next)
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {})
  }, [])

  // Si el sistema no informa esquema, la app se ve como se veía siempre.
  const name: ThemeName = preference === 'system' ? (systemScheme ?? 'dark') : preference

  const value = useMemo<ThemeValue>(
    () => ({
      name,
      colors: name === 'dark' ? darkColors : lightColors,
      preference,
      setPreference,
      loading,
    }),
    [name, preference, setPreference, loading]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme() fuera de <ThemeProvider>')
  return value
}

export function useThemeColors(): Colors {
  return useTheme().colors
}

/**
 * Caché por (fábrica, tema). Cada `makeStyles` se ejecuta como máximo dos
 * veces en toda la vida de la app, una por tema — no una por componente.
 *
 * Depende de que las fábricas se declaren a nivel de módulo, así su
 * identidad es estable. Lo verifica scripts/check-contrast.mjs.
 */
const stylesCache = new WeakMap<object, Map<ThemeName, unknown>>()

export function useThemeStyles<T>(factory: (c: Colors) => T): T {
  const { name, colors } = useTheme()
  return useMemo(() => {
    let byTheme = stylesCache.get(factory)
    if (!byTheme) {
      byTheme = new Map()
      stylesCache.set(factory, byTheme)
    }
    if (!byTheme.has(name)) byTheme.set(name, factory(colors))
    return byTheme.get(name) as T
  }, [factory, name, colors])
}
```

- [ ] **Step 3: Escribir el barrel, con el `colors` de compatibilidad**

Crear `mobile/src/theme/index.ts`:

```ts
export { darkColors, lightColors, type Colors } from './palettes'
export { fonts, radius, spacing, type, RULE_WIDTH } from './tokens'
export {
  ThemeProvider,
  useTheme,
  useThemeColors,
  useThemeStyles,
  type ThemeName,
  type ThemePreference,
} from './ThemeProvider'

import { darkColors } from './palettes'

/**
 * TEMPORAL — se borra en la Task 17 del plan.
 *
 * Clavado al tema oscuro para que los archivos todavía sin migrar compilen
 * y la app siga andando durante la migración. Cuando ya no lo importe nadie,
 * este bloque se borra y su ausencia es la prueba de que la migración
 * terminó. No agregar usos nuevos.
 */
export const colors = {
  ...darkColors,
  /** Alias de la paleta vieja: `warning` se fusionó con `attention`. */
  warning: darkColors.attention,
  warningSoft: darkColors.attentionSoft,
  /** Alias de la paleta vieja: el borde de error ahora es `danger`. */
  attentionEdge: darkColors.danger,
}
```

- [ ] **Step 4: Montar el provider**

En `mobile/app/_layout.tsx`, cambiar el import del tema:

```tsx
import { colors, fonts, ThemeProvider as AppThemeProvider, type } from '@/src/theme'
```

Se le pone alias `AppThemeProvider` porque el archivo ya importa un `ThemeProvider` de `expo-router` para la navegación. Los dos conviven hasta la Task 15.

Envolver el árbol: `AppThemeProvider` va **por fuera** de todo, para que `useTheme()` esté disponible en cualquier punto.

```tsx
  return (
    <AppThemeProvider>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          {/* … el resto del árbol, sin cambios … */}
        </ThemeProvider>
      </SafeAreaProvider>
    </AppThemeProvider>
  )
```

Nada más de este archivo cambia todavía. `navTheme`, `stackHeader` y `StatusBar` siguen leyendo el `colors` de compatibilidad, y se migran en la Task 15.

- [ ] **Step 5: Verificar que compila y que la app arranca**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan, sin salida de error.

```bash
cd mobile && npm start
```

Abrir la app. **Cambio visual esperado y correcto:** el oscuro ahora es el recalibrado — fondo un punto más profundo (`#141414` contra `#171717`), texto un punto más claro, acentos más saturados. La estructura y el layout son idénticos. Si algo cambió de posición o de tamaño, es un bug: revisar Step 1, que solo debía borrar los dos bloques de color.

- [ ] **Step 6: Commit y push**

```bash
git add mobile/src/theme mobile/app/_layout.tsx
git rm --cached mobile/src/theme.ts 2>/dev/null || true
git commit -m "feat(mobile): add theme provider with runtime-swappable colors"
git push -u origin HEAD
```

---

### Task 3: `Text.tsx` — el tipo `Tone` gana `expense` y pierde `warning`

**Files:**
- Modify: `mobile/src/ui/Text.tsx`

**Interfaces:**
- Consumes: `useThemeColors` de Task 2.
- Produces: `type Tone = 'ink' | 'muted' | 'faint' | 'brand' | 'attention' | 'positive' | 'expense' | 'danger' | 'onBrand'`. `Txt` y `Label` con la misma firma pública que hoy.

Va sola y primero porque cambia un tipo que consumen todos los demás archivos. Verificado antes de escribir: **no hay ni un solo `tone="warning"` en el proyecto**, así que sacarlo no rompe nada.

- [ ] **Step 1: Reescribir el archivo**

Reemplazar el contenido completo de `mobile/src/ui/Text.tsx`:

```tsx
import { useThemeColors, type } from '@/src/theme'
import { Text as RNText, type TextProps, type TextStyle } from 'react-native'

export type TypeVariant = keyof typeof type
export type Tone =
  | 'ink'
  | 'muted'
  | 'faint'
  | 'brand'
  | 'attention'
  | 'positive'
  | 'expense'
  | 'danger'
  | 'onBrand'

export type TxtProps = TextProps & {
  variant?: TypeVariant
  tone?: Tone
  align?: TextStyle['textAlign']
}

/** Único punto de entrada de texto: garantiza familia, escala y tono del sistema. */
export function Txt({ variant = 'body', tone = 'ink', align, style, ...rest }: TxtProps) {
  const c = useThemeColors()
  const tones: Record<Tone, string> = {
    ink: c.ink,
    muted: c.muted,
    faint: c.faint,
    brand: c.brand,
    attention: c.attention,
    positive: c.positive,
    expense: c.expense,
    danger: c.danger,
    onBrand: c.onBrand,
  }
  return (
    <RNText
      {...rest}
      style={[type[variant], { color: tones[tone] }, align ? { textAlign: align } : null, style]}
    />
  )
}

/** Rótulo de sección en mayúsculas. */
export function Label({ tone = 'faint', style, ...rest }: Omit<TxtProps, 'variant'>) {
  return <Txt variant="label" tone={tone} style={style} {...rest} />
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd mobile && npx tsc --noEmit
```

Esperado: pasa. Si aparece un error de `tone="warning"` en algún archivo, ese archivo hay que corregirlo acá mismo cambiándolo a `tone="attention"` — la fusión de `warning` en `attention` es la decisión del spec.

- [ ] **Step 3: Verificar en la app**

```bash
cd mobile && npm start
```

Recorrer Inicio y Reportes. Todo el texto debe verse igual que en la Task 2. `Txt` ahora consume contexto, así que si el provider no estuviera montado tiraría `useTheme() fuera de <ThemeProvider>` en la primera pantalla; que no pase confirma que la Task 2 quedó bien.

- [ ] **Step 4: Commit y push**

```bash
git add mobile/src/ui/Text.tsx
git commit -m "refactor(mobile): read text tones from the theme context"
git push -u origin HEAD
```

---

### Task 4: `ThemedRefreshControl` y `Screen.tsx`

**Files:**
- Create: `mobile/src/ui/ThemedRefreshControl.tsx`
- Modify: `mobile/src/ui/Screen.tsx`
- Modify: `mobile/src/ui/index.ts`

**Interfaces:**
- Consumes: `useThemeColors`, `useThemeStyles` de Task 2.
- Produces: `<ThemedRefreshControl refreshing onRefresh />` — un `RefreshControl` ya pintado con los colores del tema. Lo consumen las Tasks 9, 10, 11 y 13.

El spec no nombra este componente. Se introduce igual porque **7 pantallas repiten las mismas 4 props de color** en su `RefreshControl` (`tintColor`, `colors`, `progressBackgroundColor`, y el `refreshing`): son 21 referencias a color que se migran una vez en lugar de siete. Sin él, cada una de esas pantallas necesitaría `useThemeColors()` solo para el refresh.

- [ ] **Step 1: Escribir el componente**

Crear `mobile/src/ui/ThemedRefreshControl.tsx`:

```tsx
import { useThemeColors } from '@/src/theme'
import { RefreshControl, type RefreshControlProps } from 'react-native'

/**
 * Las props se derivan de `RefreshControlProps` a propósito: así el elemento
 * que devuelve este componente es asignable a la prop `refreshControl` de
 * ScrollView y de FlatList, que la tipan como
 * `React.ReactElement<RefreshControlProps>`.
 */
type Props = Pick<RefreshControlProps, 'refreshing' | 'onRefresh'>

/**
 * El indicador de "deslizá para actualizar", ya pintado con el tema. Existe
 * porque siete pantallas repetían las mismas cuatro props de color.
 */
export function ThemedRefreshControl({ refreshing, onRefresh }: Props) {
  const c = useThemeColors()
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={c.muted}
      colors={[c.brand]}
      progressBackgroundColor={c.surface}
    />
  )
}
```

- [ ] **Step 2: Migrar `Screen.tsx`**

En `mobile/src/ui/Screen.tsx`, cambiar el import y convertir el `StyleSheet.create` en fábrica.

Import:

```tsx
import { spacing, useThemeStyles, type Colors } from '@/src/theme'
```

Dentro del componente, primera línea del cuerpo:

```tsx
export function Screen({ children, scroll, refreshControl, contentStyle, edges = ['top'], footer }: Props) {
  const styles = useThemeStyles(makeStyles)
```

Al final del archivo, reemplazar el bloque `const styles = StyleSheet.create({...})` por:

```tsx
const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    flex: { flex: 1 },
    content: {
      paddingHorizontal: screenPadding,
      paddingTop: spacing.sm,
      paddingBottom: spacing.huge,
    },
    footer: {
      paddingHorizontal: screenPadding,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.bg,
    },
  })
```

`export const screenPadding = spacing.xl` queda donde está: no depende del tema.

- [ ] **Step 3: Exportar el componente nuevo**

En `mobile/src/ui/index.ts`, agregar en orden alfabético:

```ts
export { ThemedRefreshControl } from './ThemedRefreshControl'
```

- [ ] **Step 4: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 5: Commit y push**

```bash
git add mobile/src/ui/ThemedRefreshControl.tsx mobile/src/ui/Screen.tsx mobile/src/ui/index.ts
git commit -m "refactor(mobile): theme Screen styles and extract ThemedRefreshControl"
git push -u origin HEAD
```

---

### Task 5: `Card`, `ListRow`, `Chip`, `Sheet`, `Wordmark`

**Files:**
- Modify: `mobile/src/ui/Card.tsx`
- Modify: `mobile/src/ui/ListRow.tsx`
- Modify: `mobile/src/ui/Chip.tsx`
- Modify: `mobile/src/ui/Sheet.tsx`
- Modify: `mobile/src/ui/Wordmark.tsx`

**Interfaces:**
- Consumes: `useThemeStyles`, `Colors` de Task 2.
- Produces: los mismos cinco componentes, firma pública sin cambios.

Cinco archivos, la misma transformación mecánica en cada uno. **Ninguno cambia de comportamiento**, solo de dónde saca el color.

El patrón, idéntico en los cinco:

1. En el import de `@/src/theme`, sacar `colors` y agregar `useThemeStyles` y `type Colors`.
2. Como primera línea del cuerpo del componente: `const styles = useThemeStyles(makeStyles)`.
3. Al final del archivo, `const styles = StyleSheet.create({ … })` pasa a `const makeStyles = (c: Colors) => StyleSheet.create({ … })`, con cada `colors.X` cambiado por `c.X`. La fábrica va en la **columna 0**.

- [ ] **Step 1: `Card.tsx`**

Import: `import { radius, spacing, useThemeStyles, type Colors } from '@/src/theme'`

En el cuerpo de `Card`, antes del `const content = (`:

```tsx
  const styles = useThemeStyles(makeStyles)
```

Fábrica:

```tsx
const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: 'hidden',
      flexDirection: 'row',
    },
    pressed: { backgroundColor: c.surfaceRaised },
    body: { flex: 1 },
    padding: { padding: spacing.lg },
    rule: { width: 3, backgroundColor: c.attention },
  })
```

- [ ] **Step 2: `ListRow.tsx`**

Import: `import { radius, spacing, useThemeStyles, type Colors } from '@/src/theme'`

En `ListRow`, antes del `const body = (`: `const styles = useThemeStyles(makeStyles)`.

`RowDivider` también usa `styles`, así que necesita su propia línea:

```tsx
export function RowDivider() {
  const styles = useThemeStyles(makeStyles)
  return <View style={styles.divider} />
}
```

Fábrica:

```tsx
const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: 'hidden',
      minHeight: 64,
    },
    pressed: { backgroundColor: c.surfaceRaised },
    rule: { width: 3, backgroundColor: c.attention },
    inner: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    text: { flex: 1 },
    meta: { marginTop: 2 },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
      marginLeft: spacing.lg,
    },
  })
```

- [ ] **Step 3: `Chip.tsx`**

Import: `import { radius, spacing, useThemeStyles, type Colors } from '@/src/theme'`

`Chip` y `ChipRow` usan `styles`: los dos necesitan `const styles = useThemeStyles(makeStyles)` como primera línea.

Fábrica:

```tsx
const makeStyles = (c: Colors) =>
  StyleSheet.create({
    chip: {
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      minHeight: 36,
      justifyContent: 'center',
    },
    // Seleccionado en tinte, no en relleno pleno: el relleno queda para las acciones.
    chipSelected: { backgroundColor: c.brandSoft, borderColor: c.brand },
    pressed: { backgroundColor: c.surfaceRaised },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  })
```

El comentario viejo decía "no en rojo pleno", que ya no aplica: el chip seleccionado nunca fue rojo. Se corrige como está arriba.

- [ ] **Step 4: `Sheet.tsx`**

Import: `import { radius, spacing, useThemeStyles, type Colors } from '@/src/theme'`

En `Sheet`, primera línea del cuerpo: `const styles = useThemeStyles(makeStyles)`.

Fábrica:

```tsx
const makeStyles = (c: Colors) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    dismissArea: { flex: 1 },
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
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: c.borderStrong,
      alignSelf: 'center',
      marginBottom: spacing.sm,
    },
    title: { marginBottom: spacing.xs },
  })
```

El `backdrop` queda en `rgba(0,0,0,0.6)` en los dos temas: es una sombra, no una superficie, y un velo negro funciona sobre claro y sobre oscuro.

- [ ] **Step 5: `Wordmark.tsx`**

Import: `import { radius, spacing, useThemeStyles, type Colors } from '@/src/theme'`

En `Wordmark`, primera línea del cuerpo: `const styles = useThemeStyles(makeStyles)`.

El comentario del componente dice "un sello rojo", pero el código usa `colors.brand`, que es azul pizarra. Corregirlo:

```tsx
/**
 * Marca de MonedApp: el nombre y un sello en color de marca. El sello es la
 * única pieza de color en la pantalla de entrada.
 */
```

Fábrica:

```tsx
const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
    seal: {
      width: 12,
      height: 12,
      borderRadius: radius.sm / 2,
      backgroundColor: c.brand,
      marginBottom: 8,
    },
    sealSmall: { width: 8, height: 8, marginBottom: 6 },
  })
```

- [ ] **Step 6: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan. `check:contrast` además confirma que las cinco fábricas quedaron en la columna 0.

- [ ] **Step 7: Commit y push**

```bash
git add mobile/src/ui/Card.tsx mobile/src/ui/ListRow.tsx mobile/src/ui/Chip.tsx mobile/src/ui/Sheet.tsx mobile/src/ui/Wordmark.tsx
git commit -m "refactor(mobile): theme Card, ListRow, Chip, Sheet and Wordmark"
git push -u origin HEAD
```

---

### Task 6: `Button` y `Field`

**Files:**
- Modify: `mobile/src/ui/Button.tsx`
- Modify: `mobile/src/ui/Field.tsx`

**Interfaces:**
- Consumes: `useThemeColors`, `useThemeStyles`, `Colors` de Task 2; `Tone` de Task 3.
- Produces: `Button`, `LinkButton`, `Field` con la firma pública sin cambios.

`Button` es el único primitivo con **tres** `StyleSheet.create` (`styles`, `pressedStyles`, `linkStyles`) y un color usado fuera de `StyleSheet` (el `ActivityIndicator`). Se fusionan los dos primeros en una fábrica; el tercero no tiene color y se queda como está.

- [ ] **Step 1: Reescribir `Button.tsx`**

Reemplazar el contenido completo de `mobile/src/ui/Button.tsx`:

```tsx
import { radius, spacing, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Txt, type Tone } from './Text'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'
export type ButtonSize = 'md' | 'lg'

type Props = {
  label: string
  onPress?: () => void
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  loading?: boolean
  /** Ocupa todo el ancho disponible. */
  block?: boolean
  style?: StyleProp<ViewStyle>
  left?: React.ReactNode
}

const labelTone: Record<ButtonVariant, Tone> = {
  primary: 'onBrand',
  secondary: 'ink',
  ghost: 'brand',
  destructive: 'danger',
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  block,
  style,
  left,
}: Props) {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  const inactive = disabled || loading

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        styles[variant],
        block && styles.block,
        pressed && !inactive && styles[`${variant}Pressed` as const],
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? c.onBrand : c.brand} />
      ) : (
        <View style={styles.inner}>
          {left}
          <Txt variant="button" tone={labelTone[variant]}>
            {label}
          </Txt>
        </View>
      )}
    </Pressable>
  )
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    base: {
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'transparent',
    },
    inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    md: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 44 },
    lg: { paddingVertical: spacing.lg, paddingHorizontal: spacing.xl, minHeight: 52 },
    block: { alignSelf: 'stretch' },
    disabled: { opacity: 0.45 },

    primary: { backgroundColor: c.brand },
    secondary: { backgroundColor: c.surface, borderColor: c.border },
    ghost: { backgroundColor: 'transparent' },
    destructive: { backgroundColor: 'transparent', borderColor: c.danger },

    primaryPressed: { backgroundColor: c.brandPressed },
    secondaryPressed: { backgroundColor: c.surfaceRaised },
    ghostPressed: { opacity: 0.6 },
    destructivePressed: { backgroundColor: c.dangerSoft },
  })

/** Texto pulsable para acciones secundarias en encabezados de sección. */
export function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
      {({ pressed }) => (
        <Txt variant="captionStrong" tone="brand" style={pressed ? linkStyles.pressed : undefined}>
          {label}
        </Txt>
      )}
    </Pressable>
  )
}

// Sin color: no depende del tema y se queda a nivel de módulo.
const linkStyles = StyleSheet.create({
  pressed: { opacity: 0.6 },
})
```

Nota sobre el cambio de forma: `pressedStyles[variant]` se convirtió en `styles[\`${variant}Pressed\`]` porque las dos hojas se fusionaron en una. El borde del botón destructivo pasa de `attentionEdge` (que ya no existe) a `danger`, y su presionado de `attentionSoft` a `dangerSoft`: un botón destructivo es lo que puede salir mal, no lo que pide una acción.

- [ ] **Step 2: Migrar `Field.tsx`**

Import:

```tsx
import { radius, spacing, type, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
```

Dentro del `forwardRef`, como primeras líneas del cuerpo:

```tsx
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
```

En el `<TextInput>`, cambiar las dos props de color:

```tsx
        placeholderTextColor={c.faint}
        selectionColor={c.brand}
```

Fábrica al final del archivo:

```tsx
const makeStyles = (c: Colors) =>
  StyleSheet.create({
    container: { gap: spacing.sm },
    input: {
      ...type.body,
      backgroundColor: c.surfaceSunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      color: c.ink,
      minHeight: 48,
    },
    inputError: { borderColor: c.danger },
  })
```

- [ ] **Step 3: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 4: Verificar los cuatro variantes de botón en la app**

```bash
cd mobile && npm start
```

- `primary`: el botón "Cargar movimiento" al pie de Inicio. Relleno azul, texto oscuro. Mantener presionado debe oscurecer el relleno.
- `secondary`: el botón de un `EmptyState` (Inicio sin billeteras).
- `ghost` y `destructive`: "Cerrar sesión" en Ajustes. Borde rojo, texto rojo, y al presionar un fondo rojo muy tenue.

Si un presionado dejó de responder, el culpable es el renombre de `pressedStyles[variant]` a `styles[\`${variant}Pressed\`]`.

- [ ] **Step 5: Commit y push**

```bash
git add mobile/src/ui/Button.tsx mobile/src/ui/Field.tsx
git commit -m "refactor(mobile): theme Button and Field, move destructive to danger"
git push -u origin HEAD
```

---

### Task 7: `Section.tsx` — `BadgeTone` gana `expense` y pierde `warning`

**Files:**
- Modify: `mobile/src/ui/Section.tsx`

**Interfaces:**
- Consumes: `useThemeColors`, `useThemeStyles`, `Colors` de Task 2.
- Produces: `type BadgeTone = 'neutral' | 'brand' | 'attention' | 'positive' | 'expense'`. `Section`, `EmptyState` y `Badge` con la firma pública sin cambios.

Verificado antes de escribir: el único consumidor de `BadgeTone` es `app/integrations.tsx:18`, cuyo `statusTone` mapea a `'positive'`, `'neutral'` y `'attention'`. Sacar `'warning'` no rompe nada.

- [ ] **Step 1: Migrar el archivo**

Import:

```tsx
import { radius, spacing, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
```

`Section` y `EmptyState` necesitan `const styles = useThemeStyles(makeStyles)` como primera línea del cuerpo.

Reemplazar el tipo, el mapa de colores y el componente `Badge`:

```tsx
export type BadgeTone = 'neutral' | 'brand' | 'attention' | 'positive' | 'expense'

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  const badgeColors: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: c.surfaceRaised, fg: c.muted },
    brand: { bg: c.brandSoft, fg: c.brand },
    attention: { bg: c.attentionSoft, fg: c.attention },
    positive: { bg: c.positiveSoft, fg: c.positive },
    expense: { bg: c.expenseSoft, fg: c.expense },
  }
  const badge = badgeColors[tone]
  return (
    <View style={[styles.badge, { backgroundColor: badge.bg }]}>
      <Txt variant="label" style={{ color: badge.fg }}>
        {label}
      </Txt>
    </View>
  )
}
```

Fábrica al final del archivo:

```tsx
const makeStyles = (c: Colors) =>
  StyleSheet.create({
    section: { gap: spacing.md, marginBottom: spacing.xxl },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 20,
    },
    empty: {
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xxxl,
      paddingHorizontal: spacing.xl,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderStyle: 'dashed',
    },
    emptyBody: { maxWidth: 260 },
    emptyAction: { marginTop: spacing.sm },
    badge: {
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      alignSelf: 'flex-start',
    },
  })
```

- [ ] **Step 2: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 3: Verificar el badge en la app**

Abrir Ajustes → Integraciones. El badge de estado debe verse con fondo tenue y texto legible encima. Los tres estados (`connected` verde, `disconnected` neutro, `error` ámbar) están cubiertos por `check:contrast`, que verifica cada acento contra su tinte.

- [ ] **Step 4: Commit y push**

```bash
git add mobile/src/ui/Section.tsx
git commit -m "refactor(mobile): theme Section and fold warning badge into attention"
git push -u origin HEAD
```

---

### Task 8: `app/(tabs)/_layout.tsx`

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `useThemeColors`, `useThemeStyles`, `Colors` de Task 2.
- Produces: nada que consuman otras tasks.

Este archivo tiene una particularidad: `screenOptions` es un objeto que se arma en el JSX y **usa color directo**, no solo estilos. Y `NewMovementIcon` es un componente auxiliar fuera de `TabLayout` que también usa color.

- [ ] **Step 1: Migrar `NewMovementIcon`**

Es un componente, así que puede usar hooks:

```tsx
/** La acción principal del ledger: cargar un movimiento. Va marcada, no escondida. */
function NewMovementIcon({ focused }: { focused: boolean }) {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  return (
    <View style={[styles.newIcon, focused && styles.newIconFocused]}>
      <Feather name="plus" size={20} color={c.onBrand} />
    </View>
  )
}
```

- [ ] **Step 2: Migrar `TabLayout`**

Import:

```tsx
import { fonts, radius, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
```

Primeras líneas del cuerpo de `TabLayout`:

```tsx
export default function TabLayout() {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  const { accessToken } = useAuth()
```

En `screenOptions`, cambiar las tres referencias de color:

```tsx
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.faint,
        sceneStyle: { backgroundColor: c.bg },
```

`tabBarStyle`, `tabBarLabelStyle` y `tabBarBadgeStyle` siguen apuntando a `styles.*` y no cambian en el JSX.

- [ ] **Step 3: Convertir la hoja en fábrica**

```tsx
const makeStyles = (c: Colors) =>
  StyleSheet.create({
    bar: {
      backgroundColor: c.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      elevation: 0,
    },
    label: {
      fontFamily: fonts.medium,
      fontSize: 11,
      letterSpacing: 0.1,
    },
    // El contador de pendientes pide una acción: va en ámbar, no en azul.
    badge: {
      backgroundColor: c.attention,
      color: c.bg,
      fontFamily: fonts.semibold,
      fontSize: 11,
    },
    newIcon: {
      width: 34,
      height: 28,
      borderRadius: radius.sm,
      backgroundColor: c.brandPressed,
      alignItems: 'center',
      justifyContent: 'center',
    },
    newIconFocused: { backgroundColor: c.brand },
  })
```

El comentario viejo decía "va en arcilla, no en pizarra". La arcilla ya no existe: el token sigue siendo `attention` y ahora es ámbar.

- [ ] **Step 4: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 5: Verificar la tab bar en la app**

Las cinco tabs, el icono `+` marcado en el centro, y —si hay movimientos para revisar— el badge numérico sobre "Movimientos", ahora ámbar con número oscuro.

- [ ] **Step 6: Commit y push**

```bash
git add "mobile/app/(tabs)/_layout.tsx"
git commit -m "refactor(mobile): theme the tab bar"
git push -u origin HEAD
```

---

### Task 9: `app/(tabs)/index.tsx`

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `useThemeColors`, `useThemeStyles`, `Colors` de Task 2; `ThemedRefreshControl` de Task 4.
- Produces: nada.

**Solo migración.** La semántica de color de esta pantalla (gasto en rojo, barras de categoría) es la Task 18. Acá el objetivo es que se vea exactamente igual que antes de empezar.

- [ ] **Step 1: Cambiar imports**

```tsx
import { radius, spacing, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
```

En el import de `@/src/ui`, agregar `ThemedRefreshControl` en orden alfabético. De `react-native`, **sacar** `RefreshControl` de la lista de imports: ya no se usa directo.

- [ ] **Step 2: Primeras líneas del componente**

```tsx
export default function HomeScreen() {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  const { accessToken, user } = useAuth()
```

- [ ] **Step 3: Reemplazar el `RefreshControl` del `<Screen>`**

```tsx
    <Screen
      scroll
      refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
```

- [ ] **Step 4: El `ActivityIndicator`**

```tsx
        <ActivityIndicator color={c.brand} style={styles.loader} />
```

- [ ] **Step 5: Convertir la hoja en fábrica**

Solo cambian las entradas con color; el resto se copia igual. Las que cambian:

```tsx
    restCurrencies: {
      marginTop: spacing.lg,
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      gap: spacing.sm,
    },
    owedOverdue: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    walletCard: {
      width: 152,
      minHeight: 104,
      justifyContent: 'space-between',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.lg,
    },
    barTrack: {
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceRaised,
      overflow: 'hidden',
    },
    barFill: { height: 4, borderRadius: radius.pill, backgroundColor: c.borderStrong },
    // La categoría que más se llevó se marca por jerarquía, no por color.
    barFillLead: { backgroundColor: c.ink },
```

El comentario de `barFillLead` se deja tal cual **a propósito**: la Task 18 lo revierte, y dejarlo acá hace visible que la reversión fue deliberada.

Envolver todo el objeto en `const makeStyles = (c: Colors) => StyleSheet.create({ … })`.

- [ ] **Step 6: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 7: Verificar la pantalla**

Abrir Inicio. Comparar con una captura previa: saldo, billeteras en scroll horizontal, barras de categoría y últimos movimientos deben verse **idénticos**. Deslizar hacia abajo para confirmar que el indicador de refresh sigue apareciendo con el color correcto.

- [ ] **Step 8: Commit y push**

```bash
git add "mobile/app/(tabs)/index.tsx"
git commit -m "refactor(mobile): theme the home screen styles"
git push -u origin HEAD
```

---

### Task 10: `app/(tabs)/movements.tsx` y `app/(tabs)/settings.tsx`

**Files:**
- Modify: `mobile/app/(tabs)/movements.tsx`
- Modify: `mobile/app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: `useThemeColors`, `useThemeStyles`, `Colors` de Task 2; `ThemedRefreshControl` de Task 4.
- Produces: nada.

Solo migración. La sección Apariencia de Ajustes es la Task 20; el tono de los montos de Movimientos es la Task 18.

- [ ] **Step 1: `movements.tsx`**

Import: `import { spacing, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'`, agregar `ThemedRefreshControl` al import de `@/src/ui`, y sacar `RefreshControl` del import de `react-native`.

Primeras líneas de `MovementsScreen`:

```tsx
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
```

Línea 149: `<ActivityIndicator color={c.brand} style={styles.loader} />`

Líneas 154–162, el `RefreshControl` del `FlatList`. Antes:

```tsx
          refreshControl={
            <RefreshControl
              refreshing={movements.isFetching}
              onRefresh={() => movements.refetch()}
              tintColor={colors.muted}
              colors={[colors.brand]}
              progressBackgroundColor={colors.surface}
            />
          }
```

Después:

```tsx
          refreshControl={
            <ThemedRefreshControl
              refreshing={movements.isFetching}
              onRefresh={() => movements.refetch()}
            />
          }
```

La hoja pasa a fábrica. La única entrada con color es `filters` (no `filterRow`, que no tiene color):

```tsx
    filters: {
      gap: spacing.md,
      paddingBottom: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
```

- [ ] **Step 2: `settings.tsx`**

Import: `import { radius, spacing, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'`

Primeras líneas de `SettingsScreen`:

```tsx
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
```

Línea 65: `<Feather name="chevron-right" size={16} color={c.faint} />`

Fábrica:

```tsx
const makeStyles = (c: Colors) =>
  StyleSheet.create({
    title: { marginBottom: spacing.xxl },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
      minHeight: 52,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowPressed: { backgroundColor: c.surfaceRaised },
    rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    logoutRow: { padding: spacing.lg },
  })
```

- [ ] **Step 3: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 4: Verificar las dos pantallas**

Movimientos: los chips de filtro, la lista, y el refresh al deslizar. Ajustes: las filas con chevron y el botón de cerrar sesión.

- [ ] **Step 5: Commit y push**

```bash
git add "mobile/app/(tabs)/movements.tsx" "mobile/app/(tabs)/settings.tsx"
git commit -m "refactor(mobile): theme movements and settings styles"
git push -u origin HEAD
```

---

### Task 11: `app/(tabs)/reports.tsx`

**Files:**
- Modify: `mobile/app/(tabs)/reports.tsx`

**Interfaces:**
- Consumes: `useThemeColors`, `useThemeStyles`, `Colors` de Task 2; `ThemedRefreshControl` de Task 4.
- Produces: nada.

Solo migración. El color de las tarjetas y de la barra de monotributo es la Task 19.

Este archivo tiene dos funciones a nivel de módulo que usan color: `barColor` y `MonthArrow`. Las dos hay que resolverlas, de distinta manera.

- [ ] **Step 1: Cambiar el import del tema**

```tsx
import { radius, spacing, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
```

`type Colors` hace falta acá porque `barColor` lo recibe como parámetro, no solo la fábrica de estilos.

Agregar `ThemedRefreshControl` al import de `@/src/ui` y sacar `RefreshControl` del de `react-native`.

- [ ] **Step 2: `barColor` pasa a recibir la paleta**

Es una función pura, no un componente: no puede usar hooks. Se le pasa la paleta como parámetro.

```tsx
/** El techo del monotributo pide acción sólo cuando aprieta: hasta ahí, azul. */
function barColor(status: MonotributoAlert['status'], c: Colors): string {
  if (status === 'exceeded') return c.attention
  if (status === 'warning') return c.warning
  return c.brand
}
```

**Atención:** `c.warning` no existe en el tipo `Colors` y esto no compila. Es intencional que lo veas acá: la migración de este archivo **no puede** conservar la semántica vieja, porque `warning` desapareció. La versión correcta para esta task, que preserva el comportamiento observable, es:

```tsx
/** El techo del monotributo pide acción sólo cuando aprieta: hasta ahí, azul. */
function barColor(status: MonotributoAlert['status'], c: Colors): string {
  if (status === 'exceeded') return c.attention
  if (status === 'warning') return c.attention
  return c.brand
}
```

Los dos estados van a `attention` porque en la paleta de compatibilidad `warning` era un alias de `attention`. La Task 19 los separa correctamente (`exceeded` → `danger`). Dejarlo así en el medio mantiene la app igual a como estaba.

En el llamador, línea ~217:

```tsx
                            backgroundColor: barColor(alert.data.status, c),
```

- [ ] **Step 3: `MonthArrow` es un componente, usa hooks**

```tsx
/** Flecha del selector de mes. Área de toque grande, sin fondo. */
function MonthArrow({ name, onPress }: { name: 'chevron-left' | 'chevron-right'; onPress: () => void }) {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}
    >
      <Feather name={name} size={20} color={c.muted} />
    </Pressable>
  )
}
```

- [ ] **Step 4: `TotalCard` y `ReportsScreen`**

`TotalCard` usa `styles.detail` y `styles.detailRow`: necesita `const styles = useThemeStyles(makeStyles)` como primera línea.

`ReportsScreen` necesita `styles` y `c`:

```tsx
export default function ReportsScreen() {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  const { accessToken, setUser } = useAuth()
```

El `RefreshControl` del `<Screen>`:

```tsx
      refreshControl={
        <ThemedRefreshControl
          refreshing={summary.isFetching || alert.isFetching}
          onRefresh={() => {
            void summary.refetch()
            void alert.refetch()
          }}
        />
      }
```

El `ActivityIndicator`: `<ActivityIndicator color={c.brand} style={styles.loader} />`

- [ ] **Step 5: Convertir la hoja en fábrica**

Las entradas con color:

```tsx
    arrowPressed: { backgroundColor: c.surfaceRaised },
    barTrack: {
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceSunken,
      overflow: 'hidden',
      marginTop: spacing.md,
    },
```

El resto se copia sin cambios dentro de `const makeStyles = (c: Colors) => StyleSheet.create({ … })`.

- [ ] **Step 6: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan. Si `tsc` se queja de `c.warning`, es que quedó la primera versión de `barColor` del Step 2: usar la segunda.

- [ ] **Step 7: Verificar la pantalla**

Reportes: el selector de mes con las dos flechas, las tres tarjetas, la barra de monotributo y los chips de categoría. Tocar una flecha para confirmar que el mes cambia y la pantalla se repinta.

- [ ] **Step 8: Commit y push**

```bash
git add "mobile/app/(tabs)/reports.tsx"
git commit -m "refactor(mobile): theme the reports screen styles"
git push -u origin HEAD
```

---

### Task 12: `app/(tabs)/new-movement.tsx`

**Files:**
- Modify: `mobile/app/(tabs)/new-movement.tsx`

**Interfaces:**
- Consumes: `useThemeColors`, `useThemeStyles`, `Colors` de Task 2.
- Produces: nada.

491 líneas: el archivo más grande de la app y el de mayor riesgo de dejarse un token sin migrar. Va solo en su propia task.

- [ ] **Step 1: Inventariar antes de tocar**

```bash
cd mobile && grep -n "colors\." "app/(tabs)/new-movement.tsx"
```

Esperado: 7 líneas — 287, 288 (props de `TextInput`), 460, 463, 469, 486, 487 (estilos). Anotarlas: al final tienen que ser cero.

- [ ] **Step 2: Migrar**

El import del tema pasa de:

```tsx
import { colors, radius, spacing, type } from '@/src/theme'
```

a:

```tsx
import { radius, spacing, type, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
```

Primeras líneas del componente de pantalla:

```tsx
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
```

Líneas 287–288:

```tsx
          placeholderTextColor={c.faint}
          selectionColor={c.brand}
```

En la hoja, las cinco entradas con color: `c.surface` (460), `c.border` (463), `c.ink` (469), y el par de error 486–487, que pasa de `attentionEdge`/`attentionSoft` a:

```tsx
      borderColor: c.danger,
      backgroundColor: c.dangerSoft,
```

Envolver la hoja completa en `const makeStyles = (c: Colors) => StyleSheet.create({ … })`.

- [ ] **Step 3: Verificar que no quedó ninguno**

```bash
cd mobile && grep -c "colors\." "app/(tabs)/new-movement.tsx"
```

Esperado: `0`.

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 4: Verificar la pantalla completa**

Es un formulario largo: hay que recorrerlo entero.

- Escribir en el campo de monto: el texto se ve, el placeholder se ve, el cursor se ve.
- Los selectores de tipo, billetera, categoría y cliente.
- Forzar un error de validación (guardar con el monto vacío): el campo debe quedar con borde rojo y fondo rojo tenue.
- Guardar un movimiento válido y confirmar que aparece en Movimientos.

- [ ] **Step 5: Commit y push**

```bash
git add "mobile/app/(tabs)/new-movement.tsx"
git commit -m "refactor(mobile): theme the new movement form"
git push -u origin HEAD
```

---

### Task 13: `wallets`, `receivables`, `categories`, `clients`, `(auth)/_layout`

**Files:**
- Modify: `mobile/app/wallets.tsx`
- Modify: `mobile/app/receivables.tsx`
- Modify: `mobile/app/categories.tsx`
- Modify: `mobile/app/clients.tsx`
- Modify: `mobile/app/(auth)/_layout.tsx`

**Interfaces:**
- Consumes: `useThemeColors` de Task 2; `ThemedRefreshControl` de Task 4.
- Produces: nada.

Los cinco archivos más fáciles del plan. Verificado antes de escribir: **las hojas de `wallets`, `receivables`, `categories` y `clients` no tienen ni un color**. Todo su color vive en el JSX, en el `ActivityIndicator` y en el `RefreshControl`. **No necesitan `makeStyles`**: alcanza con `useThemeColors()`.

- [ ] **Step 1: Los cuatro con lista y refresh**

En `wallets.tsx`, `receivables.tsx`, `categories.tsx` y `clients.tsx`, la misma transformación:

1. Import del tema: dejar solo lo que el archivo usa de verdad, cambiando `colors` por `useThemeColors`. Ejemplo para `wallets.tsx`: `import { spacing, useThemeColors } from '@/src/theme'`.
2. Agregar `ThemedRefreshControl` al import de `@/src/ui` y **sacar** `RefreshControl` del import de `react-native`.
3. Primera línea del cuerpo del componente: `const c = useThemeColors()`.
4. El `ActivityIndicator`: `color={c.brand}`.
5. El bloque de `RefreshControl` de 8 líneas se reemplaza por uno de 4, conservando exactamente las expresiones de `refreshing` y `onRefresh` que cada archivo ya tiene:

| Archivo | `refreshing` | `onRefresh` |
|---|---|---|
| `wallets.tsx` | `balances.isFetching` | `() => balances.refetch()` |
| `receivables.tsx` | `receivables.isFetching` | `() => receivables.refetch()` |
| `categories.tsx` | `categories.isFetching` | `() => categories.refetch()` |
| `clients.tsx` | `clients.isFetching` | `() => clients.refetch()` |

Ejemplo con `wallets.tsx`. Antes:

```tsx
          refreshControl={
            <RefreshControl
              refreshing={balances.isFetching}
              onRefresh={() => balances.refetch()}
              tintColor={colors.muted}
              colors={[colors.brand]}
              progressBackgroundColor={colors.surface}
            />
          }
```

Después:

```tsx
          refreshControl={
            <ThemedRefreshControl refreshing={balances.isFetching} onRefresh={() => balances.refetch()} />
          }
```

6. La hoja `StyleSheet.create` **se queda como está**: no tiene color.

- [ ] **Step 2: `(auth)/_layout.tsx`**

Acá el color vive dentro del objeto `screenOptions` del `<Stack>`. Como es un componente, puede usar hooks.

```tsx
import { type, useThemeColors } from '@/src/theme'
import { Stack } from 'expo-router'

export default function AuthLayout() {
  const c = useThemeColors()
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.ink,
        headerTitleStyle: { ...type.heading, color: c.ink },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      {/* … las Stack.Screen que ya tenga el archivo, sin cambios … */}
    </Stack>
  )
}
```

Copiar las `Stack.Screen` y las props que el archivo ya tenga; lo único que cambia son las cuatro referencias a color.

- [ ] **Step 3: Verificar que quedaron en cero**

```bash
cd mobile && grep -c "colors\." app/wallets.tsx app/receivables.tsx app/categories.tsx app/clients.tsx "app/(auth)/_layout.tsx"
```

Esperado: `0` en los cinco.

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 4: Verificar las pantallas**

Ajustes → Billeteras, Clientes, Categorías. Inicio → "Te deben" → Ver detalle. En cada una: la lista se ve, el refresh al deslizar funciona, y el alta por `Sheet` abre y cierra. Cerrar sesión para ver Login y Registro con su cabecera.

- [ ] **Step 5: Commit y push**

```bash
git add mobile/app/wallets.tsx mobile/app/receivables.tsx mobile/app/categories.tsx mobile/app/clients.tsx "mobile/app/(auth)/_layout.tsx"
git commit -m "refactor(mobile): theme the list screens and the auth layout"
git push -u origin HEAD
```

---

### Task 14: `integrations`, `onboarding`, `movement/[id]`

**Files:**
- Modify: `mobile/app/integrations.tsx`
- Modify: `mobile/app/onboarding.tsx`
- Modify: `mobile/app/movement/[id].tsx`

**Interfaces:**
- Consumes: `useThemeColors`, `useThemeStyles`, `Colors` de Task 2.
- Produces: nada.

Los tres últimos con color. Los tres usan `attentionEdge`/`attentionSoft` para su caja de error, que pasan a `danger`/`dangerSoft`.

- [ ] **Step 1: `integrations.tsx`**

Solo dos líneas de color, las dos en la hoja (173–174). No hay color en el JSX, así que **no hace falta `useThemeColors`**.

Import: `import { spacing, useThemeStyles, type Colors } from '@/src/theme'` — ajustar a lo que el archivo use.

Primera línea del cuerpo del componente: `const styles = useThemeStyles(makeStyles)`.

En la fábrica, la caja de error:

```tsx
      borderColor: c.danger,
      backgroundColor: c.dangerSoft,
```

- [ ] **Step 2: `onboarding.tsx`**

Tres colores en JSX (42, 75, 77) y dos en la hoja (98–99).

Primeras líneas del cuerpo: `const styles = useThemeStyles(makeStyles)` y `const c = useThemeColors()`.

- Líneas 42 y 75: `<ActivityIndicator color={c.brand} />`
- Línea 77: `<Feather name="arrow-right" size={18} color={c.faint} />`
- Hoja, líneas 98–99: `borderColor: c.danger` y `backgroundColor: c.dangerSoft`.

- [ ] **Step 3: `movement/[id].tsx`**

Un color en JSX (128) y siete en la hoja (273, 276, 284, 287, 302, 312, 313).

**Cuidado con el nombre:** este archivo ya usa `c` como parámetro en dos `.map()` (líneas 178 y 204). Nombrar `c` a la paleta la dejaría sombreada dentro de esos bloques. Acá la variable se llama `theme`:

```tsx
  const styles = useThemeStyles(makeStyles)
  const theme = useThemeColors()
```

La fábrica sí usa `c` como parámetro, porque vive a nivel de módulo y no tiene ese conflicto.

- Línea 128: `<ActivityIndicator color={theme.brand} />`
- Hoja: `c.surface` (273, 284), `c.border` (276, 287, 302), y la caja de error (312–313) a `c.danger` / `c.dangerSoft`.

- [ ] **Step 4: Verificar que quedaron en cero**

```bash
cd mobile && grep -c "colors\." app/integrations.tsx app/onboarding.tsx "app/movement/[id].tsx"
```

Esperado: `0` en los tres.

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 5: Verificar las pantallas**

Ajustes → Integraciones. Inicio → tocar un movimiento para ver el detalle. Onboarding solo se ve en una cuenta sin `profileTemplate`; si no hay una a mano, alcanza con leer el diff y confirmar que las cinco referencias quedaron migradas.

- [ ] **Step 6: Commit y push**

```bash
git add mobile/app/integrations.tsx mobile/app/onboarding.tsx "mobile/app/movement/[id].tsx"
git commit -m "refactor(mobile): theme integrations, onboarding and movement detail"
git push -u origin HEAD
```

---

### Task 15: `app/_layout.tsx` — navegación, barra de estado y gate de carga

**Files:**
- Modify: `mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `useTheme` de Task 2.
- Produces: nada.

El último archivo con color, y el que hace que el cambio de tema alcance a la navegación. `navTheme` y `stackHeader` son constantes de módulo: hay que meterlas dentro de un componente.

- [ ] **Step 1: Extraer un componente que sí pueda usar hooks**

`RootLayout` no puede usar `useTheme()` porque **él** monta el provider. La solución es un componente hijo:

```tsx
import { fonts, ThemeProvider as AppThemeProvider, type, useTheme } from '@/src/theme'
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useRouter,
  useSegments,
  type Theme,
} from 'expo-router'
```

Borrar las constantes `navTheme` y `stackHeader` de nivel de módulo, y en su lugar:

```tsx
function ThemedApp() {
  const { name, colors: c } = useTheme()

  const navTheme: Theme = {
    ...(name === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(name === 'dark' ? DarkTheme : DefaultTheme).colors,
      primary: c.brand,
      background: c.bg,
      card: c.bg,
      text: c.ink,
      border: c.border,
      notification: c.brand,
    },
  }

  /** Cabecera compartida por las pantallas apiladas fuera de las tabs. */
  const stackHeader = {
    headerShown: true,
    headerStyle: { backgroundColor: c.bg },
    headerShadowVisible: false,
    headerTintColor: c.ink,
    headerTitleStyle: { ...type.heading, color: c.ink },
    headerBackTitleStyle: { fontFamily: fonts.medium },
  } as const

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <AuthGate>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="wallets" options={{ ...stackHeader, title: 'Billeteras' }} />
          <Stack.Screen name="clients" options={{ ...stackHeader, title: 'Clientes' }} />
          <Stack.Screen name="categories" options={{ ...stackHeader, title: 'Categorías' }} />
          <Stack.Screen name="integrations" options={{ ...stackHeader, title: 'Integraciones' }} />
          <Stack.Screen name="movement/[id]" options={{ ...stackHeader, title: 'Movimiento' }} />
          <Stack.Screen name="receivables" options={{ ...stackHeader, title: 'Te deben' }} />
        </Stack>
      </AuthGate>
    </ThemeProvider>
  )
}
```

- [ ] **Step 2: Migrar `AuthGate`**

Usa `colors.bg` y `colors.brand` en su estado de carga:

```tsx
function AuthGate({ children }: { children: React.ReactNode }) {
  const { colors: c } = useTheme()
  const { user, loading } = useAuth()
  // … el resto del cuerpo sin cambios …

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.brand} />
      </View>
    )
  }

  return <>{children}</>
}
```

- [ ] **Step 3: El gate de carga — evitar el flash de tema equivocado**

La preferencia se lee de AsyncStorage de forma asíncrona. Si la app renderiza antes de que termine esa lectura, el primer frame sale en `'system'` y después salta al tema elegido. Un flash de blanco a negro es peor que el problema original.

`RootLayout` ya bloquea el primer render hasta que carguen las fuentes. La carga del tema se suma a esa misma condición, con un componente intermedio que lee `loading` del provider:

```tsx
function ThemeGate() {
  const { loading } = useTheme()
  // Sin preferencia leída todavía: mejor esperar detrás del splash que
  // mostrar un frame con el tema equivocado.
  if (loading) return null
  return <ThemedApp />
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient())
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync()
    }
  }, [fontsLoaded, fontError])

  // Sin tipografía cargada la app se vería con la familia del sistema: mejor
  // esperar detrás del splash que mostrar un salto de fuente.
  if (!fontsLoaded && !fontError) return null

  return (
    <AppThemeProvider>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemeGate />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </AppThemeProvider>
  )
}
```

**Riesgo conocido:** `SplashScreen.hideAsync()` se dispara con las fuentes, no con el tema. Si la lectura de AsyncStorage tardara más que las fuentes, habría un frame en blanco entre el splash y la app. En la práctica leer una clave de AsyncStorage es más rápido que cargar cuatro fuentes, pero si en el dispositivo real se ve un parpadeo, la corrección es mover el `hideAsync()` dentro de `ThemeGate`, condicionado a `!loading && (fontsLoaded || fontError)`.

- [ ] **Step 4: Verificar que no quedó ningún color**

```bash
cd mobile && grep -c "colors\." app/_layout.tsx
```

Esperado: `0`. (Las apariciones de `colors: c` en la desestructuración de `useTheme()` no matchean el patrón `colors.`.)

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 5: Verificar el arranque**

```bash
cd mobile && npm start
```

Matar la app y reabrirla varias veces mirando el arranque: debe ir del splash a la app sin ningún frame de color equivocado. Navegar a Billeteras para confirmar que la cabecera del stack se ve bien.

- [ ] **Step 6: Commit y push**

```bash
git add mobile/app/_layout.tsx
git commit -m "refactor(mobile): drive navigation theme and status bar from the theme context"
git push -u origin HEAD
```

---

### Task 16: Plataforma — `app.json`, `+html.tsx`, splash

**Files:**
- Modify: `mobile/app.json`
- Modify: `mobile/app/+html.tsx`

**Interfaces:**
- Consumes: los hex de Task 1.
- Produces: nada.

Sin esta task, `useColorScheme()` devuelve siempre `'dark'` en iOS y el modo `Automático` queda muerto.

- [ ] **Step 1: Leer los docs antes de tocar**

Obligatorio según [mobile/AGENTS.md](../../../mobile/AGENTS.md):

- https://docs.expo.dev/versions/v57.0.0/config/app/ — `userInterfaceStyle`, `backgroundColor`
- https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/ — si el plugin acepta variante clara y con qué forma exacta

- [ ] **Step 2: `app.json`**

```json
  "userInterfaceStyle": "automatic",
```

Y el fondo global al nuevo `bg` oscuro:

```json
  "backgroundColor": "#141414",
```

`android.adaptiveIcon.backgroundColor` pasa de `#171717` a `#141414`. El `adaptiveIcon` es un color único por definición y se queda en el oscuro: es el icono en el launcher, no una pantalla de la app.

- [ ] **Step 3: Splash**

Si los docs del Step 1 confirman que el plugin de SDK 57 acepta variante clara, configurarla con `backgroundColor: "#F6F6F4"` y la misma imagen. Si **no** lo soporta:

- dejar el splash en `#141414` para los dos temas,
- y anotarlo como deuda conocida en el spec, en la sección "Fuera de alcance", con una línea que diga qué se verificó y en qué versión.

**No inventar una forma de config que no esté en los docs.** Un `app.json` con una clave que el plugin ignora es peor que no tenerla: parece resuelto y no lo está.

- [ ] **Step 4: `+html.tsx`**

Reemplazar el bloque `responsiveBackground` del final del archivo:

```tsx
// El fondo del documento acompaña al lienzo de la app en cada tema.
const responsiveBackground = `
body {
  background-color: #141414;
}
@media (prefers-color-scheme: light) {
  body {
    background-color: #F6F6F4;
  }
}`;
```

Y el comentario de arriba, que hoy dice "La app es de tema oscuro fijo", ya no es cierto: reemplazarlo por el de arriba.

**Limitación conocida, ya documentada en el spec:** este CSS se resuelve antes de que la app lea AsyncStorage. En web, un usuario con preferencia manual opuesta a la de su sistema puede ver un flash del fondo del sistema antes de que la app pinte. Aceptado; resolverlo requiere un script inline que lea `localStorage` y está fuera de alcance.

- [ ] **Step 5: Verificar**

```bash
cd mobile && npx tsc --noEmit
```

Esperado: pasa.

- [ ] **Step 6: Verificar el cambio automático de tema**

Con la app abierta y en primer plano, cambiar el tema del sistema operativo (iOS: Ajustes → Pantalla y brillo; Android: Ajustes → Pantalla → Tema oscuro).

Esperado: **la app se repinta al instante**, sin reiniciar y sin perder la pantalla actual. Es la primera vez en el plan que se puede comprobar el objetivo completo.

Si no pasa nada, el sospechoso es `userInterfaceStyle` en `app.json`: ese cambio necesita reconstruir el cliente de desarrollo, no alcanza con recargar el bundle de Metro.

- [ ] **Step 7: Commit y push**

```bash
git add mobile/app.json mobile/app/+html.tsx
git commit -m "feat(mobile): follow the system color scheme at the platform level"
git push -u origin HEAD
```

---

### Task 17: Borrar el `colors` de compatibilidad

**Files:**
- Modify: `mobile/src/theme/index.ts`
- Modify: `mobile/AGENTS.md`
- Modify: `docs/superpowers/specs/README.md`

**Interfaces:**
- Consumes: nada.
- Produces: la ausencia del export `colors`. A partir de acá, el único acceso a color es por hooks.

Esta es la task que **prueba** que la migración terminó. Si algún archivo quedó sin migrar, acá explota, y eso es exactamente lo que tiene que pasar.

- [ ] **Step 1: Confirmar que nadie lo importa**

```bash
cd mobile && grep -rn "colors\." app src
```

Esperado: **cero líneas**. Si aparece alguna, migrar ese archivo con el mismo patrón de las Tasks 5–14 antes de seguir. No borrar el export con archivos pendientes: el error de compilación es útil, pero es más barato encontrarlos con este grep.

- [ ] **Step 2: Borrar el bloque**

En `mobile/src/theme/index.ts`, borrar el `import { darkColors } from './palettes'` y todo el bloque `export const colors = { … }`, incluido su comentario. El archivo queda solo con los tres bloques de re-export.

- [ ] **Step 2b: Escribir la regla nueva donde se lee**

La regla no vale nada si vive solo en el spec. En `mobile/AGENTS.md`, debajo del bloque que ya está, agregar:

```markdown
# El color viene del contexto, nunca de un import

No existe `import { colors } from '@/src/theme'`. El color se lee con
`useThemeColors()` o `useThemeStyles(makeStyles)`, y toda fábrica
`makeStyles` se declara en la columna 0, nunca dentro de un componente.
`npm run check:contrast` lo verifica.
```

En [docs/superpowers/specs/README.md](../specs/README.md), sección "Convenciones", la línea que hoy dice "`StyleSheet.create` local y `colors` de `mobile/src/theme.ts`" quedó desactualizada. Reemplazarla por:

```markdown
- En la app: Expo Router, `useQuery`/`useMutation` inline por pantalla, y estilos con `useThemeStyles(makeStyles)` leyendo el color del `ThemeProvider` de `mobile/src/theme/`. No existe un `colors` importable. Antes de escribir código de app, leer los docs versionados de Expo SDK 57 (`https://docs.expo.dev/versions/v57.0.0/`), según [mobile/AGENTS.md](../../../mobile/AGENTS.md).
```

- [ ] **Step 3: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan. Si `tsc` falla con `has no exported member 'colors'`, quedó un archivo sin migrar: el error dice cuál.

- [ ] **Step 4: Verificar los criterios de aceptación 1 y 2 del spec**

```bash
cd mobile && grep -rl "colors\." app src | wc -l
```

Esperado: `0` (criterio 1 — hoy son 25).

```bash
cd mobile && grep -rnE "^\s+const make[A-Za-z]*Styles\s*=" app src
```

Esperado: sin salida (criterio 2). `npm run check:contrast` ya lo verifica, pero conviene verlo a mano una vez.

- [ ] **Step 5: Verificar el criterio 3 — cambio en caliente sin perder la pantalla**

Todavía no hay selector en Ajustes (es la Task 20), así que se prueba con el ajuste del sistema:

1. Abrir Movimientos y **hacer scroll hasta la mitad de la lista**.
2. Sin cerrar la app, cambiar el tema del sistema.
3. Volver a la app.

Esperado: la app está en el otro tema, **sigue en Movimientos, y sigue en la misma posición de scroll**. Si volvió a Inicio o al tope de la lista, el árbol de navegación se está desmontando: revisar que `navTheme` en la Task 15 sea un objeto nuevo por render y no esté forzando un remount del `Stack`.

- [ ] **Step 6: Commit y push**

```bash
git add mobile/src/theme/index.ts mobile/AGENTS.md docs/superpowers/specs/README.md
git commit -m "refactor(mobile): drop the compatibility colors export"
git push -u origin HEAD
```

**Punto de corte.** Acá la app funciona completa en los dos temas. Buen momento para frenar, mirar las pantallas y decidir si la paleta convence antes de cambiar la semántica.

---

### Task 18: Semántica — `toneForType` en Inicio, Movimientos y detalle

**Files:**
- Modify: `mobile/src/lib/format.ts`
- Modify: `mobile/app/(tabs)/index.tsx`
- Modify: `mobile/app/(tabs)/movements.tsx`
- Modify: `mobile/app/movement/[id].tsx`

**Interfaces:**
- Consumes: `Tone` de Task 3.
- Produces: `toneForType(type: Movement['type']): Tone` y `signForType(type: Movement['type']): '+' | '-' | undefined`, las dos exportadas de `mobile/src/lib/format.ts`.

Acá es donde se resuelve el problema que originó todo esto.

- [ ] **Step 1: Escribir los dos helpers**

Van juntos a propósito: el color y el signo son **la misma decisión**, y separarlos es lo que permite que alguien ponga tono sin signo y rompa el criterio 9. `signFor` hoy está duplicado literalmente en `index.tsx` y en `movements.tsx`; esto lo unifica.

Al final de `mobile/src/lib/format.ts`:

```ts
import type { Movement } from '@/src/api/types'
import type { Tone } from '@/src/ui'

/**
 * El color del monto según de qué lado del ledger está.
 *
 * Ingresos y cobros entran (verde), los gastos salen (rojo), y las
 * transferencias y facturas son neutras: mueven o devengan, pero no cambian
 * cuánta plata hay.
 */
export function toneForType(type: Movement['type']): Tone {
  if (type === 'income' || type === 'collection') return 'positive'
  if (type === 'expense') return 'expense'
  return 'muted'
}

/**
 * El signo que acompaña al monto. Va siempre junto a `toneForType`: el color
 * nunca viaja solo, que es lo que hace la app usable con daltonismo.
 * Los gastos se guardan en positivo, así que el `-` lo pone la vista.
 */
export function signForType(type: Movement['type']): '+' | '-' | undefined {
  if (type === 'expense') return '-'
  if (type === 'income' || type === 'collection') return '+'
  return undefined
}
```

Borrar la función `signFor` local de `app/(tabs)/index.tsx` (líneas ~30-35) y la de `app/(tabs)/movements.tsx` (líneas ~30-35): son idénticas a `signForType`.

- [ ] **Step 2: Inicio — el tono de los montos**

En `mobile/app/(tabs)/index.tsx`, agregar `signForType` y `toneForType` al import de `@/src/lib/format`.

En el `LedgerCell` de "Últimos movimientos" (línea ~293), reemplazar la expresión de tono inline y cambiar `signFor` por el helper compartido:

```tsx
                    right={
                      <LedgerCell
                        value={item.amount}
                        currency={item.currency}
                        sign={signForType(item.type)}
                        tone={toneForType(item.type)}
                      />
                    }
```

- [ ] **Step 3: Inicio — las barras de categoría**

La sección se llama "En qué se te fue este mes" y **todo lo que hay ahí es gasto**. La decisión vieja de marcar la jerarquía sin color se revierte a conciencia.

En la fábrica de estilos:

```tsx
    barTrack: {
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceRaised,
      overflow: 'hidden',
    },
    // Todo lo de esta sección es gasto: la barra va en el rojo de gasto y la
    // que más se llevó se distingue por opacidad, no por otro color.
    barFill: { height: 4, borderRadius: radius.pill, backgroundColor: c.expense, opacity: 0.55 },
    barFillLead: { opacity: 1 },
```

El JSX que aplica `barFillLead` no cambia: sigue siendo `index === 0 ? styles.barFillLead : null`, y ahora lo que hace es subir la opacidad en vez de cambiar el color.

- [ ] **Step 4: Movimientos**

En `mobile/app/(tabs)/movements.tsx`, agregar `signForType` y `toneForType` al import de `@/src/lib/format` y aplicarlos al `LedgerCell` de cada fila, igual que en el Step 2.

- [ ] **Step 5: Detalle del movimiento**

En `mobile/app/movement/[id].tsx` hay **dos** montos que corregir. La variable del movimiento se llama `data`.

Línea 158, el monto principal. Antes:

```tsx
        <Money value={data.amount} variant="display" />
```

Después:

```tsx
        <Money
          value={data.amount}
          variant="display"
          sign={signForType(data.type)}
          tone={toneForType(data.type)}
        />
```

Línea 209, cada cobro de una factura. Hoy tiene `tone="positive"` **sin signo**, que viola el criterio de aceptación 9 — es un bug preexistente que esta task tiene que cerrar. Antes:

```tsx
                  <Money value={c.amount} tone="positive" />
```

Después:

```tsx
                  <Money value={c.amount} tone="positive" sign="+" />
```

El `c` de esa línea es el parámetro del `.map()` sobre `collections`, no la paleta: no tocarlo. (La paleta en este archivo se llama `theme`, por la Task 14.)

Línea 196, "Saldo pendiente", **no cambia**: su tono es `attention` o `ink`, ninguno de los dos exige signo, y es un saldo, no un flujo.

- [ ] **Step 6: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 7: Verificar el criterio de aceptación 8**

Con al menos un ingreso, un gasto y una transferencia cargados, abrir Movimientos:

- el ingreso: **verde**, con `+`
- el gasto: **rojo**, con `-`
- la transferencia: **gris apagado**, sin signo

Los tres a la vez en la misma pantalla. Repetir en Inicio, sección "Últimos movimientos".

- [ ] **Step 8: Verificar el criterio de aceptación 9**

```bash
cd mobile && grep -rn "LedgerCell\|<Money" app | grep -v "sign"
```

Revisar cada línea del resultado: ningún `Money` o `LedgerCell` con `tone="positive"` o `tone="expense"` puede quedar sin `sign` o `signed`. Los que tienen tono neutro (`ink`, `muted`, `faint`) sí pueden: un saldo no lleva signo.

- [ ] **Step 9: Commit y push**

```bash
git add mobile/src/lib/format.ts "mobile/app/(tabs)/index.tsx" "mobile/app/(tabs)/movements.tsx" "mobile/app/movement/[id].tsx"
git commit -m "feat(mobile): color amounts by whether money comes in or goes out"
git push -u origin HEAD
```

---

### Task 19: Semántica — Reportes

**Files:**
- Modify: `mobile/app/(tabs)/reports.tsx`

**Interfaces:**
- Consumes: `Tone` de Task 3; `toneForType` de Task 18 no hace falta acá (las tarjetas no son movimientos individuales).
- Produces: nada.

Hoy "Gastaste" y "Te queda libre" son el mismo color. Después de esta task, las tres tarjetas del mes tienen tres tratamientos distintos.

- [ ] **Step 1: `TotalCard` acepta cualquier tono**

Cambiar la firma y propagar el tono al desglose por moneda:

```tsx
/** Tarjeta de total: rótulo, monto en ARS y el desglose por moneda debajo. */
function TotalCard({
  label,
  totalArs,
  detail,
  tone = 'ink',
  children,
}: {
  label: string
  totalArs: number
  detail?: { currency: string; value: number }[]
  tone?: Tone
  children?: React.ReactNode
}) {
  const styles = useThemeStyles(makeStyles)
  return (
    <Card>
      <Txt variant="label" tone="faint">
        {label}
      </Txt>
      <Money value={totalArs} variant="amountLarge" tone={tone} />
      <Txt variant="label" tone="faint">
        ARS
      </Txt>
      {detail && detail.length > 0 ? (
        <View style={styles.detail}>
          {detail.map((row) => (
            <View key={row.currency} style={styles.detailRow}>
              <Txt variant="label" tone="faint">
                {row.currency}
              </Txt>
              <Money value={row.value} tone={tone} />
            </View>
          ))}
        </View>
      ) : null}
      {children}
    </Card>
  )
}
```

Agregar `Tone` al import de `@/src/ui`.

- [ ] **Step 2: Las tres tarjetas del mes**

```tsx
            <TotalCard
              label="Facturaste"
              totalArs={summary.data.incomeArs}
              tone="positive"
              detail={foreign('income')}
            />
            <TotalCard
              label="Gastaste"
              totalArs={summary.data.expenseArs}
              tone="expense"
              detail={foreign('expense')}
            />
            <TotalCard
              label="Te queda libre"
              totalArs={summary.data.netAfterTax}
              tone={summary.data.netAfterTax < 0 ? 'expense' : 'ink'}
            >
```

El resto del contenido de la tercera tarjeta (la nota de la cuota y el aviso de categoría estimada) no cambia.

- [ ] **Step 3: La barra de monotributo**

```tsx
/**
 * El techo del monotributo: azul mientras sobra, ámbar cuando aprieta, rojo
 * cuando ya te pasaste. El ámbar es "hacé algo antes"; el rojo es "ya pasó".
 */
function barColor(status: MonotributoAlert['status'], c: Colors): string {
  if (status === 'exceeded') return c.danger
  if (status === 'warning') return c.attention
  return c.brand
}
```

- [ ] **Step 4: "Excedido"**

Es la única excepción de la regla de forma: `danger` como color de texto, y solo porque el monto está rotulado "Excedido".

```tsx
                        <Money
                          value={Math.abs(alert.data.remaining)}
                          tone={alert.data.remaining < 0 ? 'danger' : 'ink'}
                        />
```

El `Txt` del rótulo de al lado también acompaña:

```tsx
                        <Txt variant="label" tone={alert.data.remaining < 0 ? 'danger' : 'faint'}>
                          {alert.data.remaining < 0 ? 'Excedido' : 'Te queda'}
                        </Txt>
```

El mensaje de "Te pasaste del techo de todas las categorías" (el caso `percentUsed === null`) pasa de `tone="attention"` a `tone="danger"`: ya pasó, no es un aviso.

- [ ] **Step 5: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 6: Verificar los criterios de aceptación 10 y 11**

Criterio 10 — abrir Reportes en un mes con datos. Las tres tarjetas: "Facturaste" verde, "Gastaste" rojo, "Te queda libre" tinta neutra. Si el neto diera negativo, la tercera va en rojo.

Criterio 11 — la barra de monotributo en sus tres estados. Para verlos sin datos reales, cambiar la categoría con los chips de abajo: elegir una categoría alta deja la barra azul, y una lo bastante baja la lleva a ámbar y después a rojo. Confirmar que cuando se pasa aparece "Excedido" en rojo.

- [ ] **Step 7: Verificar el criterio 12 — la regla de forma**

Leer el diff completo de esta task y de la 18 y confirmar, línea por línea:

- `expense` solo aparece como `tone=` de un `Money`/`Txt`, o como `backgroundColor` de `barFill` en Inicio.
- `danger` solo aparece como `borderColor`, `backgroundColor` o color de regla, **salvo** el `tone="danger"` del monto y el rótulo "Excedido".
- "Vencido" en Inicio (`owedOverdue`) y en `receivables` sigue en `attention`. **No debe haber cambiado en ninguna de las dos tasks.**

- [ ] **Step 8: Commit y push**

```bash
git add "mobile/app/(tabs)/reports.tsx"
git commit -m "feat(mobile): give each monthly total its own color treatment"
git push -u origin HEAD
```

---

### Task 20: Ajustes — sección Apariencia

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: `useTheme`, `ThemePreference` de Task 2.
- Produces: nada.

Reusa `ChipRow`/`Chip`, igual que el selector de categoría de monotributo en Reportes. Sin componente nuevo.

- [ ] **Step 1: Agregar la sección**

Imports:

```tsx
import { radius, spacing, useTheme, useThemeStyles, type Colors, type ThemePreference } from '@/src/theme'
import { Button, Chip, ChipRow, Screen, Section, Txt } from '@/src/ui'
```

En el cuerpo del componente, junto al resto de hooks:

```tsx
  const { preference, setPreference } = useTheme()
```

A nivel de módulo, arriba del componente:

```tsx
const themeOptions: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'Automático' },
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
]
```

En el JSX, **entre** la `Section` de "Tus datos" y la de "Cuenta":

```tsx
      <Section title="Apariencia">
        <ChipRow>
          {themeOptions.map((option) => (
            <Chip
              key={option.id}
              label={option.label}
              selected={preference === option.id}
              onPress={() => setPreference(option.id)}
            />
          ))}
        </ChipRow>
        <Txt variant="caption" tone="faint" style={styles.appearanceHint}>
          Automático sigue el ajuste de tu teléfono.
        </Txt>
      </Section>
```

En la fábrica de estilos, agregar:

```tsx
    appearanceHint: { marginTop: spacing.xs },
```

`Chip` ya expone `accessibilityRole="button"` y `accessibilityState={{ selected }}`, así que el selector queda accesible sin trabajo extra.

- [ ] **Step 2: Verificar**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

Esperado: los dos pasan.

- [ ] **Step 3: Verificar el criterio de aceptación 3**

1. Abrir Ajustes. La sección Apariencia muestra tres chips, con "Automático" seleccionado.
2. Tocar "Claro".

Esperado: **la app se pone clara al instante**, sin reiniciar, y sigue en Ajustes con el scroll donde estaba. Los tres chips siguen visibles y "Claro" queda marcado.

3. Tocar "Oscuro", después "Automático". Cada toque repinta al instante.

- [ ] **Step 4: Verificar el criterio de aceptación 5 — persistencia sin flash**

1. Con la preferencia en `Claro`, **matar el proceso de la app** (no solo mandarla al fondo).
2. Reabrirla.

Esperado: arranca **en claro**, y del splash pasa a la app sin ningún frame oscuro en el medio. Repetir tres o cuatro veces: un flash intermitente es igual de real que uno constante.

Si aparece el flash, la corrección está anotada en el Step 3 de la Task 15: mover `SplashScreen.hideAsync()` dentro de `ThemeGate`.

- [ ] **Step 5: Verificar el criterio de aceptación 4**

Poner la preferencia en `Automático`. Con la app abierta en primer plano, cambiar el tema del sistema operativo.

Esperado: la app se repinta sola.

Después poner la preferencia en `Oscuro` y volver a cambiar el tema del sistema. Esperado: **la app no cambia**. Una preferencia manual gana sobre el sistema; si igual cambia, `preference` no se está respetando en el cálculo de `name`.

- [ ] **Step 6: Commit y push**

```bash
git add "mobile/app/(tabs)/settings.tsx"
git commit -m "feat(mobile): let users pick light, dark or automatic appearance"
git push -u origin HEAD
```

---

### Task 21: QA de las 15 rutas en ambos temas

**Files:**
- Modify: `docs/superpowers/specs/07-color-y-tema-claro.md` (solo si el Step 3 de la Task 16 dejó deuda de splash)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la evidencia para el PR.

La única task sin código. Es el criterio de aceptación 6 y no se puede automatizar: hay que mirar las pantallas.

- [ ] **Step 1: Correr toda la verificación automática**

```bash
cd mobile && npx tsc --noEmit && npm run check:contrast
```

```bash
cd mobile && grep -rl "colors\." app src | wc -l
```

Esperado: `tsc` pasa, `check:contrast` pasa, el grep devuelve `0`.

- [ ] **Step 2: Recorrer las 15 rutas en oscuro**

Poner Apariencia en `Oscuro` y recorrer, marcando cada una:

- [ ] `(auth)/login`
- [ ] `(auth)/register`
- [ ] `onboarding` (si no hay cuenta sin `profileTemplate`, anotarlo como no verificado en vivo)
- [ ] `(tabs)/index`
- [ ] `(tabs)/movements` — incluyendo el panel de filtros desplegado
- [ ] `(tabs)/new-movement` — incluyendo un error de validación
- [ ] `(tabs)/reports` — incluyendo los tres estados de la barra
- [ ] `(tabs)/settings`
- [ ] `categories`
- [ ] `clients`
- [ ] `wallets`
- [ ] `receivables`
- [ ] `integrations`
- [ ] `movement/[id]`
- [ ] `+not-found` (navegar a una ruta inventada)

En cada una, mirar tres cosas: **nada ilegible**, **ninguna caja invisible** (una tarjeta que se funde con el fondo), y **ningún color pegado del otro tema**.

Cubrir además los estados que no son una ruta: el `Sheet` de alta en Billeteras/Clientes/Categorías, los `EmptyState` de Inicio y Movimientos, el error de Reportes (cortar la red y deslizar), y las cabeceras de stack.

- [ ] **Step 3: Repetir las 15 en claro**

Poner Apariencia en `Claro` y recorrer la misma lista. El tema claro es el que **nunca se vio antes**: acá es donde van a aparecer los problemas. Sospechosos típicos: un `borderColor` que se pierde sobre blanco, un icono que quedó con color fijo, el `backdrop` del `Sheet`.

- [ ] **Step 4: Capturas para el PR**

Sacar seis capturas: Inicio, Movimientos y Reportes, en los dos temas. Son las tres pantallas donde se ven números y son la evidencia de que el problema original está resuelto.

- [ ] **Step 5: Regresión funcional — criterio de aceptación 14**

Con el tema en claro, para forzar el camino menos probado:

- [ ] Cerrar sesión e iniciar sesión de nuevo
- [ ] Cargar un movimiento nuevo de cada tipo: ingreso, gasto, transferencia
- [ ] Filtrar en Movimientos por tipo, por billetera y por categoría
- [ ] Cambiar la categoría de monotributo en Reportes y confirmar que "Te queda libre" se recalcula
- [ ] Crear y borrar una billetera

- [ ] **Step 6: Cerrar la deuda de splash si quedó**

Si el Step 3 de la Task 16 no pudo configurar el splash claro, agregar una línea a la sección "Fuera de alcance" del spec diciendo qué se verificó, en qué versión del SDK y qué haría falta para resolverlo. Si sí se pudo, **borrar** de esa sección la línea que anticipaba la deuda.

- [ ] **Step 7: Commit y push**

```bash
git add docs/superpowers/specs/07-color-y-tema-claro.md
git commit -m "docs: close the splash-screen open question in spec 7"
git push -u origin HEAD
```

Si no hubo cambios en el spec, saltear el commit y dejar constancia en el PR de que la Task 21 fue solo verificación.

---

## Cobertura del spec

| Requisito del spec | Task |
|---|---|
| Paleta oscura recalibrada (21 tokens) | 1 |
| Paleta clara (21 tokens) | 1 |
| Umbrales de contraste verificados | 1 |
| Separación de tono entre `expense` y `attention` | 1 |
| `src/theme/` en cuatro archivos, `theme.ts` eliminado | 1, 2 |
| Tipo `Colors` compartido por los dos temas | 1 |
| Eliminar alias heredados (`accent`, `income`, `warning`, `attentionEdge`, `brandEdge`) | 2, 3, 6, 7, 11, 12, 14, 17 |
| `ThemeProvider` con `system`/`dark`/`light` | 2 |
| Persistencia en AsyncStorage (`monedapp.theme`) | 2 |
| `useThemeStyles` cacheado por (fábrica, tema) | 2 |
| Regla de `makeStyles` en columna 0 | 1, 17 |
| Gate de carga sin flash | 15 |
| Migración de los 10 primitivos de `src/ui/` | 3–7 |
| Migración de los 6 archivos de `app/(tabs)/` | 8–12 |
| Migración de los 9 restantes de `app/` | 13–15 |
| `Tone`: `+expense`, `−warning` | 3 |
| `BadgeTone`: `+expense`, `−warning` | 7 |
| `Button` destructivo en `danger` | 6 |
| `userInterfaceStyle: automatic` | 16 |
| `navTheme`, `stackHeader`, `StatusBar` | 15 |
| `+html.tsx` con `prefers-color-scheme` | 16 |
| Splash y adaptive icon | 16 |
| `toneForType` | 18 |
| Barras de categoría en `expense` | 18 |
| Tres tarjetas de Reportes con tres tratamientos | 19 |
| `barColor` con `danger`/`attention`/`brand` | 19 |
| "Excedido" en `danger`, "Vencido" en `attention` | 19 |
| Sección Apariencia en Ajustes | 20 |
| Redundancia de signo (daltonismo) | 18 |
| Regla de forma entre `expense` y `danger` | 19 |
| Criterios de aceptación 1–14 | 17, 18, 19, 20, 21 |
| Regla del color en `AGENTS.md` y en las convenciones de specs | 17 |
| `ThemedRefreshControl` | 4 — **no está en el spec**; ver la justificación en la Task 4 |
| `signForType` unificado y el `Money` sin signo de `movement/[id]:209` | 18 — bug preexistente que cierra el criterio 9 |

## Rollback

Puramente de presentación: no toca backend, ni schema, ni contratos de API. Revertir el PR alcanza. La única clave nueva en el dispositivo es `monedapp.theme`, que la versión anterior simplemente no lee.

Si el problema aparece después de mergear y solo afecta al tema claro, el corte barato es forzar `preference: 'dark'` en el provider y ocultar la sección Apariencia: dos líneas, que dejan intacta la migración a `useTheme()` (Tasks 2–17), que es el grueso del trabajo.
