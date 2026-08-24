import { ApiError, apiRequest } from '@/src/api/client'
import type { Category } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { spacing, useThemeColors } from '@/src/theme'
import { Button, Chip, ChipRow, EmptyState, Field, ListRow, Screen, Sheet, ThemedRefreshControl } from '@/src/ui'
import { screenPadding } from '@/src/ui/Screen'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native'

type Kind = 'EXPENSE' | 'INCOME'

export default function CategoriesScreen() {
  const c = useThemeColors()
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
    queryFn: () => apiRequest<Category[]>(`/categories?kind=${kind}`, { token: accessToken }),
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
    <Screen
      edges={['bottom']}
      footer={<Button label="Nueva categoría" size="lg" block onPress={openCreate} />}
    >
      <View style={styles.filters}>
        <ChipRow>
          <Chip label="Gastos" selected={kind === 'EXPENSE'} onPress={() => setKind('EXPENSE')} />
          <Chip label="Ingresos" selected={kind === 'INCOME'} onPress={() => setKind('INCOME')} />
        </ChipRow>
      </View>

      {categories.isLoading ? (
        <ActivityIndicator color={c.brand} style={styles.loader} />
      ) : (
        <FlatList
          data={categories.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <ThemedRefreshControl refreshing={categories.isFetching} onRefresh={() => categories.refetch()} />
          }
          ListEmptyComponent={
            <EmptyState
              title={`Sin categorías de ${kind === 'EXPENSE' ? 'gasto' : 'ingreso'}`}
              body="Las categorías arman el informe de en qué se te va la plata."
              actionLabel="Nueva categoría"
              onAction={openCreate}
            />
          }
          renderItem={({ item }) => <ListRow title={item.name} onPress={() => openEdit(item)} />}
        />
      )}

      <Sheet
        visible={open}
        title={
          editing
            ? 'Editar categoría'
            : `Nueva categoría de ${kind === 'EXPENSE' ? 'gasto' : 'ingreso'}`
        }
        onClose={close}
      >
        <Field
          label="Nombre"
          placeholder="Ej. Herramientas y software"
          value={name}
          onChangeText={setName}
          error={error ?? undefined}
        />
        <Button label="Guardar" size="lg" block loading={save.isPending} onPress={submit} />
        {editing ? (
          <Button
            label="Borrar categoría"
            variant="destructive"
            block
            loading={remove.isPending}
            onPress={confirmRemove}
          />
        ) : null}
      </Sheet>
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
    paddingBottom: spacing.xxl,
  },
})
