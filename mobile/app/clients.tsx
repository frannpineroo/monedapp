import { ApiError, apiRequest } from '@/src/api/client'
import type { Client } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { spacing, useThemeColors } from '@/src/theme'
import { Button, EmptyState, Field, ListRow, Screen, Select, Sheet, ThemedRefreshControl, Txt } from '@/src/ui'
import { screenPadding } from '@/src/ui/Screen'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native'

export default function ClientsScreen() {
  const c = useThemeColors()
  const { accessToken } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Client | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [currency, setCurrency] = useState('ARS')
  const [error, setError] = useState<string | null>(null)

  const open = Boolean(editing) || creating

  function openCreate() {
    setEditing(null)
    setCreating(true)
    setName('')
    setPhone('')
    setCurrency('ARS')
    setError(null)
  }

  function openEdit(client: Client) {
    setCreating(false)
    setEditing(client)
    setName(client.name)
    setPhone(client.phone ?? '')
    setCurrency(client.defaultCurrency)
    setError(null)
  }

  function close() {
    setCreating(false)
    setEditing(null)
    setError(null)
  }

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), phone: phone.trim(), defaultCurrency: currency }
      return editing
        ? apiRequest<Client>(`/clients/${editing.id}`, { method: 'PATCH', token: accessToken, body })
        : apiRequest<Client>('/clients', { method: 'POST', token: accessToken, body })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      close()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo guardar'),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/clients/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      close()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo borrar'),
  })

  function confirmRemove() {
    if (!editing) return
    Alert.alert('Borrar cliente', `¿Borrar "${editing.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => remove.mutate(editing.id) },
    ])
  }

  function submit() {
    setError(null)
    if (!name.trim()) {
      setError('Escribí un nombre')
      return
    }
    save.mutate()
  }

  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiRequest<Client[]>('/clients', { token: accessToken }),
    enabled: !!accessToken,
  })

  return (
    <Screen
      edges={['bottom']}
      footer={<Button label="Nuevo cliente" size="lg" block onPress={openCreate} />}
    >
      {clients.isLoading ? (
        <ActivityIndicator color={c.brand} style={styles.loader} />
      ) : (
        <FlatList
          data={clients.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <ThemedRefreshControl refreshing={clients.isFetching} onRefresh={() => clients.refetch()} />
          }
          ListEmptyComponent={
            <EmptyState
              title="Todavía no tenés clientes"
              body="Cargá a quién le facturás para seguir lo que te deben."
              actionLabel="Nuevo cliente"
              onAction={openCreate}
            />
          }
          renderItem={({ item }) => (
            <ListRow
              title={item.name}
              meta={`${item.defaultCurrency}${item.phone ? ` · ${item.phone}` : ''}`}
              onPress={() => openEdit(item)}
            />
          )}
        />
      )}

      <Sheet visible={open} title={editing ? 'Editar cliente' : 'Nuevo cliente'} onClose={close}>
        <Field
          label="Nombre"
          placeholder="Ej. Estudio Contable"
          value={name}
          onChangeText={setName}
          error={error ?? undefined}
        />
        <Field
          label="Teléfono (opcional)"
          keyboardType="phone-pad"
          placeholder="+54 9 11 2233 4455"
          value={phone}
          onChangeText={setPhone}
        />

        <Select
          nested
          label="Moneda por defecto"
          value={currency}
          options={['ARS', 'USD', 'USDT'].map((code) => ({ value: code, label: code }))}
          onChange={setCurrency}
        />

        <Button label="Guardar" size="lg" block loading={save.isPending} onPress={submit} />
        {editing ? (
          <Button
            label="Borrar cliente"
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
  loader: { marginTop: spacing.xxxl },
  list: {
    gap: spacing.sm,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  group: { gap: spacing.sm },
})
