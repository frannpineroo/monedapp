import { apiRequest } from '@/src/api/client'
import type { Client } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
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

export default function ClientsScreen() {
  const { accessToken } = useAuth()

  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiRequest<Client[]>('/clients', { token: accessToken }),
    enabled: !!accessToken,
  })

  return (
    <View style={styles.container}>
      {clients.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={clients.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={clients.isFetching} onRefresh={() => clients.refetch()} />
          }
          ListEmptyComponent={<Text style={styles.empty}>Todavía no tenés clientes.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.defaultCurrency}
                  {item.phone ? ` · ${item.phone}` : ''}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <View style={styles.footer}>
        <Pressable style={formStyles.button}>
          <Text style={formStyles.buttonText}>Nuevo cliente</Text>
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
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
})
