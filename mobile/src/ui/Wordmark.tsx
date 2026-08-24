import { radius, spacing, useThemeStyles, type Colors } from '@/src/theme'
import { StyleSheet, View } from 'react-native'
import { Txt } from './Text'

/**
 * Marca de MonedApp: el nombre y un sello en color de marca. El sello es la
 * única pieza de color en la pantalla de entrada.
 */
export function Wordmark({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  const styles = useThemeStyles(makeStyles)
  return (
    <View style={styles.row}>
      <Txt variant={size === 'lg' ? 'display' : 'title'}>MonedApp</Txt>
      <View style={[styles.seal, size === 'sm' && styles.sealSmall]} />
    </View>
  )
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
    seal: {
      width: 12,
      height: 12,
      borderRadius: radius.sm / 2,
      backgroundColor: c.brand,
      marginBottom: 8,
    },
    sealSmall: { width: 8, height: 8, marginBottom: 6 },
  })
