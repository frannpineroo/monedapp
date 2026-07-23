import { apiRequest } from '@/src/api/client'
import type { Movement } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { useQuery } from '@tanstack/react-query'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'

const typeLabel: Record<Movement['type'], string> = {
  income: 'Ingreso',
  expense: 'Gasto',
  transfer: 'Transferencia',
}

export default function MovementsScreen() {
  const { accessToken } = useAuth()

  const movements = useQuery({
    queryKey: ['movements'],
    queryFn: () => apiRequest<Movement[]>('/movements', { token: accessToken }),
    enabled: !!accessToken,
  })

  return (
    <View style={styles.container}>
      {movements.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={movements.data ?? []}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={movements.isFetching}
              onRefresh={() => movements.refetch()}
            />
          }
          contentContainerStyle={{ gap: 10, padding: 16, paddingBottom: 32 }}
          ListEmptyComponent={
            <Text style={styles.empty}>Todavía no hay movimientos. Cargá el primero.</Text>
          }
          renderItem={({ item }) => {
            const amount = Number(item.amount)
            const sign = item.type === 'expense' ? '-' : '+'
            const color =
              item.type === 'expense'
                ? colors.expense
                : item.type === 'income'
                  ? colors.income
                  : colors.ink
            return (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.desc}>{item.description}</Text>
                  <Text style={styles.meta}>
                    {typeLabel[item.type]} · {item.wallet?.name ?? item.currency}
                  </Text>
                </View>
                <Text style={[styles.amount, { color }]}>
                  {sign}
                  {formatAmount(amount, item.currency)}
                </Text>
              </View>
            )
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  desc: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
  },
  empty: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: 40,
  },
})
