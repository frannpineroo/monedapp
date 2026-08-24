/**
 * Tokens de MonedApp que no dependen del tema: espaciado, radios, familias
 * tipográficas y escala de texto. El color vive en palettes.ts.
 */

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
