import { apiRequest } from '@/src/api/client'
import type { Receivable, ReceivableStatus } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { spacing, useThemeColors } from '@/src/theme'
import { Chip, ChipRow, EmptyState, LedgerCell, ListRow, Screen, ThemedRefreshControl } from '@/src/ui'
import { screenPadding } from '@/src/ui/Screen'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native'

type Filter = 'all' | ReceivableStatus

const statusLabel: Record<ReceivableStatus, string> = {
  pending: 'Pendiente',
  partial: 'Cobro parcial',
  overdue: 'Vencida',
  paid: 'Cobrada',
}

const filterOptions: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'overdue', label: 'Vencidas' },
  { id: 'paid', label: 'Cobradas' },
]

function amountLabel(value: number, currency: string) {
  return `${Number(value).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`
}

export default function ReceivablesScreen() {
  const c = useThemeColors()
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
    <Screen edges={['bottom']}>
      <View style={styles.filters}>
        <ChipRow>
          {filterOptions.map((opt) => (
            <Chip
              key={opt.id}
              label={opt.label}
              selected={filter === opt.id}
              onPress={() => setFilter(opt.id)}
            />
          ))}
        </ChipRow>
      </View>

      {receivables.isLoading ? (
        <ActivityIndicator color={c.brand} style={styles.loader} />
      ) : (
        <FlatList
          data={receivables.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <ThemedRefreshControl refreshing={receivables.isFetching} onRefresh={() => receivables.refetch()} />
          }
          ListEmptyComponent={
            <EmptyState
              title="Nada que cobrar acá"
              body={
                filter === 'all'
                  ? 'Cuando cargues una factura, aparece en esta lista.'
                  : 'Probá con otro estado.'
              }
            />
          }
          renderItem={({ item }) => {
            const overdue = item.status === 'overdue'
            const meta = [
              item.description,
              statusLabel[item.status],
              overdue ? `${item.daysOverdue} días de atraso` : null,
              item.collected > 0 ? `cobrado ${amountLabel(item.collected, item.currency)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')

            return (
              <ListRow
                title={item.client?.name ?? 'Sin cliente'}
                meta={meta}
                attention={overdue}
                onPress={() => router.push(`/movement/${item.id}`)}
                right={
                  <LedgerCell
                    value={item.outstanding}
                    currency={item.currency}
                    tone={overdue ? 'attention' : 'ink'}
                  />
                }
              />
            )
          }}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  filters: { paddingHorizontal: screenPadding, paddingTop: spacing.lg },
  loader: { marginTop: spacing.xxxl },
  list: {
    gap: spacing.sm,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.huge,
  },
})
