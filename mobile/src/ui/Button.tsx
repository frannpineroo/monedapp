import { colors, radius, spacing } from '@/src/theme'
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
        pressed && !inactive && pressedStyles[variant],
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onBrand : colors.brand} />
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

const styles = StyleSheet.create({
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
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.surface, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent' },
  destructive: { backgroundColor: 'transparent', borderColor: colors.attentionEdge },
  disabled: { opacity: 0.45 },
})

const pressedStyles = StyleSheet.create({
  primary: { backgroundColor: colors.brandPressed },
  secondary: { backgroundColor: colors.surfaceRaised },
  ghost: { opacity: 0.6 },
  destructive: { backgroundColor: colors.attentionSoft },
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

const linkStyles = StyleSheet.create({
  pressed: { opacity: 0.6 },
})
