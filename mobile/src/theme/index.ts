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
