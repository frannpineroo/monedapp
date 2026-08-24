import { radius, spacing, useThemeStyles, type Colors } from '@/src/theme'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Txt } from './Text'

type Props = {
  title: string
  /** Línea secundaria: tipo, billetera, cliente. */
  meta?: string
  /** Columna derecha, normalmente un LedgerCell. */
  right?: ReactNode
  onPress?: () => void
  /** Regla roja al margen: la fila pide una acción. */
  attention?: boolean
  left?: ReactNode
}

export function ListRow({ title, meta, right, onPress, attention, left }: Props) {
  const styles = useThemeStyles(makeStyles)
  const body = (
    <>
      {attention ? <View style={styles.rule} /> : null}
      <View style={styles.inner}>
        {left}
        <View style={styles.text}>
          <Txt variant="bodyMedium" numberOfLines={1}>
            {title}
          </Txt>
          {meta ? (
            <Txt variant="caption" tone="faint" numberOfLines={1} style={styles.meta}>
              {meta}
            </Txt>
          ) : null}
        </View>
        {right}
      </View>
    </>
  )

  if (!onPress) return <View style={styles.row}>{body}</View>

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {body}
    </Pressable>
  )
}

/** Separador de filas dentro de una misma tarjeta. */
export function RowDivider() {
  const styles = useThemeStyles(makeStyles)
  return <View style={styles.divider} />
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: 'hidden',
      minHeight: 64,
    },
    pressed: { backgroundColor: c.surfaceRaised },
    rule: { width: 3, backgroundColor: c.attention },
    inner: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    text: { flex: 1 },
    meta: { marginTop: 2 },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
      marginLeft: spacing.lg,
    },
  })
