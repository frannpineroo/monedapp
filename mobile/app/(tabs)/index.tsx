import { apiRequest } from '@/src/api/client'
import type { WalletBalance } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
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

function formatAmount(value: string | number, currency: string) {
  const n = Number(value)
  return `${currency} ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function HomeScreen() {
  const { accessToken, user, logout } = useAuth()

  const balances = useQuery({
    queryKey: ['balance-by-wallet'],
    queryFn: () =>
      apiRequest<WalletBalance[]>('/reports/balance-by-wallet', { token: accessToken }),
    enabled: !!accessToken,
  })

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.hello}>Hola</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
        <Pressable onPress={() => logout()}>
          <Text style={styles.logout}>Salir</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Tus billeteras</Text>

      {balances.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={balances.data ?? []}
          keyExtractor={(item) => item.wallet.id}
          refreshControl={
            <RefreshControl refreshing={balances.isFetching} onRefresh={() => balances.refetch()} />
          }
          contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
          ListEmptyComponent={<Text style={styles.empty}>Todavía no tenés billeteras.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.walletName}>{item.wallet.name}</Text>
              <Text style={styles.balance}>{formatAmount(item.balance, item.currency)}</Text>
            </View>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 20,
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
  section: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 12,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  walletName: {
    fontSize: 15,
    color: colors.muted,
  },
  balance: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 6,
  },
  empty: {
    color: colors.muted,
    marginTop: 12,
  },
})
