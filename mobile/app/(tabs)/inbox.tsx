import { apiRequest } from '@/src/api/client'
import type { Movement } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors, spacing } from '@/src/theme'
import { EmptyState, LedgerCell, ListRow, Screen, Txt } from '@/src/ui'
import { screenPadding } from '@/src/ui/Screen'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native'

export default function InboxScreen() {
  const { accessToken } = useAuth()
  const router = useRouter()

  const movements = useQuery({
    queryKey: ['movements', { needsReview: true }],
    queryFn: () => apiRequest<Movement[]>('/movements?needsReview=true', { token: accessToken }),
    enabled: !!accessToken,
  })

  const rows = movements.data ?? []

  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <Txt variant="title">Revisar</Txt>
        <Txt variant="caption" tone="faint">
          Movimientos que entraron solos y todavía no cuentan para el balance.
        </Txt>
      </View>

      {movements.isLoading ? (
        <ActivityIndicator color={colors.brand} style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={movements.isFetching}
              onRefresh={() => movements.refetch()}
              tintColor={colors.muted}
              colors={[colors.brand]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={
            <EmptyState title="Todo al día" body="Cuando llegue algo de una integración, aparece acá." />
          }
          renderItem={({ item }) => (
            <ListRow
              title={item.description}
              meta={`${item.wallet?.name ?? item.currency} · ${item.source ?? 'manual'}`}
              attention
              onPress={() => router.push(`/movement/${item.id}`)}
              right={<LedgerCell value={item.amount} currency={item.currency} />}
            />
          )}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { paddingTop: spacing.sm },
  header: { paddingHorizontal: screenPadding, gap: spacing.xs, marginBottom: spacing.lg },
  loader: { marginTop: spacing.xxxl },
  list: {
    gap: spacing.sm,
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.huge,
  },
})
