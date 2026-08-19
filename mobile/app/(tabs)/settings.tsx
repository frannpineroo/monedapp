import { apiRequest } from '@/src/api/client'
import type { Category, Client, Wallet } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

export default function SettingsScreen() {
  const { accessToken, user, logout } = useAuth()
  const router = useRouter()

  const wallets = useQuery({
    queryKey: ['wallets'],
    queryFn: () => apiRequest<Wallet[]>('/wallets', { token: accessToken }),
    enabled: !!accessToken,
  })

  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiRequest<Client[]>('/clients', { token: accessToken }),
    enabled: !!accessToken,
  })

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiRequest<Category[]>('/categories', { token: accessToken }),
    enabled: !!accessToken,
  })

  const rows = [
    { href: '/wallets' as const, label: 'Billeteras', count: wallets.data?.length },
    { href: '/clients' as const, label: 'Clientes', count: clients.data?.length },
    { href: '/categories' as const, label: 'Categorías', count: categories.data?.length },
  ]

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>Tu cuenta</Text>
      <View style={styles.card}>
        {rows.map((row) => (
          <Pressable key={row.href} style={styles.row} onPress={() => router.push(row.href)}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <View style={styles.rowRight}>
              <Text style={styles.rowCount}>{row.count ?? '—'}</Text>
              <FontAwesome name="chevron-right" size={13} color={colors.muted} />
            </View>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Perfil</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Email</Text>
          <Text style={styles.rowValue}>{user?.email}</Text>
        </View>
        <Pressable style={styles.row} onPress={() => logout()}>
          <Text style={styles.logout}>Cerrar sesión</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40, gap: 10 },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 10,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 16, color: colors.ink },
  rowValue: { fontSize: 14, color: colors.muted },
  rowCount: { fontSize: 14, color: colors.muted },
  logout: { fontSize: 16, color: colors.danger, fontWeight: '600' },
})
