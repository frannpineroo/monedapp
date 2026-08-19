import { colors, radius, spacing } from '@/src/theme'
import { StyleSheet, View } from 'react-native'
import { Txt } from './Text'

/**
 * Marca de MonedApp: el nombre y un sello rojo. El sello es la única pieza
 * de color en la pantalla de entrada.
 */
export function Wordmark({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  return (
    <View style={styles.row}>
      <Txt variant={size === 'lg' ? 'display' : 'title'}>MonedApp</Txt>
      <View style={[styles.seal, size === 'sm' && styles.sealSmall]} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  seal: {
    width: 12,
    height: 12,
    borderRadius: radius.sm / 2,
    backgroundColor: colors.brand,
    marginBottom: 8,
  },
  sealSmall: { width: 8, height: 8, marginBottom: 6 },
})
