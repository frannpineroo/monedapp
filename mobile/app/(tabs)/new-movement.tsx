import { apiRequest } from '@/src/api/client'
import type { Client, Movement, Wallet } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

type MovementType = 'income' | 'expense' | 'transfer'

export default function NewMovementScreen() {
  const { accessToken } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()

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

  const [type, setType] = useState<MovementType>('income')
  const [walletId, setWalletId] = useState<string | null>(null)
  const [toWalletId, setToWalletId] = useState<string | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const selectedWalletId = walletId ?? wallets.data?.[0]?.id ?? null

  const createClient = useMutation({
    mutationFn: (name: string) =>
      apiRequest<Client>('/clients', {
        method: 'POST',
        token: accessToken,
        body: { name },
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      setClientId(created.id)
      setNewClientName('')
      setShowNewClient(false)
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'No se pudo crear el cliente')
    },
  })

  const create = useMutation({
    mutationFn: () =>
      apiRequest<Movement>('/movements', {
        method: 'POST',
        token: accessToken,
        body: {
          walletId: selectedWalletId,
          toWalletId: type === 'transfer' ? toWalletId : undefined,
          clientId: type === 'income' && clientId ? clientId : undefined,
          type,
          amount: Number(amount),
          description,
          date: new Date().toISOString().slice(0, 10),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['movements'] })
      await queryClient.invalidateQueries({ queryKey: ['balance-by-wallet'] })
      setAmount('')
      setDescription('')
      setClientId(null)
      router.push('/(tabs)/movements')
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    },
  })

  const otherWallets = useMemo(
    () => (wallets.data ?? []).filter((w) => w.id !== selectedWalletId),
    [wallets.data, selectedWalletId]
  )

  function selectType(next: MovementType) {
    setType(next)
    if (next !== 'income') {
      setClientId(null)
      setShowNewClient(false)
      setNewClientName('')
    }
  }

  function submit() {
    setError(null)
    if (!selectedWalletId) {
      setError('Elegí una billetera')
      return
    }
    if (!description.trim()) {
      setError('Escribí una descripción')
      return
    }
    if (!(Number(amount) > 0)) {
      setError('El monto debe ser mayor a 0')
      return
    }
    if (type === 'transfer' && !toWalletId) {
      setError('Elegí billetera destino')
      return
    }
    create.mutate()
  }

  function submitNewClient() {
    setError(null)
    const name = newClientName.trim()
    if (!name) {
      setError('Escribí el nombre del cliente')
      return
    }
    createClient.mutate(name)
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Text style={styles.label}>Tipo</Text>
      <View style={styles.row}>
        {(['income', 'expense', 'transfer'] as MovementType[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.chip, type === t && styles.chipActive]}
            onPress={() => selectType(t)}
          >
            <Text style={[styles.chipText, type === t && styles.chipTextActive]}>
              {t === 'income' ? 'Ingreso' : t === 'expense' ? 'Gasto' : 'Transferencia'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>{type === 'transfer' ? 'Desde' : 'Billetera'}</Text>
      <View style={styles.rowWrap}>
        {(wallets.data ?? []).map((w) => (
          <Pressable
            key={w.id}
            style={[styles.chip, selectedWalletId === w.id && styles.chipActive]}
            onPress={() => setWalletId(w.id)}
          >
            <Text
              style={[styles.chipText, selectedWalletId === w.id && styles.chipTextActive]}
            >
              {w.name}
            </Text>
          </Pressable>
        ))}
      </View>

      {type === 'transfer' ? (
        <>
          <Text style={styles.label}>Hacia</Text>
          <View style={styles.rowWrap}>
            {otherWallets.map((w) => (
              <Pressable
                key={w.id}
                style={[styles.chip, toWalletId === w.id && styles.chipActive]}
                onPress={() => setToWalletId(w.id)}
              >
                <Text style={[styles.chipText, toWalletId === w.id && styles.chipTextActive]}>
                  {w.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {type === 'income' ? (
        <>
          <Text style={styles.label}>Cliente (opcional)</Text>
          <View style={styles.rowWrap}>
            <Pressable
              style={[styles.chip, clientId === null && styles.chipActive]}
              onPress={() => setClientId(null)}
            >
              <Text style={[styles.chipText, clientId === null && styles.chipTextActive]}>
                Sin cliente
              </Text>
            </Pressable>
            {(clients.data ?? []).map((c) => (
              <Pressable
                key={c.id}
                style={[styles.chip, clientId === c.id && styles.chipActive]}
                onPress={() => setClientId(c.id)}
              >
                <Text style={[styles.chipText, clientId === c.id && styles.chipTextActive]}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.chip, showNewClient && styles.chipActive]}
              onPress={() => setShowNewClient((v) => !v)}
            >
              <Text style={[styles.chipText, showNewClient && styles.chipTextActive]}>
                Nuevo cliente
              </Text>
            </Pressable>
          </View>
          {showNewClient ? (
            <View style={styles.newClientRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Nombre del cliente"
                placeholderTextColor={colors.muted}
                value={newClientName}
                onChangeText={setNewClientName}
              />
              <Pressable
                style={styles.smallButton}
                onPress={submitNewClient}
                disabled={createClient.isPending}
              >
                {createClient.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Agregar</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}

      <Text style={styles.label}>Monto</Text>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={colors.muted}
        value={amount}
        onChangeText={setAmount}
      />

      <Text style={styles.label}>Descripción</Text>
      <TextInput
        style={styles.input}
        placeholder="Ej. Cobro cliente X"
        placeholderTextColor={colors.muted}
        value={description}
        onChangeText={setDescription}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.button} onPress={submit} disabled={create.isPending}>
        {create.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Guardar movimiento</Text>
        )}
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  newClientRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.ink,
    fontSize: 14,
  },
  chipTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  smallButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 88,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
  },
})
