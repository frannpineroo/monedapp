import { apiRequest } from '@/src/api/client'
import type { Category } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
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

type Kind = 'EXPENSE' | 'INCOME'

export default function CategoriesScreen() {
  const { accessToken } = useAuth()
  const [kind, setKind] = useState<Kind>('EXPENSE')

  const categories = useQuery({
    queryKey: ['categories', kind],
    queryFn: () =>
      apiRequest<Category[]>(`/categories?kind=${kind}`, { token: accessToken }),
    enabled: !!accessToken,
  })

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        <View style={formStyles.rowWrap}>
          {(
            [
              { id: 'EXPENSE' as const, label: 'Gastos' },
              { id: 'INCOME' as const, label: 'Ingresos' },
            ] as const
          ).map((opt) => (
            <Pressable
              key={opt.id}
              style={[formStyles.chip, kind === opt.id && formStyles.chipActive]}
              onPress={() => setKind(opt.id)}
            >
              <Text
                style={[formStyles.chipText, kind === opt.id && formStyles.chipTextActive]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {categories.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={categories.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={categories.isFetching}
              onRefresh={() => categories.refetch()}
            />
          }
          ListEmptyComponent={<Text style={styles.empty}>Todavía no tenés categorías.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.row}>
              <Text style={styles.name}>{item.name}</Text>
            </Pressable>
          )}
        />
      )}

      <View style={styles.footer}>
        <Pressable style={formStyles.button}>
          <Text style={formStyles.buttonText}>Nueva categoría</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  filters: { paddingHorizontal: 16, paddingTop: 12 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.ink },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
})
