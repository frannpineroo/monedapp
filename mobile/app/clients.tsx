import { ApiError, apiRequest } from '@/src/api/client'
import type { Client } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

export default function ClientsScreen() {
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
        ? apiRequest<Client>(`/clients/${editing.id}`, {
            method: 'PATCH',
            token: accessToken,
            body,
          })
        : apiRequest<Client>('/clients', { method: 'POST', token: accessToken, body })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      close()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo guardar'),
  })

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
            <Pressable style={styles.row} onPress={() => openEdit(item)}>
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
        <Pressable style={formStyles.button} onPress={openCreate}>
          <Text style={formStyles.buttonText}>Nuevo cliente</Text>
        </Pressable>
      </View>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editing ? 'Editar cliente' : 'Nuevo cliente'}</Text>

            <Text style={formStyles.label}>Nombre</Text>
            <TextInput
              style={formStyles.input}
              placeholder="Ej. Estudio Contable"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
            />

            <Text style={formStyles.label}>Teléfono (opcional)</Text>
            <TextInput
              style={formStyles.input}
              keyboardType="phone-pad"
              placeholder="+54 9 11 2233 4455"
              placeholderTextColor={colors.muted}
              value={phone}
              onChangeText={setPhone}
            />

            <Text style={formStyles.label}>Moneda por defecto</Text>
            <View style={formStyles.rowWrap}>
              {['ARS', 'USD', 'USDT'].map((c) => (
                <Pressable
                  key={c}
                  style={[formStyles.chip, currency === c && formStyles.chipActive]}
                  onPress={() => setCurrency(c)}
                >
                  <Text
                    style={[formStyles.chipText, currency === c && formStyles.chipTextActive]}
                  >
                    {c}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error ? <Text style={formStyles.error}>{error}</Text> : null}

            <Pressable style={formStyles.button} onPress={submit} disabled={save.isPending}>
              {save.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={formStyles.buttonText}>Guardar</Text>
              )}
            </Pressable>
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
  cancel: { color: colors.muted, textAlign: 'center', paddingVertical: 8 },
})
