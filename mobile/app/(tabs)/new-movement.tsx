import { apiRequest } from '@/src/api/client'
import type { Movement, Wallet } from '@/src/api/types'
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

  const [type, setType] = useState<MovementType>('income')
  const [walletId, setWalletId] = useState<string | null>(null)
  const [toWalletId, setToWalletId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const selectedWalletId = walletId ?? wallets.data?.[0]?.id ?? null

  const create = useMutation({
    mutationFn: () =>
      apiRequest<Movement>('/movements', {
        method: 'POST',
        token: accessToken,
        body: {
          walletId: selectedWalletId,
          toWalletId: type === 'transfer' ? toWalletId : undefined,
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Text style={styles.label}>Tipo</Text>
      <View style={styles.row}>
        {(['income', 'expense', 'transfer'] as MovementType[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.chip, type === t && styles.chipActive]}
            onPress={() => setType(t)}
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
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
  },
})
