import { apiRequest } from '@/src/api/client'
import type { MonotributoAlert, MonthlySummary, User } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatArs, formatPercent } from '@/src/lib/format'
import { radius, spacing, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
import { Card, Chip, ChipRow, Money, Screen, Section, ThemedRefreshControl, Txt, type Tone } from '@/src/ui'
import Feather from '@expo/vector-icons/Feather'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'

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

/**
 * El techo del monotributo: azul mientras sobra, ámbar cuando aprieta, rojo
 * cuando ya te pasaste. El ámbar es "hacé algo antes"; el rojo es "ya pasó".
 */
function barColor(status: MonotributoAlert['status'], c: Colors): string {
  if (status === 'exceeded') return c.danger
  if (status === 'warning') return c.attention
  return c.brand
}

/** Flecha del selector de mes. Área de toque grande, sin fondo. */
function MonthArrow({ name, onPress }: { name: 'chevron-left' | 'chevron-right'; onPress: () => void }) {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}
    >
      <Feather name={name} size={20} color={c.muted} />
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
  tone?: Tone
  children?: React.ReactNode
}) {
  const styles = useThemeStyles(makeStyles)
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
              <Money value={row.value} tone={tone} />
            </View>
          ))}
        </View>
      ) : null}
      {children}
    </Card>
  )
}

export default function ReportsScreen() {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  const { accessToken, setUser } = useAuth()
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))

  const summary = useQuery({
    queryKey: ['monthly-summary', month],
    queryFn: () =>
      apiRequest<MonthlySummary>(`/reports/monthly-summary?month=${month}`, {
        token: accessToken,
      }),
    enabled: !!accessToken,
  })

  const alert = useQuery({
    queryKey: ['monotributo-alert'],
    queryFn: () =>
      apiRequest<MonotributoAlert>('/reports/monotributo-alert', { token: accessToken }),
    enabled: !!accessToken,
  })

  const setCategory = useMutation({
    mutationFn: (category: string) =>
      apiRequest<User>('/users/me', {
        method: 'PATCH',
        token: accessToken,
        body: { monotributoCategory: category },
      }),
    onSuccess: async (updated) => {
      setUser(updated)
      await queryClient.invalidateQueries({ queryKey: ['monotributo-alert'] })
      await queryClient.invalidateQueries({ queryKey: ['monthly-summary'] })
    },
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
        <ThemedRefreshControl
          refreshing={summary.isFetching || alert.isFetching}
          onRefresh={() => {
            void summary.refetch()
            void alert.refetch()
          }}
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
        <ActivityIndicator color={c.brand} style={styles.loader} />
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
              tone="expense"
              detail={foreign('expense')}
            />
            <TotalCard
              label="Te queda libre"
              totalArs={summary.data.netAfterTax}
              tone={summary.data.netAfterTax < 0 ? 'expense' : 'ink'}
            >
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

          {summary.data.topClients.length > 0 ? (
            <Section title="Quién te pagó">
              <Card>
                {summary.data.topClients.map((client, index) => (
                  <View
                    key={client.id ?? client.name}
                    style={[styles.clientRow, index > 0 && styles.clientRowSpaced]}
                  >
                    <Txt variant="body" numberOfLines={1} style={styles.clientName}>
                      {client.name}
                    </Txt>
                    <Money value={client.totalArs} />
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}

          {alert.data ? (
            <Section title="Monotributo">
              <Card attention={alert.data.status === 'exceeded'}>
                {alert.data.percentUsed !== null ? (
                  <>
                    <Txt variant="caption" tone="muted">
                      Usaste {formatPercent(alert.data.percentUsed)} del techo de la categoría{' '}
                      {alert.data.category ?? alert.data.suggestedCategory} en los últimos 12 meses
                    </Txt>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.min(alert.data.percentUsed, 100)}%`,
                            backgroundColor: barColor(alert.data.status, c),
                          },
                        ]}
                      />
                    </View>
                    {alert.data.remaining !== null ? (
                      <View style={styles.remainingRow}>
                        <Txt variant="label" tone={alert.data.remaining < 0 ? 'danger' : 'faint'}>
                          {alert.data.remaining < 0 ? 'Excedido' : 'Te queda'}
                        </Txt>
                        <Money
                          value={Math.abs(alert.data.remaining)}
                          tone={alert.data.remaining < 0 ? 'danger' : 'ink'}
                        />
                      </View>
                    ) : null}
                  </>
                ) : (
                  <Txt variant="bodyMedium" tone="danger">
                    Te pasaste del techo de todas las categorías.
                  </Txt>
                )}

                <Txt variant="label" tone="faint" style={styles.chipsLabel}>
                  Tu categoría
                </Txt>
                <ChipRow>
                  {alert.data.scales.map((scale) => (
                    <Chip
                      key={scale.category}
                      label={scale.category}
                      selected={alert.data?.category === scale.category}
                      onPress={() => setCategory.mutate(scale.category)}
                    />
                  ))}
                </ChipRow>
                <Txt variant="caption" tone="faint" style={styles.chipsHint}>
                  La cuota de la categoría elegida es la que se descuenta arriba.
                </Txt>
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  )
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
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
    arrowPressed: { backgroundColor: c.surfaceRaised },
    cards: { gap: spacing.md },
    detail: { marginTop: spacing.md, gap: spacing.xs },
    detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    note: { marginTop: spacing.sm },
    clientRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
    clientRowSpaced: { marginTop: spacing.md },
    clientName: { flex: 1 },
    barTrack: {
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceSunken,
      overflow: 'hidden',
      marginTop: spacing.md,
    },
    barFill: { height: 8, borderRadius: radius.pill },
    remainingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
    },
    chipsLabel: { marginTop: spacing.xl, marginBottom: spacing.sm },
    chipsHint: { marginTop: spacing.sm },
    loader: { marginTop: spacing.xxxl },
    error: { marginBottom: spacing.lg },
  })
