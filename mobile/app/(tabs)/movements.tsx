import { apiRequest } from '@/src/api/client'
import type { Category, Movement, Wallet } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors, spacing } from '@/src/theme'
import { Chip, EmptyState, LedgerCell, LinkButton, ListRow, Screen, Txt } from '@/src/ui'
import { screenPadding } from '@/src/ui/Screen'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

const typeLabel: Record<Movement['type'], string> = {
  income: 'Ingreso',
  expense: 'Gasto',
  transfer: 'Transferencia',
  invoice: 'Factura',
  collection: 'Cobro',
}

type TypeFilter = 'all' | Movement['type']

const typeOptions: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'income', label: 'Ingresos' },
  { id: 'expense', label: 'Gastos' },
  { id: 'transfer', label: 'Transferencias' },
]

function signFor(type: Movement['type']) {
  if (type === 'expense') return '-' as const
  if (type === 'income' || type === 'collection') return '+' as const
  return undefined
}

/** Fila de filtros: rótulo fijo y chips que se desplazan en horizontal. */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.filterRow}>
      <Txt variant="label" tone="faint" style={styles.filterLabel}>
        {label}
      </Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {children}
      </ScrollView>
    </View>
  )
}

export default function MovementsScreen() {
  const { accessToken } = useAuth()
  const router = useRouter()
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [walletFilter, setWalletFilter] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const wallets = useQuery({
    queryKey: ['wallets'],
    queryFn: () => apiRequest<Wallet[]>('/wallets', { token: accessToken }),
    enabled: !!accessToken,
  })

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiRequest<Category[]>('/categories', { token: accessToken }),
    enabled: !!accessToken,
  })

  const movements = useQuery({
    queryKey: ['movements', { type: typeFilter, walletId: walletFilter, categoryId: categoryFilter }],
    queryFn: () => {
      const params = new URLSearchParams()
      if (typeFilter !== 'all') params.set('type', typeFilter)
      if (walletFilter) params.set('walletId', walletFilter)
      if (categoryFilter) params.set('categoryId', categoryFilter)
      const qs = params.toString()
      return apiRequest<Movement[]>(`/movements${qs ? `?${qs}` : ''}`, { token: accessToken })
    },
    enabled: !!accessToken,
  })

  const extraFilterCount = (walletFilter ? 1 : 0) + (categoryFilter ? 1 : 0)
  const hasFilters = typeFilter !== 'all' || extraFilterCount > 0
  const rows = movements.data ?? []

  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <Txt variant="title">Movimientos</Txt>
        <Txt variant="caption" tone="faint">
          {rows.length} {rows.length === 1 ? 'registro' : 'registros'}
          {hasFilters ? ' con los filtros aplicados' : ''}
        </Txt>
      </View>

      <View style={styles.filters}>
        <FilterRow label="Tipo">
          {typeOptions.map((opt) => (
            <Chip
              key={opt.id}
              label={opt.label}
              selected={typeFilter === opt.id}
              onPress={() => setTypeFilter(opt.id)}
            />
          ))}
        </FilterRow>

        <View style={styles.moreRow}>
          <LinkButton
            label={showMoreFilters ? 'Menos filtros' : `Billetera y categoría${extraFilterCount > 0 ? ` (${extraFilterCount})` : ''}`}
            onPress={() => setShowMoreFilters((v) => !v)}
          />
        </View>

        {showMoreFilters ? (
          <>
            <FilterRow label="Billetera">
              <Chip label="Todas" selected={walletFilter === null} onPress={() => setWalletFilter(null)} />
              {(wallets.data ?? []).map((w) => (
                <Chip
                  key={w.id}
                  label={w.name}
                  selected={walletFilter === w.id}
                  onPress={() => setWalletFilter(w.id)}
                />
              ))}
            </FilterRow>

            <FilterRow label="Categoría">
              <Chip label="Todas" selected={categoryFilter === null} onPress={() => setCategoryFilter(null)} />
              {(categories.data ?? []).map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  selected={categoryFilter === c.id}
                  onPress={() => setCategoryFilter(c.id)}
                />
              ))}
            </FilterRow>
          </>
        ) : null}
      </View>

      {movements.isLoading ? (
        <ActivityIndicator color={colors.brand} style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={movements.isFetching}
              onRefresh={() => movements.refetch()}
              tintColor={colors.muted}
              colors={[colors.brand]}
              progressBackgroundColor={colors.surface}
            />
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            hasFilters ? (
              <EmptyState
                title="Nada con esos filtros"
                body="Probá con otro tipo, otra billetera o sacá la categoría."
                actionLabel="Limpiar filtros"
                onAction={() => {
                  setTypeFilter('all')
                  setWalletFilter(null)
                  setCategoryFilter(null)
                  setShowMoreFilters(false)
                }}
              />
            ) : (
              <EmptyState
                title="Sin movimientos todavía"
                body="Cargá el primero y aparece acá."
                actionLabel="Cargar movimiento"
                onAction={() => router.push('/(tabs)/new-movement')}
              />
            )
          }
          renderItem={({ item }) => {
            const rate = item.currency !== 'ARS' ? item.exchangeRate : undefined
            const meta = [
              typeLabel[item.type],
              item.wallet?.name ?? item.currency,
              item.category?.name,
              item.client?.name,
              rate
                ? `${rate.type} ${Number(rate.sell ?? rate.value).toLocaleString('es-AR', {
                    maximumFractionDigits: 0,
                  })}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')

            return (
              <ListRow
                title={item.description}
                meta={meta}
                attention={item.needsReview}
                onPress={() => router.push(`/movement/${item.id}`)}
                right={
                  <LedgerCell
                    value={item.amount}
                    currency={item.currency}
                    sign={signFor(item.type)}
                    tone={item.type === 'income' || item.type === 'collection' ? 'positive' : 'ink'}
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
  screen: { paddingTop: spacing.sm },
  header: { paddingHorizontal: screenPadding, gap: 2, marginBottom: spacing.lg },
  filters: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  filterRow: { gap: spacing.sm },
  moreRow: { paddingHorizontal: screenPadding },
  filterLabel: { paddingHorizontal: screenPadding },
  chips: { gap: spacing.sm, paddingHorizontal: screenPadding },
  loader: { marginTop: spacing.xxxl },
  list: {
    gap: spacing.sm,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.huge,
  },
})
