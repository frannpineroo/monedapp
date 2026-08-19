import { apiRequest } from '@/src/api/client'
import type { WalletBalance } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
import { useQuery } from '@tanstack/react-query'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'

export default function WalletsScreen() {
  const { accessToken } = useAuth()

  const balances = useQuery({
    queryKey: ['balance-by-wallet'],
    queryFn: () =>
      apiRequest<WalletBalance[]>('/reports/balance-by-wallet', { token: accessToken }),
    enabled: !!accessToken,
  })

  return (
    <View style={styles.container}>
      {balances.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={balances.data ?? []}
          keyExtractor={(item) => item.wallet.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={balances.isFetching}
              onRefresh={() => balances.refetch()}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>Todavía no tenés billeteras.</Text>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.wallet.name}</Text>
                <Text style={styles.meta}>{item.currency}</Text>
              </View>
              <Text style={styles.balance}>{formatAmount(item.balance, item.currency)}</Text>
            </Pressable>
          )}
        />
      )}

      <View style={styles.footer}>
        <Pressable style={formStyles.button}>
          <Text style={formStyles.buttonText}>Nueva billetera</Text>
        </Pressable>
      </View>
    </View>
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
  name: { fontSize: 16, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  balance: { fontSize: 15, fontWeight: '700', color: colors.accent },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
})
