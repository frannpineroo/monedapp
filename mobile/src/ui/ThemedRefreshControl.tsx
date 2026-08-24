import { useThemeColors } from '@/src/theme'
import { RefreshControl, type RefreshControlProps } from 'react-native'

/**
 * Las props se derivan de `RefreshControlProps` a propósito: así el elemento
 * que devuelve este componente es asignable a la prop `refreshControl` de
 * ScrollView y de FlatList, que la tipan como
 * `React.ReactElement<RefreshControlProps>`.
 */
type Props = Pick<RefreshControlProps, 'refreshing' | 'onRefresh'>

/**
 * El indicador de "deslizá para actualizar", ya pintado con el tema. Existe
 * porque siete pantallas repetían las mismas cuatro props de color.
 */
export function ThemedRefreshControl({ refreshing, onRefresh }: Props) {
  const c = useThemeColors()
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={c.muted}
      colors={[c.brand]}
      progressBackgroundColor={c.surface}
    />
  )
}
