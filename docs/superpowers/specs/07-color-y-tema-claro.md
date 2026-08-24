# Spec 7 — Recalibración de color y tema claro

**Estado:** aprobado, sin implementar · **Tamaño:** L · **Alcance:** solo `mobile/`, sin cambios de backend

## Contexto

El problema reportado: *"al mostrar tantos números de que ingresó y qué se gastó quizá necesite una refactorización que muestre los colores más vivos y no tan apagados"*, más *"que pueda haber una opción de que la página se cambie a modo claro"*.

No es una sensación. El sistema actual —"Grafito", documentado en [mobile/src/theme.ts:1-12](../../../mobile/src/theme.ts#L1-L12)— tiene como regla escrita *"toda la paleta es apagada… nada saturado ni brillante"*, y esa regla produce tres efectos medibles:

1. **Los gastos no tienen color.** [theme.ts:88](../../../mobile/src/theme.ts#L88) define `expense: palette.ink050`, o sea tinta blanca: el mismo color que un título, el nombre de una categoría o el email del usuario. En [(tabs)/index.tsx:293](../../../mobile/app/(tabs)/index.tsx#L293) el tono del monto se resuelve como `item.type === 'income' || item.type === 'collection' ? 'positive' : 'ink'`. Un ingreso y un gasto se distinguen solo por un signo de un carácter y por un verde de **13% de saturación**.
2. **La jerarquía se apoya en tamaño de fuente, no en color.** Las barras de "En qué se te fue este mes" usan gris sobre gris ([index.tsx:378-381](../../../mobile/app/(tabs)/index.tsx#L378-L381)), con el comentario explícito *"la categoría que más se llevó se marca por jerarquía, no por color"*. En Reportes, las tres tarjetas del mes ("Facturaste", "Gastaste", "Te queda libre") son dos tintas neutras y un verde apagado ([reports.tsx:160-180](../../../mobile/app/(tabs)/reports.tsx#L160-L180)).
3. **El tema oscuro está cableado en cinco lugares distintos**, ninguno conmutable: `userInterfaceStyle: "dark"` en [app.json:9](../../../mobile/app.json#L9), `DarkTheme` en [_layout.tsx:20-31](../../../mobile/app/_layout.tsx#L20-L31), `<StatusBar style="light" />` en [_layout.tsx:105](../../../mobile/app/_layout.tsx#L105), `#171717` literal en [+html.tsx:31-35](../../../mobile/app/+html.tsx#L31-L35) y en `splash` / `adaptiveIcon` / `backgroundColor` de [app.json](../../../mobile/app.json). No hay una sola llamada a `useColorScheme` en el proyecto.

El bloqueo técnico del tema claro no es la paleta: son **151 referencias a `colors.*` repartidas en 25 archivos**, todas dentro de `StyleSheet.create` a nivel de módulo. Eso se evalúa una vez al importar el módulo, así que un cambio de tema en runtime no las alcanza.

Medición (2026-08-24, rama `codex/f6-reportes-monotributo`):

```
grep -ro "colors\.[a-zA-Z0-9]*" app src | wc -l   → 151   # referencias
grep -rl "colors\."             app src | wc -l   →  25   # archivos a migrar
grep -rl "from '@/src/theme'"    app src | wc -l   →  28   # los 3 restantes solo usan spacing/type
```

Los 3 que importan el tema sin usar color son [(auth)/login.tsx](../../../mobile/app/(auth)/login.tsx), [(auth)/register.tsx](../../../mobile/app/(auth)/register.tsx) y [+not-found.tsx](../../../mobile/app/+not-found.tsx): no requieren migración.

## Decisiones tomadas

| # | Decisión | Elegida |
|---|---|---|
| D1 | Intensidad | **Recalibrar Grafito.** El grafito sigue siendo el lienzo; suben saturación y luminancia de los acentos hasta contraste WCAG AA, y el color pasa a codificar significado en montos, barras, badges y estados. No se rediseña el sistema. |
| D2 | Elección de tema | **Automático + toggle manual.** Tres opciones en Ajustes: `Automático` (sigue al sistema, por defecto) / `Claro` / `Oscuro`, persistidas en AsyncStorage. |
| D3 | Arquitectura | **`useTheme()` en los 25 archivos.** `StyleSheet.create` a nivel de módulo pasa a fábrica `makeStyles(c)` memoizada. El cambio de tema es instantáneo, sin reinicio. |
| D4 | Color de los gastos | **El gasto se gana su propio rojo**, y "pide una acción" deja de ser rojo (ver corrección abajo). |

### Corrección a D4: la alerta pasa de arcilla a ámbar

D4 se aprobó como *"rojo propio para gastos + arcilla para alertas"*. **Al medirlo, esa combinación no es distinguible** y por eso se cambia:

| Par evaluado | Δ Hue | Contraste entre sí |
|---|---|---|
| gasto `#FF8A75` vs arcilla `#E0604A` | **0°** | 1.54:1 |
| gasto `#F5806E` vs arcilla `#E0604A` | 1° | 1.38:1 |
| gasto `#EF7A66` vs arcilla `#E0604A` | 0° | 1.29:1 |

Dos rojos separados por 0° de tono son el mismo color con distinto brillo. La intención de D4 —que el rojo de urgencia no se devalúe cuando cada gasto normal sea rojo— se preserva mejor moviendo **la alerta al ámbar** (36°/41°, Δ 27–33° contra el rojo de gasto) y absorbiendo ahí el `warning` ocre que hoy existe suelto. Queda:

- **rojo** = plata que sale, o algo que ya salió mal (excedido, destructivo);
- **ámbar** = te pide una acción *antes* de que salga mal (vencido, para revisar, 80–100% del techo);
- **verde** = plata que entra;
- **azul pizarra** = acción y estado activo, nunca alerta.

Esto reduce las familias de color de 5 (`brand`, `attention`, `positive`, `warning`, `danger`) a 4, porque `warning` y `attention` se fusionan.

### Regla de forma que separa rojo de rojo

`expense` y `danger` comparten tono (9° en oscuro, 8° vs 13° en claro; contraste entre sí 1.31–1.54:1). No colisionan porque **nunca comparten forma**:

- `expense` aparece **solo como color de texto de un monto**, siempre alineado a la derecha y siempre con signo `-`.
- `danger` aparece **solo como relleno, borde o regla de margen** (botón destructivo, barra de monotributo excedido, monto rotulado "Excedido").

Esta regla es normativa: si un caso nuevo necesita romperla, se discute antes de implementarla.

## Sistema de color

Dos temas completos, mismos tokens. Todos los ratios de abajo están **medidos**, no estimados (script de verificación en `mobile/scripts/check-contrast.mjs`, ver Fase 0).

### Oscuro (recalibrado)

| Token | Hex | Hue | Sat | Contra `surface` | Uso |
|---|---|---|---|---|---|
| `bg` | `#141414` | — | — | — | Lienzo |
| `surface` | `#1E1E1E` | — | — | 1.11 vs `bg` | Tarjetas y filas |
| `surfaceSunken` | `#101010` | — | — | — | Campos de formulario |
| `surfaceRaised` | `#282828` | — | — | — | Estado presionado |
| `border` | `#2E2E2E` | — | — | 1.23 | Bordes hairline |
| `borderStrong` | `#3D3D3D` | — | — | — | Agarre de Sheet, divisores fuertes |
| `ink` | `#EDEDEC` | 60 | 2% | **14.23** | Texto principal |
| `muted` | `#A3A39F` | 60 | 1% | **6.59** | Texto secundario |
| `faint` | `#75756F` | 60 | 1% | 3.60 | Rótulos, código de moneda (texto ≤13px decorativo) |
| `brand` | `#7FA9C6` | 205 | 38% | **6.66** | Acción, estado activo, links |
| `brandPressed` | `#6E97B4` | 205 | — | — | Presionado |
| `positive` | `#63C98B` | 144 | 49% | **8.14** | Ingresos y cobros |
| `expense` | `#FF8A75` | 9 | 100% | **7.26** | Gastos |
| `attention` | `#E8A33C` | 36 | 79% | **7.73** | Pide una acción |
| `danger` | `#EE7259` | 9 | 81% | **4.99** | Destructivo, excedido |
| `onBrand` | `#0F1519` | — | — | 7.35 sobre `brand` | Texto sobre relleno de marca |
| `brandSoft` | `#23313C` | — | — | 1.25 vs `surface`; `brand` encima **5.33** | Badge / chip seleccionado |
| `positiveSoft` | `#1C2F23` | — | — | 1.18; `positive` encima **6.93** | Badge |
| `expenseSoft` | `#38221D` | — | — | 1.12; `expense` encima **6.46** | Badge |
| `attentionSoft` | `#332815` | — | — | 1.16; `attention` encima **6.69** | Badge, fondo de banner |
| `dangerSoft` | `#3A231E` | — | — | 1.14; `danger` encima **4.99** | Botón destructivo presionado |

### Claro (nuevo)

| Token | Hex | Hue | Sat | Contra `surface` | Uso |
|---|---|---|---|---|---|
| `bg` | `#F6F6F4` | — | — | — | Lienzo (hueso cálido, no blanco puro) |
| `surface` | `#FFFFFF` | — | — | 1.08 vs `bg` | Tarjetas y filas |
| `surfaceSunken` | `#EFEFEC` | — | — | — | Campos de formulario |
| `surfaceRaised` | `#F2F2F0` | — | — | — | Estado presionado |
| `border` | `#E4E4E1` | — | — | 1.27 | Bordes hairline |
| `borderStrong` | `#CFCFCB` | — | — | — | Divisores fuertes |
| `ink` | `#1C1C1B` | 60 | 2% | **17.06** | Texto principal |
| `muted` | `#5C5C58` | 60 | 2% | **6.72** | Texto secundario |
| `faint` | `#787873` | 60 | 2% | 4.44 | Rótulos |
| `brand` | `#2F6E92` | 202 | 51% | **5.58** | Acción |
| `brandPressed` | `#27607F` | 201 | — | — | Presionado |
| `positive` | `#137A4E` | 154 | 73% | **5.36** | Ingresos y cobros |
| `expense` | `#B93A26` | 8 | 66% | **5.68** | Gastos |
| `attention` | `#7E5A0D` | 41 | 80% | **6.26** | Pide una acción |
| `danger` | `#9C2F12` | 13 | 79% | **7.42** | Destructivo, excedido |
| `onBrand` | `#FFFFFF` | — | — | 5.58 sobre `brand` | Texto sobre relleno de marca |
| `brandSoft` | `#E6EFF5` | — | — | 1.16; `brand` encima **4.79** | Badge |
| `positiveSoft` | `#E3F2E9` | — | — | 1.16; `positive` encima **4.63** | Badge |
| `expenseSoft` | `#FBEAE6` | — | — | 1.17; `expense` encima **4.87** | Badge |
| `attentionSoft` | `#F8F0DD` | — | — | 1.14; `attention` encima **5.51** | Badge |
| `dangerSoft` | `#F9E7E2` | — | — | 1.20; `danger` encima **6.21** | Botón destructivo presionado |

### Umbrales que se exigen

| Caso | Umbral | Nota |
|---|---|---|
| Texto de monto y cuerpo sobre `surface` / `bg` | ≥ 4.5:1 | AA texto normal. Todos los tokens de arriba salvo `faint` lo cumplen. |
| `faint` sobre `surface` | ≥ 3.0:1 | Excepción documentada: `faint` solo se usa en rótulos `label` (11px, uppercase, decorativos) y en el código de moneda de `LedgerCell`. Nunca lleva información que no esté repetida en otro lado. |
| Texto de badge sobre su `*Soft` | ≥ 4.5:1 | Cumplido en los 10 pares. |
| Barras, reglas de margen, iconos | ≥ 3.0:1 contra `surface` | Cumplido. |
| Texto sobre relleno de marca | ≥ 4.5:1 | 7.35 (oscuro) / 5.58 (claro). |

### Daltonismo

Verde-vs-rojo es exactamente el eje que colapsa en deuteranopía y protanopía, y es el eje central de esta app. **El color nunca es el único portador de la información de signo.** Tres redundancias, todas ya presentes o triviales de garantizar:

1. Todo monto de ingreso o gasto lleva signo explícito `+` / `-` — ya lo hace [Money.tsx:26](../../../mobile/src/ui/Money.tsx#L26) vía las props `signed` / `sign`. Pasa a ser obligatorio: `Money` sin `tone` neutro **debe** recibir signo (ver criterio de aceptación 9).
2. La línea `meta` de cada fila dice el tipo en palabras ("Ingreso", "Gasto", "Transferencia") — [index.tsx:288](../../../mobile/app/(tabs)/index.tsx#L288).
3. En claro y en oscuro, `positive` y `expense` difieren además en luminancia relativa, no solo en tono.

Fuera de alcance: un modo "alto contraste" o un modo daltónico dedicado.

## Arquitectura

### 1. `mobile/src/theme/` (reemplaza `mobile/src/theme.ts`)

El archivo actual se parte en cuatro. `spacing`, `radius`, `fonts`, `type` y `RULE_WIDTH` **no cambian**: no dependen del tema.

```
mobile/src/theme/
  palettes.ts   # darkColors, lightColors (los dos objetos de arriba)
  tokens.ts     # spacing, radius, fonts, type, RULE_WIDTH — movidos tal cual
  ThemeProvider.tsx
  index.ts      # re-exporta todo; mantiene `import { spacing } from '@/src/theme'` funcionando
```

`palettes.ts` exporta el tipo que ambos temas deben satisfacer, de modo que agregar un token a uno y olvidarlo en el otro sea un error de compilación:

```ts
export type Colors = {
  bg: string; surface: string; surfaceSunken: string; surfaceRaised: string
  border: string; borderStrong: string
  ink: string; muted: string; faint: string
  brand: string; brandPressed: string; brandSoft: string; onBrand: string
  positive: string; positiveSoft: string
  expense: string; expenseSoft: string
  attention: string; attentionSoft: string
  danger: string; dangerSoft: string
}

export const darkColors: Colors = { /* … */ }
export const lightColors: Colors = { /* … */ }
```

**Se eliminan** los alias heredados `accent`, `accentSoft`, `income`, `expense: ink050`, `warning`, `warningSoft`, `attentionEdge`, `brandEdge` ([theme.ts:70-90](../../../mobile/src/theme.ts#L70-L90)). Reemplazos:

| Token viejo | Reemplazo | Archivos afectados |
|---|---|---|
| `accent`, `accentSoft` | `brand`, `brandSoft` | ninguno (sin uso vivo) |
| `income` | `positive` | ninguno (sin uso vivo) |
| `expense` (era tinta blanca) | `expense` (ahora rojo) | cambia de significado, no de nombre |
| `warning`, `warningSoft` | `attention`, `attentionSoft` | `reports.tsx`, `Section.tsx`, `Text.tsx` |
| `attentionEdge` | `dangerSoft` (borde de botón destructivo) o `attention` | `Button.tsx`, `Field.tsx`, `new-movement.tsx`, `integrations.tsx`, `movement/[id].tsx`, `onboarding.tsx` |
| `brandEdge` | `brand` | ninguno (sin uso vivo) |

### 2. `ThemeProvider.tsx`

```ts
export type ThemeName = 'dark' | 'light'
export type ThemePreference = 'system' | 'dark' | 'light'

type ThemeValue = {
  name: ThemeName            // el tema resuelto
  colors: Colors
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
}
```

- La preferencia se lee de AsyncStorage bajo la clave `monedapp.theme` (mismo patrón que [AuthContext.tsx:23](../../../mobile/src/auth/AuthContext.tsx#L23)); valor inválido o ausente → `'system'`.
- `name` se resuelve como `preference === 'system' ? (useColorScheme() ?? 'dark') : preference`. El fallback es `'dark'`: si el sistema no informa esquema, la app se ve como se ve hoy.
- `setPreference` escribe en AsyncStorage con `void` (fire-and-forget) y actualiza el estado en el mismo tick: el toggle no espera al disco.
- El provider expone `loading` mientras lee AsyncStorage. `RootLayout` ya bloquea el primer render hasta que carguen las fuentes ([_layout.tsx:97](../../../mobile/app/_layout.tsx#L97)); la carga de tema se suma a esa misma condición. **Sin esto hay un flash de tema equivocado en el arranque**, que es peor que el problema original.

### 3. `useThemeStyles` — el patrón de migración

```tsx
// ANTES — se evalúa una vez al importar el módulo
const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border },
})

// DESPUÉS — fábrica pura fuera del componente, memoizada por tema
const makeStyles = (c: Colors) => StyleSheet.create({
  card: { backgroundColor: c.surface, borderColor: c.border },
})

export function Card() {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()   // para colores usados fuera de StyleSheet (props de iconos, tintColor)
  // …
}
```

`useThemeStyles` cachea por `(fábrica, tema)`, no por instancia de componente: cada `makeStyles` se ejecuta **como máximo dos veces en toda la vida de la app**, una por tema. Con 25 fábricas eso son 50 `StyleSheet.create` en el peor caso, contra 25 hoy.

```ts
const cache = new WeakMap<object, Map<ThemeName, unknown>>()

export function useThemeStyles<T>(factory: (c: Colors) => T): T {
  const { name, colors } = useTheme()
  return useMemo(() => {
    let byTheme = cache.get(factory)
    if (!byTheme) { byTheme = new Map(); cache.set(factory, byTheme) }
    if (!byTheme.has(name)) byTheme.set(name, factory(colors))
    return byTheme.get(name) as T
  }, [factory, name, colors])
}
```

**Requisito:** `makeStyles` se define a nivel de módulo, nunca dentro del componente. Una fábrica declarada dentro del componente es una identidad nueva por render y hace que el `WeakMap` crezca sin límite.

Se verifica sin agregar ESLint al proyecto: `mobile/scripts/check-contrast.mjs` incluye un paso que falla si algún archivo de `app/` o `src/` tiene una línea que matchee `/^\s+const make[A-Za-z]*Styles\s*=/` — una fábrica indentada es una fábrica declarada dentro de una función. Las fábricas legítimas viven en la columna 0.

### 4. Regla nueva del sistema

`import { colors } from '@/src/theme'` deja de existir. El único acceso a color es `useTheme()` / `useThemeColors()` / `useThemeStyles()`, y `makeStyles` siempre en la columna 0. Se agrega a [mobile/AGENTS.md](../../../mobile/AGENTS.md) y a las convenciones de [docs/superpowers/specs/README.md](README.md).

## Migración archivo por archivo

25 archivos con `colors.*`: **10** primitivos en `src/ui/`, **6** en `app/(tabs)/`, **9** en el resto de `app/`. Todos siguen el mismo patrón mecánico. Los tokens listados son los que cada archivo usa hoy.

### Primitivos — `mobile/src/ui/` (Fase 1) — 11 tocados, 10 con color

| Archivo | Tokens | Cambio adicional al patrón |
|---|---|---|
| [Text.tsx](../../../mobile/src/ui/Text.tsx) | `attention brand danger faint ink muted onBrand positive warning` | `Tone` gana `'expense'`, pierde `'warning'`. El mapa `tones` pasa a construirse desde `useThemeColors()`. |
| [Money.tsx](../../../mobile/src/ui/Money.tsx) | — (delega en `Txt`) | Sin cambios de estilo; hereda el tono nuevo. |
| [Button.tsx](../../../mobile/src/ui/Button.tsx) | `attentionEdge attentionSoft border brand brandPressed onBrand surface surfaceRaised` | Tres `StyleSheet.create` a fusionar en una fábrica. `destructive` pasa a borde `danger` + presionado `dangerSoft`. |
| [Card.tsx](../../../mobile/src/ui/Card.tsx) | `attention border surface surfaceRaised` | La regla de margen (`attention`) queda ámbar. |
| [ListRow.tsx](../../../mobile/src/ui/ListRow.tsx) | `attention border surface surfaceRaised` | Ídem. |
| [Chip.tsx](../../../mobile/src/ui/Chip.tsx) | `border brand brandSoft surface surfaceRaised` | Ninguno. |
| [Field.tsx](../../../mobile/src/ui/Field.tsx) | `attentionEdge border brand faint ink surfaceSunken` | Borde de error pasa a `danger`. |
| [Section.tsx](../../../mobile/src/ui/Section.tsx) | `attention attentionSoft border brand brandSoft muted positive positiveSoft surfaceRaised warning warningSoft` | `BadgeTone` pierde `'warning'`, gana `'expense'`. |
| [Screen.tsx](../../../mobile/src/ui/Screen.tsx) | `bg border` | Ninguno. |
| [Sheet.tsx](../../../mobile/src/ui/Sheet.tsx) | `borderStrong surface` | Ninguno. |
| [Wordmark.tsx](../../../mobile/src/ui/Wordmark.tsx) | `brand` | Ninguno. |

### Tabs (Fase 2) — 6 archivos

| Archivo | Tokens | Cambio adicional |
|---|---|---|
| [(tabs)/_layout.tsx](../../../mobile/app/(tabs)/_layout.tsx) | `attention bg border brand brandPressed faint onBrand` | `screenOptions` se arma dentro del componente con `useThemeColors()`. Badge de pendientes: fondo `attention` (ámbar), texto `colors.bg`. |
| [(tabs)/index.tsx](../../../mobile/app/(tabs)/index.tsx) | `border borderStrong brand ink muted surface surfaceRaised` | Ver "Cambios de pantalla". |
| [(tabs)/movements.tsx](../../../mobile/app/(tabs)/movements.tsx) | `border brand muted surface` | Tono del monto por tipo. |
| [(tabs)/reports.tsx](../../../mobile/app/(tabs)/reports.tsx) | `attention brand muted surface surfaceRaised surfaceSunken warning` | Ver "Cambios de pantalla". `barColor` deja de ser función de módulo y pasa a recibir `Colors`. |
| [(tabs)/new-movement.tsx](../../../mobile/app/(tabs)/new-movement.tsx) | `attentionEdge attentionSoft border brand faint ink surface` | Archivo más grande (491 líneas): migrar con cuidado, es el de mayor riesgo de token perdido. |
| [(tabs)/settings.tsx](../../../mobile/app/(tabs)/settings.tsx) | `border faint surface surfaceRaised` | **Sección "Apariencia" nueva** (Fase 6). |

### Resto (Fase 3) — 9 con color, 3 sin cambios

| Archivo | Tokens |
|---|---|
| [_layout.tsx](../../../mobile/app/_layout.tsx) | `bg border brand ink` — además `navTheme`, `stackHeader` y `StatusBar` (Fase 4) |
| [movement/[id].tsx](../../../mobile/app/movement/[id].tsx) | `attentionEdge attentionSoft border brand surface` |
| [wallets.tsx](../../../mobile/app/wallets.tsx) | `brand muted surface` |
| [clients.tsx](../../../mobile/app/clients.tsx) | `brand muted surface` |
| [categories.tsx](../../../mobile/app/categories.tsx) | `brand muted surface` |
| [receivables.tsx](../../../mobile/app/receivables.tsx) | `brand muted surface` |
| [integrations.tsx](../../../mobile/app/integrations.tsx) | `attentionEdge attentionSoft` |
| [onboarding.tsx](../../../mobile/app/onboarding.tsx) | `attentionEdge attentionSoft brand faint` |
| [(auth)/_layout.tsx](../../../mobile/app/(auth)/_layout.tsx) | `bg ink` |
| [(auth)/login.tsx](../../../mobile/app/(auth)/login.tsx) | solo `spacing` / `type` — sin cambios de color |
| [(auth)/register.tsx](../../../mobile/app/(auth)/register.tsx) | solo `spacing` / `type` — sin cambios de color |
| [+not-found.tsx](../../../mobile/app/+not-found.tsx) | solo `spacing` / `type` — sin cambios de color |

## Cambios de pantalla

Esto es lo que resuelve el problema reportado. La migración de arriba solo habilita el tema; sin esta sección los números siguen siendo indistinguibles.

### Helper compartido

Nuevo en [mobile/src/lib/format.ts](../../../mobile/src/lib/format.ts) (o `movement.ts` si crece):

```ts
import type { Movement } from '@/src/api/types'
import type { Tone } from '@/src/ui'

/** Ingresos y cobros entran; gastos salen; transferencias y facturas son neutras. */
export function toneForType(type: Movement['type']): Tone {
  if (type === 'income' || type === 'collection') return 'positive'
  if (type === 'expense') return 'expense'
  return 'muted'
}
```

Reemplaza la lógica inline duplicada en [index.tsx:293](../../../mobile/app/(tabs)/index.tsx#L293), `movements.tsx` y `movement/[id].tsx`. Las transferencias pasan de `ink` a `muted`: no son ni entrada ni salida y no deben competir visualmente con las que sí lo son.

### Inicio — [(tabs)/index.tsx](../../../mobile/app/(tabs)/index.tsx)

1. **Últimos movimientos** ([:288-299](../../../mobile/app/(tabs)/index.tsx#L288-L299)): `tone={toneForType(item.type)}`. Un gasto pasa de blanco a rojo con `-`.
2. **Barras de categoría** ([:378-381](../../../mobile/app/(tabs)/index.tsx#L378-L381)): `barFill` pasa de `borderStrong` a `expense`; `barFillLead` deja de existir y la primera se distingue con `opacity: 1` contra `opacity: 0.55` del resto. Se borra el comentario *"se marca por jerarquía, no por color"* — la decisión se revierte a conciencia, porque la sección se llama "En qué se te fue este mes" y todo lo que hay ahí es gasto.
3. **Saldo principal** ([:180](../../../mobile/app/(tabs)/index.tsx#L180)): sigue en `ink`. Es un saldo, no un flujo; no lleva signo ni color.
4. **"Te deben" vencido** ([:206-210](../../../mobile/app/(tabs)/index.tsx#L206-L210)): `tone="attention"` — ahora ámbar. Es lo que pide una acción, no un gasto.
5. **Banners de pendientes y monotributo** ([:143-176](../../../mobile/app/(tabs)/index.tsx#L143-L176)): `Card attention` mantiene la regla de margen, ahora ámbar.

### Reportes — [(tabs)/reports.tsx](../../../mobile/app/(tabs)/reports.tsx)

1. **`TotalCard`**: la prop `tone` pasa de `'ink' | 'positive'` a `Tone`. "Facturaste" → `positive`; **"Gastaste" → `expense`** (hoy es tinta neutra, indistinguible de "Te queda libre"); "Te queda libre" → `ink` si es ≥ 0, `expense` si es negativo.
2. **`barColor`** ([:28-32](../../../mobile/app/(tabs)/reports.tsx#L28-L32)): `exceeded → danger`, `warning → attention`, resto `→ brand`. Deja de ser función de módulo y recibe `Colors`.
3. **"Excedido"** ([:229-232](../../../mobile/app/(tabs)/reports.tsx#L229-L232)): `tone="danger"` cuando `remaining < 0`; `ink` si no. Hoy usa `attention`, que ahora significa "todavía estás a tiempo".
4. **Desglose por moneda dentro de cada tarjeta** ([:68-78](../../../mobile/app/(tabs)/reports.tsx#L68-L78)): hereda el `tone` de la tarjeta padre en vez de quedar siempre en `ink`, para que el desglose de "Gastaste" se lea como gasto.

### Movimientos — [(tabs)/movements.tsx](../../../mobile/app/(tabs)/movements.tsx)

`tone={toneForType(item.type)}` en el `LedgerCell`. Es la pantalla que más se beneficia: hoy es una pared de números blancos.

### Detalle — [movement/[id].tsx](../../../mobile/app/movement/[id].tsx)

Mismo helper en el monto principal.

## Plataforma

| Qué | Dónde | Cambio |
|---|---|---|
| Esquema de la app | [app.json:9](../../../mobile/app.json#L9) | `"userInterfaceStyle": "automatic"`. Sin esto, iOS reporta siempre `dark` a `useColorScheme` y el modo `Automático` queda muerto. |
| Tema de navegación | [_layout.tsx:20-31](../../../mobile/app/_layout.tsx#L20-L31) | `navTheme` se arma dentro de `RootLayout` con `useThemeColors()`, alternando `DarkTheme` / `DefaultTheme` según `name`. |
| Cabecera de stack | [_layout.tsx:34-41](../../../mobile/app/_layout.tsx#L34-L41) | `stackHeader` pasa de `const` de módulo a `useMemo` dentro del componente. |
| Barra de estado | [_layout.tsx:105](../../../mobile/app/_layout.tsx#L105) | `<StatusBar style={name === 'dark' ? 'light' : 'dark'} />`. |
| Fondo del documento web | [+html.tsx:31-35](../../../mobile/app/+html.tsx#L31-L35) | El CSS crudo pasa a `@media (prefers-color-scheme: light) { body { background-color: #F6F6F4 } }` con `#141414` por defecto. **Limitación conocida:** este CSS se resuelve antes de que la app lea AsyncStorage, así que en web un usuario con preferencia manual opuesta al sistema puede ver un flash del fondo del sistema. Aceptado; la alternativa (script inline que lea `localStorage`) queda fuera de alcance. |
| Splash y adaptive icon | [app.json:26-36](../../../mobile/app.json#L26-L36) | Verificado en expo-splash-screen de SDK 57: el plugin acepta `dark.backgroundColor` / `dark.image`; el splash claro usa `#F6F6F4` a nivel raíz y el oscuro `#141414` en `dark`. `android.adaptiveIcon.backgroundColor` queda en el oscuro (un color único por definición). |
| `expo.backgroundColor` | [app.json:44](../../../mobile/app.json#L44) | `#141414` (nuevo `bg` oscuro). |

## Ajustes — sección "Apariencia"

Nueva `Section` en [(tabs)/settings.tsx](../../../mobile/app/(tabs)/settings.tsx), arriba de "Cuenta":

```
APARIENCIA
┌─────────────────────────────────┐
│  [ Automático ] [ Claro ] [ Oscuro ]  │   ← ChipRow, chip seleccionado en brandSoft
└─────────────────────────────────┘
Automático sigue el ajuste de tu teléfono.
```

Reusa `ChipRow` / `Chip` ([src/ui/Chip.tsx](../../../mobile/src/ui/Chip.tsx)) tal como lo hace el selector de categoría de monotributo en Reportes. Sin componente nuevo. `accessibilityState={{ selected }}` ya lo maneja `Chip`.

## Plan de ejecución

```
Fase 0  Tokens + provider + script de contraste + chequeo de makeStyles
          │
          ├──> Fase 1  src/ui/ (10 archivos)     ─┐
          │                                        ├──> Fase 5  Semántica de color
          ├──> Fase 4  Plataforma (app.json, …)   ─┤              en pantallas
          │                                        │
          └──> Fase 2  Tabs (6) ──> Fase 3  Resto (9) ─┘
                                          │
                                          └──> Fase 6  Ajustes: selector
```

**Por qué este orden:** Fase 0 define el contrato de tipos, así que todo lo demás compila contra algo estable. Fase 1 va primero porque los 10 primitivos son de donde toman color las 15 rutas: migrarlos después obligaría a tocar cada pantalla dos veces. Fase 4 es independiente y puede ir en paralelo. Fase 5 se hace al final a propósito: cambiar la semántica de color **antes** de la migración implicaría hacerlo dos veces, una en cada forma del código. Fase 6 va última porque el selector no sirve de nada hasta que las Fases 1–3 hagan que el cambio de tema se vea.

**Entre Fase 3 y Fase 5 la app queda funcionalmente completa en ambos temas pero visualmente idéntica a hoy.** Ese es un buen punto de corte para revisar.

## Criterios de aceptación

1. `grep -rl "colors\." mobile/app mobile/src` devuelve **cero** archivos. Hoy devuelve 25.
2. Toda ocurrencia de `StyleSheet.create` está dentro de una fábrica `make*Styles` declarada en la columna 0: `grep -rnE "^\s+const make[A-Za-z]*Styles\s*=" mobile/app mobile/src` devuelve cero líneas.
3. Con la app abierta en Inicio, cambiar el ajuste de Apariencia de `Oscuro` a `Claro` repinta la pantalla **sin reiniciar la app y sin desmontar la navegación** (no se pierde la pantalla actual ni el scroll).
4. Con Apariencia en `Automático`, cambiar el tema del sistema operativo mientras la app está en primer plano repinta la app.
5. La preferencia sobrevive a cerrar y reabrir la app: elegir `Claro`, matar el proceso, reabrir, y la app arranca en claro **sin flash de oscuro**.
6. Las **15 rutas navegables** se renderizan en ambos temas sin ningún elemento con contraste texto/fondo por debajo de 3.0:1. La lista completa, que es la checklist de QA:

   | # | Ruta | # | Ruta |
   |---|---|---|---|
   | 1 | `(auth)/login` | 9 | `categories` |
   | 2 | `(auth)/register` | 10 | `clients` |
   | 3 | `onboarding` | 11 | `wallets` |
   | 4 | `(tabs)/index` | 12 | `receivables` |
   | 5 | `(tabs)/movements` | 13 | `integrations` |
   | 6 | `(tabs)/new-movement` | 14 | `movement/[id]` |
   | 7 | `(tabs)/reports` | 15 | `+not-found` |
   | 8 | `(tabs)/settings` | | |

   Y dentro de ellas: el `Sheet` de `new-movement`, los `EmptyState` de Inicio y Movimientos, el estado de error de Reportes, y la cabecera de stack de las rutas 9–14.
7. `node mobile/scripts/check-contrast.mjs` termina con código 0: valida los 5 umbrales de la tabla "Umbrales que se exigen" contra ambos temas y falla listando cada par que no llega.
8. En Movimientos, con al menos un ingreso y un gasto cargados: el monto del ingreso es verde con `+`, el del gasto es rojo con `-`, y el de una transferencia es `muted` sin signo.
9. Ningún `<Money>` ni `<LedgerCell>` con `tone="positive"` o `tone="expense"` se renderiza sin signo. Se verifica por lectura de los 4 call sites (`index.tsx`, `movements.tsx`, `movement/[id].tsx`, `reports.tsx`).
10. En Reportes, las tres tarjetas del mes tienen tres tratamientos de color distintos: "Facturaste" verde, "Gastaste" rojo, "Te queda libre" tinta neutra (o rojo si es negativo).
11. La barra de monotributo es azul por debajo del 80%, ámbar entre 80% y 100%, y roja por encima del 100%.
12. Se cumple la regla de forma: `expense` aparece **solo** como color de texto de montos y como relleno de las barras de categoría de Inicio; `danger` aparece **solo** como relleno, borde o regla de margen, con una única excepción de texto — el monto rotulado "Excedido" en Reportes. "Vencido" en Inicio y en `receivables` va en `attention` (ámbar), **no** en `danger`: todavía se puede cobrar.
13. `npx tsc --noEmit` en `mobile/` pasa sin errores.
14. Sin regresión funcional: login, alta de movimiento, filtros de Movimientos, selector de categoría de monotributo y cierre de sesión funcionan igual que antes.

## Plan de testing

`mobile/` hoy no tiene runner de tests (no hay vitest ni jest en [package.json](../../../mobile/package.json)). Este spec **no** introduce uno: sería una decisión de infraestructura que merece su propio spec. Lo que sí introduce es una verificación automatizable donde tiene sentido.

| Capa | Qué | Cómo | Cantidad |
|---|---|---|---|
| Automático | Contraste de los dos temas contra los 5 umbrales | `mobile/scripts/check-contrast.mjs`, invocado por `npm run check:contrast`. Importa `darkColors` / `lightColors` reales, no una copia. | +1 script |
| Automático | Tipos | `npx tsc --noEmit`. El tipo `Colors` compartido garantiza paridad de tokens entre temas. | existente |
| Automático | Regla de `makeStyles` en columna 0 | Paso dentro de `check-contrast.mjs`: falla si `^\s+const make[A-Za-z]*Styles\s*=` matchea. Sin agregar ESLint. | +1 |
| Manual | Las 15 rutas del criterio 6, en ambos temas | Recorrido con esa checklist; capturas de Inicio / Movimientos / Reportes en claro y oscuro para el PR. | 15 × 2 |
| Manual | Persistencia y arranque | Criterios 3, 4, 5. | 3 |
| Manual | Regresión funcional | Criterio 14. | 5 flujos |

## Rollback

El cambio es puramente de presentación: no toca backend, ni schema, ni contratos de API, ni AsyncStorage salvo por una clave nueva (`monedapp.theme`) que es ignorable. Revertir el PR alcanza y no deja estado inconsistente: una clave `monedapp.theme` huérfana en el dispositivo no rompe la versión anterior, que simplemente no la lee.

Si el problema aparece después de mergear y solo afecta al tema claro, el corte barato es forzar `preference: 'dark'` y ocultar la sección Apariencia — un cambio de dos líneas que deja intacta la migración a `useTheme()`, que es el 80% del trabajo.

## Esfuerzo

| Fase | Trabajo | Humano | Con agente |
|---|---|---|---|
| 0 | Tokens, `Colors`, provider, `useThemeStyles`, script de contraste, lint | 4h | 25min |
| 1 | 11 archivos de `src/ui/` (10 con color) | 3h | 20min |
| 2 | 6 archivos de tabs (incluye `new-movement.tsx`, 491 líneas) | 5h | 30min |
| 3 | 9 archivos restantes con color | 4h | 20min |
| 4 | Plataforma: app.json, navTheme, StatusBar, +html, splash | 3h | 20min |
| 5 | Semántica de color en pantallas + `toneForType` | 3h | 20min |
| 6 | Sección Apariencia en Ajustes | 1h | 10min |
| — | QA manual en ambos temas, 15 rutas | 4h | 4h |
| | **Total** | **~27h** | **~7h** |

El QA manual no se comprime: hay que mirar las pantallas.

## Archivos

| Archivo | Cambio |
|---|---|
| `mobile/src/theme.ts` | **Eliminado**, reemplazado por `mobile/src/theme/` |
| `mobile/src/theme/palettes.ts` | **Nuevo** — tipo `Colors`, `darkColors`, `lightColors` |
| `mobile/src/theme/tokens.ts` | **Nuevo** — `spacing`, `radius`, `fonts`, `type`, `RULE_WIDTH` movidos tal cual |
| `mobile/src/theme/ThemeProvider.tsx` | **Nuevo** — provider, `useTheme`, `useThemeColors`, `useThemeStyles`, persistencia |
| `mobile/src/theme/index.ts` | **Nuevo** — barrel |
| `mobile/scripts/check-contrast.mjs` | **Nuevo** — umbrales de contraste + regla de `makeStyles` |
| `mobile/package.json` | Script `check:contrast` |
| `mobile/app.json` | `userInterfaceStyle: automatic`, `backgroundColor`, splash, adaptiveIcon |
| `mobile/app/+html.tsx` | `prefers-color-scheme` en vez de `#171717` fijo |
| `mobile/app/_layout.tsx` | `navTheme`, `stackHeader`, `StatusBar`, `ThemeProvider`, gate de carga |
| `mobile/src/ui/*.tsx` (10 con color) | Migración a `makeStyles` + `useThemeStyles` |
| `mobile/src/ui/Text.tsx` | `Tone`: `+expense`, `−warning` |
| `mobile/src/ui/Section.tsx` | `BadgeTone`: `+expense`, `−warning` |
| `mobile/src/ui/Button.tsx` | 3 `StyleSheet.create` → 1 fábrica; `destructive` en `danger` |
| `mobile/app/**/*.tsx` (15 con color: 6 tabs + 9 resto) | Migración a `makeStyles` + `useThemeStyles` |
| `mobile/app/(tabs)/index.tsx` | `toneForType`, barras de categoría en `expense` |
| `mobile/app/(tabs)/reports.tsx` | `TotalCard.tone`, `barColor`, "Excedido" en `danger` |
| `mobile/app/(tabs)/movements.tsx` | `toneForType` |
| `mobile/app/movement/[id].tsx` | `toneForType` |
| `mobile/app/(tabs)/settings.tsx` | Sección "Apariencia" |
| `mobile/src/lib/format.ts` | `toneForType` |
| `mobile/AGENTS.md` | Regla: nada de `colors` importado como constante |
| `docs/superpowers/specs/README.md` | Fila del spec 7 |

## Fuera de alcance

- **Rediseño.** No cambian tipografía, escala tipográfica, espaciado, radios, densidad de información, iconografía ni layout de ninguna pantalla. Solo color y su conmutación.
- **Modo alto contraste o modo daltónico dedicado.** La redundancia de signo + etiqueta cubre el caso base; un modo dedicado es otro spec.
- **Animar la transición entre temas.** El cambio es instantáneo. Un crossfade requiere capturar el árbol anterior y es desproporcionado.
- **Temas por usuario en el backend.** La preferencia es local al dispositivo. Nada se guarda en `User`.
- **Runner de tests en `mobile/`.** El proyecto no tiene uno; agregarlo es una decisión de infraestructura con su propio costo y merece su propio spec.
- **Eliminar el flash de fondo en web** para usuarios con preferencia manual opuesta al sistema. Documentado como limitación conocida arriba.

## Relacionados

- [Spec 6 — Reportes mensuales + monotributo](06-reportes-monotributo.md) — este spec cambia el color de las tarjetas y de la barra de techo que aquel introdujo. Si el 6 todavía está en vuelo, el 7 se mergea después.
- [Spec 5 — Cuentas por cobrar](05-cuentas-por-cobrar.md) — "Vencido" pasa de arcilla a ámbar.
