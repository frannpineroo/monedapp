import { apiRequest } from '@/src/api/client'
import type { Movement, ReceivablesSummary, WalletBalance } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { groupBalancesByCurrency } from '@/src/lib/format'
import { colors, radius, spacing } from '@/src/theme'
import {
  Button,
  Card,
  EmptyState,
  LedgerCell,
  LinkButton,
  ListRow,
  Money,
  Screen,
  Section,
  Txt,
} from '@/src/ui'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useCallback, useMemo } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

const typeLabel: Record<Movement['type'], string> = {
  income: 'Ingreso',
  expense: 'Gasto',
  transfer: 'Transferencia',
  invoice: 'Factura',
  collection: 'Cobro',
}

/** Los gastos se guardan en positivo: el signo lo pone la vista. */
function signFor(type: Movement['type']) {
  if (type === 'expense') return '-' as const
  if (type === 'income' || type === 'collection') return '+' as const
  return undefined
}

export default function HomeScreen() {
  const { accessToken, user } = useAuth()
  const router = useRouter()

  const balances = useQuery({
    queryKey: ['balance-by-wallet'],
    queryFn: () => apiRequest<WalletBalance[]>('/reports/balance-by-wallet', { token: accessToken }),
    enabled: !!accessToken,
  })

  const movements = useQuery({
    queryKey: ['movements', { limit: 5 }],
    queryFn: () => apiRequest<Movement[]>('/movements', { token: accessToken }),
    enabled: !!accessToken,
  })

  const pending = useQuery({
    queryKey: ['movements', { needsReview: true }],
    queryFn: () => apiRequest<Movement[]>('/movements?needsReview=true', { token: accessToken }),
    enabled: !!accessToken,
  })
  const pendingCount = pending.data?.length ?? 0

  const receivables = useQuery({
    queryKey: ['receivables-summary'],
    queryFn: () => apiRequest<ReceivablesSummary>('/receivables/summary', { token: accessToken }),
    enabled: !!accessToken,
  })

  const month = new Date().toISOString().slice(0, 7)

  const byCategory = useQuery({
    queryKey: ['by-category', month],
    queryFn: () =>
      apiRequest<{ categoryId: string | null; name: string; total: number; percent: number }[]>(
        `/reports/by-category?month=${month}&type=expense`,
        { token: accessToken }
      ),
    enabled: !!accessToken,
  })

  const topCategories = (byCategory.data ?? []).slice(0, 5)

  const totalsByCurrency = useMemo(
    () => groupBalancesByCurrency(balances.data ?? []),
    [balances.data]
  )
  /** La moneda con más saldo encabeza el balance; el resto va debajo. */
  const currencyEntries = useMemo(
    () => Object.entries(totalsByCurrency).sort((a, b) => Number(b[1]) - Number(a[1])),
    [totalsByCurrency]
  )
  const [leadCurrency, ...restCurrencies] = currencyEntries
  const recentMovements = (movements.data ?? []).slice(0, 5)
  const wallets = balances.data ?? []

  const refreshing =
    balances.isFetching ||
    movements.isFetching ||
    byCategory.isFetching ||
    pending.isFetching ||
    receivables.isFetching

  const onRefresh = useCallback(() => {
    void balances.refetch()
    void movements.refetch()
    void byCategory.refetch()
    void pending.refetch()
    void receivables.refetch()
  }, [balances, movements, byCategory, pending, receivables])

  const loading = balances.isLoading || movements.isLoading

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.muted}
          colors={[colors.brand]}
          progressBackgroundColor={colors.surface}
        />
      }
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Txt variant="title">Hola</Txt>
          <Txt variant="caption" tone="faint" numberOfLines={1}>
            {user?.email}
          </Txt>
        </View>
        <LinkButton label="Integraciones" onPress={() => router.push('/integrations')} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={styles.loader} />
      ) : (
        <>
          {pendingCount > 0 ? (
            <Card attention onPress={() => router.push('/(tabs)/inbox')} style={styles.banner}>
              <Txt variant="bodyMedium">
                {pendingCount} movimiento{pendingCount === 1 ? '' : 's'} para revisar
              </Txt>
              <Txt variant="caption" tone="faint" style={styles.bannerHint}>
                Confirmá el tipo y la categoría para que entren al balance.
              </Txt>
            </Card>
          ) : null}

          <Section title="Tu plata">
            {currencyEntries.length === 0 ? (
              <EmptyState
                title="Todavía no tenés billeteras"
                body="Agregá una billetera para empezar a llevar el balance."
                actionLabel="Agregar billetera"
                onAction={() => router.push('/wallets')}
              />
            ) : (
              <Card>
                <Txt variant="label" tone="faint">
                  {leadCurrency[0]}
                </Txt>
                <Money value={leadCurrency[1]} variant="display" />
                {restCurrencies.length > 0 ? (
                  <View style={styles.restCurrencies}>
                    {restCurrencies.map(([currency, total]) => (
                      <View key={currency} style={styles.currencyRow}>
                        <Txt variant="label" tone="faint">
                          {currency}
                        </Txt>
                        <Money value={total} />
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card>
            )}
          </Section>

          {receivables.data && receivables.data.totalArs > 0 ? (
            <Section
              title="Te deben"
              action={<LinkButton label="Ver detalle" onPress={() => router.push('/receivables')} />}
            >
              <Card onPress={() => router.push('/receivables')}>
                <Txt variant="label" tone="faint">
                  ARS
                </Txt>
                <Money value={receivables.data.totalArs} variant="amountLarge" />
                {receivables.data.overdueArs > 0 ? (
                  <View style={styles.owedOverdue}>
                    <Txt variant="captionStrong" tone="attention">
                      Vencido
                    </Txt>
                    <Money value={receivables.data.overdueArs} tone="attention" />
                  </View>
                ) : null}
              </Card>
            </Section>
          ) : null}

          {wallets.length > 0 ? (
            <Section
              title="Tus billeteras"
              action={<LinkButton label="Administrar" onPress={() => router.push('/wallets')} />}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.walletRow}
              >
                {wallets.map((item) => (
                  <View key={item.wallet.id} style={styles.walletCard}>
                    <Txt variant="captionStrong" tone="muted" numberOfLines={1}>
                      {item.wallet.name}
                    </Txt>
                    <View style={styles.walletAmount}>
                      <Money value={item.balance} />
                      <Txt variant="label" tone="faint" align="right">
                        {item.currency}
                      </Txt>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </Section>
          ) : null}

          {topCategories.length > 0 ? (
            <Section title="En qué se te fue este mes">
              <Card>
                <View style={styles.categoryList}>
                  {topCategories.map((row, index) => (
                    <View key={row.categoryId ?? row.name} style={styles.categoryRow}>
                      <View style={styles.categoryHeader}>
                        <Txt variant="captionStrong" numberOfLines={1} style={styles.categoryName}>
                          {row.name}
                        </Txt>
                        <Money value={row.total} />
                      </View>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.barFill,
                            index === 0 ? styles.barFillLead : null,
                            { width: `${Math.min(Math.max(row.percent, 2), 100)}%` },
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              </Card>
            </Section>
          ) : null}

          <Section
            title="Últimos movimientos"
            action={<LinkButton label="Ver todos" onPress={() => router.push('/(tabs)/movements')} />}
          >
            {recentMovements.length === 0 ? (
              <EmptyState
                title="Sin movimientos todavía"
                body="Cargá el primero y aparece acá."
                actionLabel="Cargar movimiento"
                onAction={() => router.push('/(tabs)/new-movement')}
              />
            ) : (
              <View style={styles.movements}>
                {recentMovements.map((item) => (
                  <ListRow
                    key={item.id}
                    title={item.description}
                    meta={`${typeLabel[item.type]} · ${item.wallet?.name ?? item.currency}`}
                    onPress={() => router.push(`/movement/${item.id}`)}
                    attention={item.needsReview}
                    right={
                      <LedgerCell
                        value={item.amount}
                        currency={item.currency}
                        sign={signFor(item.type)}
                        tone={item.type === 'income' || item.type === 'collection' ? 'positive' : 'ink'}
                      />
                    }
                  />
                ))}
              </View>
            )}
          </Section>

          <Button
            label="Cargar movimiento"
            block
            size="lg"
            onPress={() => router.push('/(tabs)/new-movement')}
          />
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    marginBottom: spacing.xxl,
  },
  headerText: { flex: 1, gap: 2 },
  loader: { marginTop: spacing.huge },
  banner: { marginBottom: spacing.xxl },
  bannerHint: { marginTop: spacing.xs },
  restCurrencies: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  owedOverdue: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  walletRow: { gap: spacing.md, paddingRight: spacing.xs },
  walletCard: {
    width: 152,
    minHeight: 104,
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  walletAmount: { marginTop: spacing.lg },
  categoryList: { gap: spacing.lg },
  categoryRow: { gap: spacing.sm },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  categoryName: { flex: 1 },
  barTrack: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: { height: 4, borderRadius: radius.pill, backgroundColor: colors.borderStrong },
  // La categoría que más se llevó se marca por jerarquía, no por color.
  barFillLead: { backgroundColor: colors.ink },
  movements: { gap: spacing.sm },
})
