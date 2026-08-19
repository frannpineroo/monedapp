import { colors, type } from '@/src/theme'
import { Text as RNText, type TextProps, type TextStyle } from 'react-native'

export type TypeVariant = keyof typeof type
export type Tone =
  | 'ink'
  | 'muted'
  | 'faint'
  | 'brand'
  | 'attention'
  | 'positive'
  | 'danger'
  | 'warning'
  | 'onBrand'

const tones: Record<Tone, string> = {
  ink: colors.ink,
  muted: colors.muted,
  faint: colors.faint,
  brand: colors.brand,
  attention: colors.attention,
  positive: colors.positive,
  danger: colors.danger,
  warning: colors.warning,
  onBrand: colors.onBrand,
}

export type TxtProps = TextProps & {
  variant?: TypeVariant
  tone?: Tone
  align?: TextStyle['textAlign']
}

/** Único punto de entrada de texto: garantiza familia, escala y tono del sistema. */
export function Txt({ variant = 'body', tone = 'ink', align, style, ...rest }: TxtProps) {
  return <RNText {...rest} style={[type[variant], { color: tones[tone] }, align ? { textAlign: align } : null, style]} />
}

/** Rótulo de sección en mayúsculas. */
export function Label({ tone = 'faint', style, ...rest }: Omit<TxtProps, 'variant'>) {
  return <Txt variant="label" tone={tone} style={style} {...rest} />
}
