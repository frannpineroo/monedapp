import { apiRequest } from '@/src/api/client'
import type { Movement, WalletBalance } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount, groupBalancesByCurrency } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useCallback, useMemo } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

const typeLabel: Record<Movement['type'], string> = {
  income: 'Ingreso',
  expense: 'Gasto',
  transfer: 'Transferencia',
}

export default function HomeScreen() {
  const { accessToken, user, logout } = useAuth()
  const router = useRouter()

  const balances = useQuery({
    queryKey: ['balance-by-wallet'],
    queryFn: () =>
      apiRequest<WalletBalance[]>('/reports/balance-by-wallet', { token: accessToken }),
    enabled: !!accessToken,
  })

  const movements = useQuery({
    queryKey: ['movements', { limit: 5 }],
    queryFn: () => apiRequest<Movement[]>('/movements', { token: accessToken }),
    enabled: !!accessToken,
  })

  const totalsByCurrency = useMemo(
    () => groupBalancesByCurrency(balances.data ?? []),
    [balances.data]
  )
  const currencyEntries = Object.entries(totalsByCurrency)
  const recentMovements = (movements.data ?? []).slice(0, 5)

  const refreshing = balances.isFetching || movements.isFetching
  const onRefresh = useCallback(() => {
    void balances.refetch()
    void movements.refetch()
  }, [balances, movements])

  const loading = balances.isLoading || movements.isLoading

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.hello}>Hola</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
        <Pressable onPress={() => logout()}>
          <Text style={styles.logout}>Salir</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <>
          <Text style={styles.sectionLabel}>Tu plata</Text>
          <View style={styles.hero}>
            {currencyEntries.length === 0 ? (
              <Text style={styles.empty}>Todavía no tenés billeteras.</Text>
            ) : (
              currencyEntries.map(([currency, total]) => (
                <View key={currency} style={styles.totalRow}>
                  <Text style={styles.totalCurrency}>{currency}</Text>
                  <Text style={styles.totalAmount}>
                    {Number(total).toLocaleString('es-AR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Text>
                </View>
              ))
            )}
          </View>

          <Text style={styles.sectionLabel}>Tus billeteras</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.walletRow}
          >
            {(balances.data ?? []).length === 0 ? (
              <Text style={styles.empty}>Agregá una billetera para empezar.</Text>
            ) : (
              (balances.data ?? []).map((item) => (
                <View key={item.wallet.id} style={styles.walletCard}>
                  <Text style={styles.walletName} numberOfLines={1}>
                    {item.wallet.name}
                  </Text>
                  <Text style={styles.walletCurrency}>{item.currency}</Text>
                  <Text style={styles.walletBalance}>
                    {formatAmount(item.balance, item.currency)}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabelInline}>Últimos movimientos</Text>
            <Pressable onPress={() => router.push('/(tabs)/movements')}>
              <Text style={styles.seeAll}>Ver todos</Text>
            </Pressable>
          </View>

          {recentMovements.length === 0 ? (
            <Text style={styles.empty}>Todavía no hay movimientos.</Text>
          ) : (
            <View style={styles.movementsList}>
              {recentMovements.map((item) => {
                const amount = Number(item.amount)
                const sign = item.type === 'expense' ? '-' : '+'
                const color =
                  item.type === 'expense'
                    ? colors.expense
                    : item.type === 'income'
                      ? colors.income
                      : colors.ink
                return (
                  <View key={item.id} style={styles.movementRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.movementDesc}>{item.description}</Text>
                      <Text style={styles.movementMeta}>
                        {typeLabel[item.type]} · {item.wallet?.name ?? item.currency}
                      </Text>
                    </View>
                    <Text style={[styles.movementAmount, { color }]}>
                      {sign}
                      {formatAmount(amount, item.currency)}
                    </Text>
                  </View>
                )
              })}
            </View>
          )}
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  hello: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.ink,
  },
  email: {
    color: colors.muted,
    marginTop: 2,
  },
  logout: {
    color: colors.accent,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionLabelInline: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 8,
  },
  seeAll: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 14,
  },
  hero: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
    gap: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  totalCurrency: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.muted,
  },
  totalAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.ink,
  },
  walletRow: {
    gap: 12,
    paddingBottom: 4,
    marginBottom: 24,
  },
  walletCard: {
    width: 140,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  walletName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  walletCurrency: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
  },
  walletBalance: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.accent,
    marginTop: 10,
  },
  movementsList: {
    gap: 10,
  },
  movementRow: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  movementDesc: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  movementMeta: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
  },
  movementAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  empty: {
    color: colors.muted,
    marginBottom: 16,
  },
})
