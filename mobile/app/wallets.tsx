import { ApiError, apiRequest } from '@/src/api/client'
import type { Wallet, WalletBalance } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { spacing, useThemeColors } from '@/src/theme'
import { Button, EmptyState, Field, LedgerCell, ListRow, Screen, Select, Sheet, ThemedRefreshControl, Txt } from '@/src/ui'
import { screenPadding } from '@/src/ui/Screen'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native'

export default function WalletsScreen() {
  const c = useThemeColors()
  const { accessToken } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Wallet | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('ARS')
  const [error, setError] = useState<string | null>(null)

  const open = Boolean(editing) || creating

  function openCreate() {
    setEditing(null)
    setCreating(true)
    setName('')
    setCurrency('ARS')
    setError(null)
  }

  function openEdit(wallet: Wallet) {
    setCreating(false)
    setEditing(wallet)
    setName(wallet.name)
    setCurrency(wallet.currency)
    setError(null)
  }

  function close() {
    setCreating(false)
    setEditing(null)
    setError(null)
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['wallets'] })
    await queryClient.invalidateQueries({ queryKey: ['balance-by-wallet'] })
  }

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiRequest<Wallet>(`/wallets/${editing.id}`, {
            method: 'PATCH',
            token: accessToken,
            body: { name: name.trim() },
          })
        : apiRequest<Wallet>('/wallets', {
            method: 'POST',
            token: accessToken,
            body: { name: name.trim(), currency },
          }),
    onSuccess: async () => {
      await refresh()
      close()
    },
    // El backend ya manda el mensaje en castellano (409 = nombre repetido).
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo guardar'),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/wallets/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      await refresh()
      close()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo borrar'),
  })

  function confirmRemove() {
    if (!editing) return
    Alert.alert('Borrar billetera', `¿Borrar "${editing.name}"?`, [
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

  const balances = useQuery({
    queryKey: ['balance-by-wallet'],
    queryFn: () => apiRequest<WalletBalance[]>('/reports/balance-by-wallet', { token: accessToken }),
    enabled: !!accessToken,
  })

  return (
    <Screen
      edges={['bottom']}
      footer={<Button label="Nueva billetera" size="lg" block onPress={openCreate} />}
    >
      {balances.isLoading ? (
        <ActivityIndicator color={c.brand} style={styles.loader} />
      ) : (
        <FlatList
          data={balances.data ?? []}
          keyExtractor={(item) => item.wallet.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <ThemedRefreshControl refreshing={balances.isFetching} onRefresh={() => balances.refetch()} />
          }
          ListEmptyComponent={
            <EmptyState
              title="Todavía no tenés billeteras"
              body="Una billetera por cuenta o efectivo, en la moneda que uses."
              actionLabel="Nueva billetera"
              onAction={openCreate}
            />
          }
          renderItem={({ item }) => (
            <ListRow
              title={item.wallet.name}
              onPress={() => openEdit(item.wallet)}
              right={<LedgerCell value={item.balance} currency={item.currency} />}
            />
          )}
        />
      )}

      <Sheet visible={open} title={editing ? 'Editar billetera' : 'Nueva billetera'} onClose={close}>
        <Field
          label="Nombre"
          placeholder="Ej. Mercado Pago"
          value={name}
          onChangeText={setName}
          error={error ?? undefined}
        />

        {editing ? (
          <Txt variant="caption" tone="faint">
            La moneda ({editing.currency}) no se puede cambiar.
          </Txt>
        ) : (
          <Select
            nested
            label="Moneda"
            value={currency}
            options={['ARS', 'USD', 'USDT'].map((code) => ({ value: code, label: code }))}
            onChange={setCurrency}
          />
        )}

        <Button label="Guardar" size="lg" block loading={save.isPending} onPress={submit} />
        {editing ? (
          <Button
            label="Borrar billetera"
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
