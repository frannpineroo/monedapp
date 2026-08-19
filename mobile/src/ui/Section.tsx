import { colors, radius, spacing } from '@/src/theme'
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

export type BadgeTone = 'neutral' | 'brand' | 'attention' | 'positive' | 'warning'

const badgeColors: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceRaised, fg: colors.muted },
  brand: { bg: colors.brandSoft, fg: colors.brand },
  attention: { bg: colors.attentionSoft, fg: colors.attention },
  positive: { bg: colors.positiveSoft, fg: colors.positive },
  warning: { bg: colors.warningSoft, fg: colors.warning },
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const c = badgeColors[tone]
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Txt variant="label" style={{ color: c.fg }}>
        {label}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
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
    borderColor: colors.border,
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
