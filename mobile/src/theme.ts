/**
 * Sistema de diseño de MonedApp — "Grafito".
 *
 * Toda la paleta es apagada: grises de grafito y tres colores desaturados que
 * sólo aparecen cuando significan algo. Nada saturado ni brillante.
 *
 * Reglas del sistema:
 * - `brand` (pizarra) es sólo acción y estado activo. Nunca alerta.
 * - `attention` (arcilla) es sólo lo que pide una acción: vencido, para
 *   revisar. Es el color de la regla de margen.
 * - `positive` (salvia) es sólo ingresos; los gastos van en tinta neutra.
 * - Los montos se alinean siempre a la derecha con cifras tabulares: la app
 *   entera lee como una columna de libro contable.
 */

export const palette = {
  graphite: '#171717',
  ink900: '#141414',
  ink850: '#1F1F1F',
  ink800: '#262626',
  ink700: '#2E2E2E',
  ink600: '#3A3A3A',
  ink300: '#6E6E6B',
  ink200: '#9B9B98',
  ink050: '#E4E4E3',

  /** Pizarra: azul grisáceo apagado. Único color de acción. */
  slate400: '#6E8CA3',
  slate500: '#5E7A8F',
  slateTint: '#192227',
  slateEdge: '#2E4552',
  /** Texto sobre pizarra: la tinta oscura contrasta mejor que el blanco. */
  onSlate: '#12171A',

  /** Arcilla: rojo terracota apagado. Sólo para lo que pide atención. */
  clay400: '#B0746C',
  clayTint: '#241B1A',
  clayEdge: '#42302D',

  /** Salvia: verde apagado. Sólo para ingresos. */
  sage400: '#7E9C81',
  sageTint: '#1A211B',

  ochre400: '#A98F5F',
  ochreTint: '#221F16',
}

export const colors = {
  /** Lienzo de la app. */
  bg: palette.graphite,
  /** Tarjetas y filas. */
  surface: palette.ink850,
  /** Campos de formulario y superficies hundidas. */
  surfaceSunken: palette.ink900,
  /** Estado presionado / superficie elevada. */
  surfaceRaised: palette.ink800,

  border: palette.ink700,
  borderStrong: palette.ink600,

  ink: palette.ink050,
  muted: palette.ink200,
  faint: palette.ink300,

  /** Acción principal y estado activo. Nunca significa alerta. */
  brand: palette.slate400,
  brandPressed: palette.slate500,
  brandSoft: palette.slateTint,
  brandEdge: palette.slateEdge,
  onBrand: palette.onSlate,

  /** Pide una acción: vencido, para revisar. Es la regla de margen. */
  attention: palette.clay400,
  attentionSoft: palette.clayTint,
  attentionEdge: palette.clayEdge,

  positive: palette.sage400,
  positiveSoft: palette.sageTint,

  warning: palette.ochre400,
  warningSoft: palette.ochreTint,

  danger: palette.clay400,

  // Alias heredados: pantallas viejas siguen compilando mientras se migran.
  accent: palette.slate400,
  accentSoft: palette.slateTint,
  income: palette.sage400,
  expense: palette.ink050,
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
}

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 999,
}

/**
 * En React Native las fuentes propias no sintetizan peso: cada peso es una
 * familia distinta. Nunca uses `fontWeight` junto con estas familias.
 */
export const fonts = {
  regular: 'Archivo_400Regular',
  medium: 'Archivo_500Medium',
  semibold: 'Archivo_600SemiBold',
  bold: 'Archivo_700Bold',
}

const tabular = { fontVariant: ['tabular-nums' as const] }

export const type = {
  /** Saldo principal. Un solo uso por pantalla. */
  display: {
    fontFamily: fonts.bold,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -0.8,
    ...tabular,
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
  },
  heading: {
    fontFamily: fonts.semibold,
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 22,
  },
  bodyMedium: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 22,
  },
  bodyStrong: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 22,
  },
  /** Monto en fila de lista. Siempre alineado a la derecha. */
  amount: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 20,
    ...tabular,
  },
  /** Monto destacado dentro de una tarjeta. */
  amountLarge: {
    fontFamily: fonts.semibold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.6,
    ...tabular,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  captionStrong: {
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  /** Rótulo de sección. Va en mayúsculas. */
  label: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  button: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: -0.1,
  },
}

/** Grosor de la regla de margen que marca las filas que piden atención. */
export const RULE_WIDTH = 3
