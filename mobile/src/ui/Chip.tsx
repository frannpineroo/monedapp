import { colors, radius, spacing } from '@/src/theme'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Txt } from './Text'

type ChipProps = {
  label: string
  selected?: boolean
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}

export function Chip({ label, selected, onPress, style }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && !selected && styles.pressed,
        style,
      ]}
    >
      <Txt variant="captionStrong" tone={selected ? 'brand' : 'muted'}>
        {label}
      </Txt>
    </Pressable>
  )
}

export function ChipRow({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 36,
    justifyContent: 'center',
  },
  // Seleccionado en tinte, no en rojo pleno: el rojo lleno queda para las acciones.
  chipSelected: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  pressed: { backgroundColor: colors.surfaceRaised },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
