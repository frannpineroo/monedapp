import { radius, spacing, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
import type { ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Button } from './Button'
import { Txt } from './Text'

type SectionProps = {
  title: string
  action?: ReactNode
  children: ReactNode
  style?: StyleProp<ViewStyle>
}

export function Section({ title, action, children, style }: SectionProps) {
  const styles = useThemeStyles(makeStyles)
  return (
    <View style={[styles.section, style]}>
      <View style={styles.header}>
        <Txt variant="label" tone="faint">
          {title}
        </Txt>
        {action}
      </View>
      {children}
    </View>
  )
}

type EmptyProps = {
  title: string
  /** Qué hacer a continuación. Una pantalla vacía es una invitación a actuar. */
  body?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ title, body, actionLabel, onAction }: EmptyProps) {
  const styles = useThemeStyles(makeStyles)
  return (
    <View style={styles.empty}>
      <Txt variant="bodyStrong">{title}</Txt>
      {body ? (
        <Txt variant="caption" tone="faint" align="center" style={styles.emptyBody}>
          {body}
        </Txt>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" style={styles.emptyAction} />
      ) : null}
    </View>
  )
}

export type BadgeTone = 'neutral' | 'brand' | 'attention' | 'positive' | 'expense'

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  const badgeColors: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: c.surfaceRaised, fg: c.muted },
    brand: { bg: c.brandSoft, fg: c.brand },
    attention: { bg: c.attentionSoft, fg: c.attention },
    positive: { bg: c.positiveSoft, fg: c.positive },
    expense: { bg: c.expenseSoft, fg: c.expense },
  }
  const badge = badgeColors[tone]
  return (
    <View style={[styles.badge, { backgroundColor: badge.bg }]}>
      <Txt variant="label" style={{ color: badge.fg }}>
        {label}
      </Txt>
    </View>
  )
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    section: { gap: spacing.md, marginBottom: spacing.xxl },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 20,
    },
    empty: {
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xxxl,
      paddingHorizontal: spacing.xl,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderStyle: 'dashed',
    },
    emptyBody: { maxWidth: 260 },
    emptyAction: { marginTop: spacing.sm },
    badge: {
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      alignSelf: 'flex-start',
    },
  })
