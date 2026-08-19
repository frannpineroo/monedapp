import { colors, radius, spacing } from '@/src/theme'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

type Props = {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  /** Marca la tarjeta como algo que pide atención: regla roja al margen. */
  attention?: boolean
  onPress?: () => void
  padded?: boolean
}

export function Card({ children, style, attention, onPress, padded = true }: Props) {
  const content = (
    <>
      {attention ? <View style={styles.rule} /> : null}
      <View style={[padded ? styles.padding : null, styles.body]}>{children}</View>
    </>
  )

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      >
        {content}
      </Pressable>
    )
  }

  return <View style={[styles.card, style]}>{content}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  body: { flex: 1 },
  padding: { padding: spacing.lg },
  rule: { width: 3, backgroundColor: colors.attention },
})
