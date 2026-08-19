import { apiRequest } from '@/src/api/client'
import type { Receivable, ReceivableStatus } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
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

type Filter = 'all' | ReceivableStatus

const statusLabel: Record<ReceivableStatus, string> = {
  pending: 'Pendiente',
  partial: 'Cobro parcial',
  overdue: 'Vencida',
  paid: 'Cobrada',
}

export default function ReceivablesScreen() {
  const { accessToken } = useAuth()
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')

  const receivables = useQuery({
    queryKey: ['receivables', filter],
    queryFn: () =>
      apiRequest<Receivable[]>(`/receivables${filter === 'all' ? '' : `?status=${filter}`}`, {
        token: accessToken,
      }),
    enabled: !!accessToken,
  })

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        {(
          [
            { id: 'all' as const, label: 'Todas' },
            { id: 'pending' as const, label: 'Pendientes' },
            { id: 'overdue' as const, label: 'Vencidas' },
            { id: 'paid' as const, label: 'Cobradas' },
          ] as const
        ).map((opt) => (
          <Pressable
            key={opt.id}
            style={[styles.chip, filter === opt.id && styles.chipActive]}
            onPress={() => setFilter(opt.id)}
          >
            <Text style={[styles.chipText, filter === opt.id && styles.chipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {receivables.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={receivables.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={receivables.isFetching}
              onRefresh={() => receivables.refetch()}
            />
          }
          ListEmptyComponent={<Text style={styles.empty}>No hay facturas para mostrar.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/movement/${item.id}`)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.client?.name ?? 'Sin cliente'}</Text>
                <Text style={styles.meta}>
                  {item.description} · {statusLabel[item.status]}
                </Text>
                {item.status === 'overdue' ? (
                  <Text style={styles.overdue}>{item.daysOverdue} días de atraso</Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.amount}>
                  {formatAmount(item.outstanding, item.currency)}
                </Text>
                <Text style={styles.meta}>de {formatAmount(item.amount, item.currency)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16, paddingBottom: 4 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.ink, fontSize: 13 },
  chipTextActive: { color: colors.accent, fontWeight: '600' },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  overdue: { fontSize: 13, color: colors.danger, marginTop: 4, fontWeight: '600' },
  amount: { fontSize: 15, fontWeight: '700', color: colors.ink },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
})
