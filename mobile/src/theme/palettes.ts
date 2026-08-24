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
