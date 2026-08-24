import { spacing, useThemeStyles, type Colors } from '@/src/theme'
import type { ReactNode } from 'react'
import {
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'

type Props = {
  children: ReactNode
  /** Envuelve el contenido en un ScrollView con el padding estándar. */
  scroll?: boolean
  refreshControl?: React.ReactElement<RefreshControlProps>
  contentStyle?: StyleProp<ViewStyle>
  /** Bordes seguros a respetar. Las pantallas con tab bar no necesitan 'bottom'. */
  edges?: readonly Edge[]
  /** Elemento fijo al pie, fuera del scroll (barra de acción). */
  footer?: ReactNode
}

export function Screen({ children, scroll, refreshControl, contentStyle, edges = ['top'], footer }: Props) {
  const styles = useThemeStyles(makeStyles)
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, contentStyle]}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, contentStyle]}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  )
}

export const screenPadding = spacing.xl

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    flex: { flex: 1 },
    content: {
      paddingHorizontal: screenPadding,
      paddingTop: spacing.sm,
      paddingBottom: spacing.huge,
    },
    footer: {
      paddingHorizontal: screenPadding,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.bg,
    },
  })
