import { radius, spacing, useThemeStyles, type Colors } from '@/src/theme'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Txt } from './Text'

type ChipProps = {
  label: string
  selected?: boolean
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}

export function Chip({ label, selected, onPress, style }: ChipProps) {
  const styles = useThemeStyles(makeStyles)
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
  const styles = useThemeStyles(makeStyles)
  return <View style={[styles.row, style]}>{children}</View>
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    chip: {
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      minHeight: 36,
      justifyContent: 'center',
    },
    // Seleccionado en tinte, no en relleno pleno: el relleno queda para las acciones.
    chipSelected: { backgroundColor: c.brandSoft, borderColor: c.brand },
    pressed: { backgroundColor: c.surfaceRaised },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  })
