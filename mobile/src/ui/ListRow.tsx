import { colors, radius, spacing } from '@/src/theme'
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
  return <View style={styles.divider} />
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    minHeight: 64,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  rule: { width: 3, backgroundColor: colors.attention },
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
    backgroundColor: colors.border,
    marginLeft: spacing.lg,
  },
})
