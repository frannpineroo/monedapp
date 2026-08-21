import { apiRequest } from '@/src/api/client'
import type { MonthlySummary } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatArs } from '@/src/lib/format'
import { colors, spacing } from '@/src/theme'
import { Card, Money, Screen, Section, Txt } from '@/src/ui'
import Feather from '@expo/vector-icons/Feather'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native'

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Flecha del selector de mes. Área de toque grande, sin fondo. */
function MonthArrow({ name, onPress }: { name: 'chevron-left' | 'chevron-right'; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}
    >
      <Feather name={name} size={20} color={colors.muted} />
    </Pressable>
  )
}

/** Tarjeta de total: rótulo, monto en ARS y el desglose por moneda debajo. */
function TotalCard({
  label,
  totalArs,
  detail,
  tone = 'ink',
  children,
}: {
  label: string
  totalArs: number
  detail?: { currency: string; value: number }[]
  tone?: 'ink' | 'positive'
  children?: React.ReactNode
}) {
  return (
    <Card>
      <Txt variant="label" tone="faint">
        {label}
      </Txt>
      <Money value={totalArs} variant="amountLarge" tone={tone} />
      <Txt variant="label" tone="faint">
        ARS
      </Txt>
      {detail && detail.length > 0 ? (
        <View style={styles.detail}>
          {detail.map((row) => (
            <View key={row.currency} style={styles.detailRow}>
              <Txt variant="label" tone="faint">
                {row.currency}
              </Txt>
              <Money value={row.value} />
            </View>
          ))}
        </View>
      ) : null}
      {children}
    </Card>
  )
}

export default function ReportsScreen() {
  const { accessToken } = useAuth()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))

  const summary = useQuery({
    queryKey: ['monthly-summary', month],
    queryFn: () =>
      apiRequest<MonthlySummary>(`/reports/monthly-summary?month=${month}`, {
        token: accessToken,
      }),
    enabled: !!accessToken,
  })

  const byCurrency = Object.entries(summary.data?.byCurrency ?? {})
  /** El desglose por moneda sobra si toda la plata del mes fue en ARS. */
  const foreign = (key: 'income' | 'expense') =>
    byCurrency.filter(([currency, v]) => v[key] > 0 && currency !== 'ARS').map(([currency, v]) => ({
      currency,
      value: v[key],
    }))

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={summary.isFetching}
          onRefresh={() => summary.refetch()}
          tintColor={colors.muted}
          colors={[colors.brand]}
          progressBackgroundColor={colors.surface}
        />
      }
    >
      <View style={styles.header}>
        <Txt variant="title">Reportes</Txt>
      </View>

      <View style={styles.monthRow}>
        <MonthArrow name="chevron-left" onPress={() => setMonth((m) => shiftMonth(m, -1))} />
        <Txt variant="heading" align="center" style={styles.month}>
          {monthLabel(month)}
        </Txt>
        <MonthArrow name="chevron-right" onPress={() => setMonth((m) => shiftMonth(m, 1))} />
      </View>

      {summary.isError ? (
        <Txt variant="caption" tone="attention" style={styles.error}>
          No pudimos traer el reporte. Deslizá para reintentar.
        </Txt>
      ) : null}

      {summary.isLoading || !summary.data ? (
        <ActivityIndicator color={colors.brand} style={styles.loader} />
      ) : (
        <>
          <Section title="El mes" style={styles.cards}>
            <TotalCard
              label="Facturaste"
              totalArs={summary.data.incomeArs}
              tone="positive"
              detail={foreign('income')}
            />
            <TotalCard
              label="Gastaste"
              totalArs={summary.data.expenseArs}
              detail={foreign('expense')}
            />
            <TotalCard label="Te queda libre" totalArs={summary.data.netAfterTax}>
              <Txt variant="caption" tone="muted" style={styles.note}>
                Menos la cuota de monotributo ({formatArs(summary.data.tax.monthlyFee)}
                {summary.data.tax.category ? `, categoría ${summary.data.tax.category}` : ''})
              </Txt>
              {summary.data.tax.source === 'suggested' ? (
                <Txt variant="caption" tone="brand">
                  Categoría estimada: elegí la tuya abajo para que el número sea exacto.
                </Txt>
              ) : null}
            </TotalCard>
          </Section>
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.lg },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  month: { flex: 1, textTransform: 'capitalize' },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowPressed: { backgroundColor: colors.surfaceRaised },
  cards: { gap: spacing.md },
  detail: { marginTop: spacing.md, gap: spacing.xs },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  note: { marginTop: spacing.sm },
  loader: { marginTop: spacing.xxxl },
  error: { marginBottom: spacing.lg },
})
