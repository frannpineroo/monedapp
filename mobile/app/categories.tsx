import { ApiError, apiRequest } from '@/src/api/client'
import type { Category } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

type Kind = 'EXPENSE' | 'INCOME'

export default function CategoriesScreen() {
  const { accessToken } = useAuth()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<Kind>('EXPENSE')
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const open = Boolean(editing) || creating

  const categories = useQuery({
    queryKey: ['categories', kind],
    queryFn: () =>
      apiRequest<Category[]>(`/categories?kind=${kind}`, { token: accessToken }),
    enabled: !!accessToken,
  })

  function openCreate() {
    setEditing(null)
    setCreating(true)
    setName('')
    setError(null)
  }

  function openEdit(category: Category) {
    setCreating(false)
    setEditing(category)
    setName(category.name)
    setError(null)
  }

  function close() {
    setCreating(false)
    setEditing(null)
    setError(null)
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['categories'] })
  }

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiRequest<Category>(`/categories/${editing.id}`, {
            method: 'PATCH',
            token: accessToken,
            body: { name: name.trim() },
          })
        : apiRequest<Category>('/categories', {
            method: 'POST',
            token: accessToken,
            body: { name: name.trim(), kind },
          }),
    onSuccess: async () => {
      await refresh()
      close()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo guardar'),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/categories/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      await refresh()
      close()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo borrar'),
  })

  function submit() {
    setError(null)
    if (!name.trim()) {
      setError('Escribí un nombre')
      return
    }
    save.mutate()
  }

  function confirmRemove() {
    if (!editing) return
    Alert.alert('Borrar categoría', `¿Borrar "${editing.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => remove.mutate(editing.id) },
    ])
  }

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
            <Pressable style={styles.row} onPress={() => openEdit(item)}>
              <Text style={styles.name}>{item.name}</Text>
            </Pressable>
          )}
        />
      )}

      <View style={styles.footer}>
        <Pressable style={formStyles.button} onPress={openCreate}>
          <Text style={formStyles.buttonText}>Nueva categoría</Text>
        </Pressable>
      </View>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {editing ? 'Editar categoría' : `Nueva categoría de ${kind === 'EXPENSE' ? 'gasto' : 'ingreso'}`}
            </Text>

            <Text style={formStyles.label}>Nombre</Text>
            <TextInput
              style={formStyles.input}
              placeholder="Ej. Herramientas y software"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
            />

            {error ? <Text style={formStyles.error}>{error}</Text> : null}

            <Pressable style={formStyles.button} onPress={submit} disabled={save.isPending}>
              {save.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={formStyles.buttonText}>Guardar</Text>
              )}
            </Pressable>

            {editing ? (
              <Pressable onPress={confirmRemove} disabled={remove.isPending}>
                <Text style={styles.delete}>Borrar categoría</Text>
              </Pressable>
            ) : null}

            <Pressable onPress={close}>
              <Text style={styles.cancel}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  delete: { color: colors.danger, textAlign: 'center', paddingVertical: 8, fontWeight: '600' },
  cancel: { color: colors.muted, textAlign: 'center', paddingVertical: 8 },
})
