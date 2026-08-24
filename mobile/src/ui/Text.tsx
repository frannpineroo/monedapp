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
