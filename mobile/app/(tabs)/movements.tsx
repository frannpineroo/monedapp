import { apiRequest } from '@/src/api/client'
import type { Movement, Wallet } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
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

type TypeFilter = 'all' | Movement['type']

export default function MovementsScreen() {
  const { accessToken } = useAuth()
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [walletFilter, setWalletFilter] = useState<string | null>(null)

  const wallets = useQuery({
    queryKey: ['wallets'],
    queryFn: () => apiRequest<Wallet[]>('/wallets', { token: accessToken }),
    enabled: !!accessToken,
  })

  const movements = useQuery({
    queryKey: ['movements', { type: typeFilter, walletId: walletFilter }],
    queryFn: () => {
      const params = new URLSearchParams()
      if (typeFilter !== 'all') params.set('type', typeFilter)
      if (walletFilter) params.set('walletId', walletFilter)
      const qs = params.toString()
      return apiRequest<Movement[]>(`/movements${qs ? `?${qs}` : ''}`, {
        token: accessToken,
      })
    },
    enabled: !!accessToken,
  })

  const hasFilters = typeFilter !== 'all' || walletFilter !== null

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        <Text style={styles.filterLabel}>Tipo</Text>
        <View style={styles.chipRow}>
          {(
            [
              { id: 'all' as const, label: 'Todos' },
              { id: 'income' as const, label: 'Ingreso' },
              { id: 'expense' as const, label: 'Gasto' },
              { id: 'transfer' as const, label: 'Transferencia' },
            ] as const
          ).map((opt) => (
            <Pressable
              key={opt.id}
              style={[styles.chip, typeFilter === opt.id && styles.chipActive]}
              onPress={() => setTypeFilter(opt.id)}
            >
              <Text style={[styles.chipText, typeFilter === opt.id && styles.chipTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.filterLabel, { marginTop: 10 }]}>Billetera</Text>
        <View style={styles.chipRow}>
          <Pressable
            style={[styles.chip, walletFilter === null && styles.chipActive]}
            onPress={() => setWalletFilter(null)}
          >
            <Text style={[styles.chipText, walletFilter === null && styles.chipTextActive]}>
              Todas
            </Text>
          </Pressable>
          {(wallets.data ?? []).map((w) => (
            <Pressable
              key={w.id}
              style={[styles.chip, walletFilter === w.id && styles.chipActive]}
              onPress={() => setWalletFilter(w.id)}
            >
              <Text style={[styles.chipText, walletFilter === w.id && styles.chipTextActive]}>
                {w.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

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
            <Text style={styles.empty}>
              {hasFilters
                ? 'No hay movimientos con esos filtros.'
                : 'Todavía no hay movimientos. Cargá el primero.'}
            </Text>
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
            const clientSuffix = item.client?.name ? ` · ${item.client.name}` : ''
            return (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.desc}>{item.description}</Text>
                  <Text style={styles.meta}>
                    {typeLabel[item.type]} · {item.wallet?.name ?? item.currency}
                    {clientSuffix}
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
  filters: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.ink,
    fontSize: 13,
  },
  chipTextActive: {
    color: colors.accent,
    fontWeight: '600',
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
