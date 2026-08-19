import { apiRequest } from '@/src/api/client'
import type { Movement } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'

export default function InboxScreen() {
  const { accessToken } = useAuth()
  const router = useRouter()

  const movements = useQuery({
    queryKey: ['movements', { needsReview: true }],
    queryFn: () =>
      apiRequest<Movement[]>('/movements?needsReview=true', { token: accessToken }),
    enabled: !!accessToken,
  })

  if (movements.isLoading) {
    return <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
  }

  return (
    <FlatList
      style={styles.container}
      data={movements.data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl refreshing={movements.isFetching} onRefresh={() => movements.refetch()} />
      }
      ListEmptyComponent={
        <Text style={styles.empty}>No hay nada para revisar. Todo al día.</Text>
      }
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => router.push(`/movement/${item.id}`)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.desc}>{item.description}</Text>
            <Text style={styles.meta}>
              {item.wallet?.name ?? item.currency} · {item.source ?? 'manual'}
            </Text>
          </View>
          <Text style={styles.amount}>{formatAmount(item.amount, item.currency)}</Text>
        </Pressable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  desc: { fontSize: 16, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  amount: { fontSize: 15, fontWeight: '700', color: colors.income },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
})
