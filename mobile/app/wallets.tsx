import { ApiError, apiRequest } from '@/src/api/client'
import type { Wallet, WalletBalance } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
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

export default function WalletsScreen() {
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
            <Pressable style={styles.row} onPress={() => openEdit(item.wallet)}>
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
        <Pressable style={formStyles.button} onPress={openCreate}>
          <Text style={formStyles.buttonText}>Nueva billetera</Text>
        </Pressable>
      </View>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {editing ? 'Editar billetera' : 'Nueva billetera'}
            </Text>

            <Text style={formStyles.label}>Nombre</Text>
            <TextInput
              style={formStyles.input}
              placeholder="Ej. Mercado Pago"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
            />

            {editing ? (
              <Text style={styles.note}>La moneda ({editing.currency}) no se puede cambiar.</Text>
            ) : (
              <>
                <Text style={formStyles.label}>Moneda</Text>
                <View style={formStyles.rowWrap}>
                  {['ARS', 'USD', 'USDT'].map((c) => (
                    <Pressable
                      key={c}
                      style={[formStyles.chip, currency === c && formStyles.chipActive]}
                      onPress={() => setCurrency(c)}
                    >
                      <Text
                        style={[
                          formStyles.chipText,
                          currency === c && formStyles.chipTextActive,
                        ]}
                      >
                        {c}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

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
                <Text style={styles.delete}>Borrar billetera</Text>
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  note: { fontSize: 13, color: colors.muted },
  cancel: { color: colors.muted, textAlign: 'center', paddingVertical: 8 },
  delete: { color: colors.danger, textAlign: 'center', paddingVertical: 8, fontWeight: '600' },
})
