import { apiRequest, ApiError } from '@/src/api/client'
import type { Client, Movement, Receivable, Wallet } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

export default function MovementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { accessToken } = useAuth()
  const queryClient = useQueryClient()
  const router = useRouter()

  const [description, setDescription] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collectWalletId, setCollectWalletId] = useState<string | null>(null)
  const [collectAmount, setCollectAmount] = useState('')

  const movement = useQuery({
    queryKey: ['movement', id],
    queryFn: () => apiRequest<Movement>(`/movements/${id}`, { token: accessToken }),
    enabled: !!accessToken && !!id,
  })

  const receivable = useQuery({
    queryKey: ['receivables', 'detail', id],
    queryFn: async () => {
      const rows = await apiRequest<Receivable[]>('/receivables', { token: accessToken })
      return rows.find((row) => row.id === id) ?? null
    },
    enabled: !!accessToken && movement.data?.type === 'invoice',
  })

  const wallets = useQuery({
    queryKey: ['wallets'],
    queryFn: () => apiRequest<Wallet[]>('/wallets', { token: accessToken }),
    enabled: !!accessToken && movement.data?.type === 'invoice',
  })

  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiRequest<Client[]>('/clients', { token: accessToken }),
    enabled: !!accessToken,
  })

  useEffect(() => {
    if (movement.data) {
      setDescription(movement.data.description)
      setClientId(movement.data.clientId)
    }
  }, [movement.data])

  // El monto arranca precargado con el saldo: cobrar todo es el caso común.
  useEffect(() => {
    if (receivable.data && collectAmount === '') {
      setCollectAmount(String(receivable.data.outstanding))
    }
  }, [receivable.data, collectAmount])

  const confirm = useMutation({
    mutationFn: () =>
      apiRequest<Movement>(`/movements/${id}`, {
        method: 'PATCH',
        token: accessToken,
        body: { description: description.trim(), clientId, needsReview: false },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['movements'] })
      await queryClient.invalidateQueries({ queryKey: ['movement', id] })
      router.back()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo guardar'),
  })

  const collect = useMutation({
    mutationFn: () =>
      apiRequest('/movements', {
        method: 'POST',
        token: accessToken,
        body: {
          type: 'collection',
          invoiceId: id,
          walletId: collectWalletId,
          amount: Number(collectAmount),
          date: new Date().toISOString().slice(0, 10),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['receivables'] })
      await queryClient.invalidateQueries({ queryKey: ['receivables-summary'] })
      await queryClient.invalidateQueries({ queryKey: ['movements'] })
      await queryClient.invalidateQueries({ queryKey: ['balance-by-wallet'] })
      setCollectAmount('')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo registrar el cobro'),
  })

  function remindOnWhatsApp() {
    const row = receivable.data
    if (!row) return

    const monto = formatAmount(row.outstanding, row.currency)
    const atraso = row.daysOverdue > 0 ? ` (${row.daysOverdue} días de atraso)` : ''
    const mensaje = `Hola ${row.client?.name ?? ''}, te paso el recordatorio de la factura "${row.description}": queda pendiente ${monto}${atraso}. ¡Gracias!`

    // Sin teléfono, wa.me sin número deja elegir el contacto en la app.
    const phone = (row.client?.phone ?? '').replace(/[^\d]/g, '')
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`)
  }

  if (movement.isLoading || !movement.data) {
    return <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
  }

  const isIncome = movement.data.type === 'income'

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Text style={styles.amount}>
        {formatAmount(movement.data.amount, movement.data.currency)}
      </Text>
      <Text style={styles.meta}>
        {movement.data.wallet?.name} · {movement.data.source ?? 'manual'}
      </Text>

      <Text style={formStyles.label}>Descripción</Text>
      <TextInput
        style={formStyles.input}
        value={description}
        onChangeText={setDescription}
        placeholderTextColor={colors.muted}
      />

      {isIncome ? (
        <>
          <Text style={formStyles.label}>Cliente</Text>
          <View style={formStyles.rowWrap}>
            <Pressable
              style={[formStyles.chip, clientId === null && formStyles.chipActive]}
              onPress={() => setClientId(null)}
            >
              <Text
                style={[formStyles.chipText, clientId === null && formStyles.chipTextActive]}
              >
                Sin cliente
              </Text>
            </Pressable>
            {(clients.data ?? []).map((c) => (
              <Pressable
                key={c.id}
                style={[formStyles.chip, clientId === c.id && formStyles.chipActive]}
                onPress={() => setClientId(c.id)}
              >
                <Text
                  style={[formStyles.chipText, clientId === c.id && formStyles.chipTextActive]}
                >
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {movement.data.type === 'invoice' && receivable.data ? (
        <>
          <Text style={formStyles.label}>
            Saldo pendiente: {formatAmount(receivable.data.outstanding, receivable.data.currency)}
          </Text>

          {receivable.data.collections.length > 0 ? (
            <View style={{ gap: 4 }}>
              {receivable.data.collections.map((c) => (
                <Text key={c.id} style={styles.meta}>
                  {new Date(c.date).toLocaleDateString('es-AR')} ·{' '}
                  {formatAmount(c.amount, c.currency)}
                </Text>
              ))}
            </View>
          ) : null}

          {receivable.data.status !== 'paid' ? (
            <>
              <Text style={formStyles.label}>Cobrar en</Text>
              <View style={formStyles.rowWrap}>
                {(wallets.data ?? []).map((w) => (
                  <Pressable
                    key={w.id}
                    style={[formStyles.chip, collectWalletId === w.id && formStyles.chipActive]}
                    onPress={() => setCollectWalletId(w.id)}
                  >
                    <Text
                      style={[
                        formStyles.chipText,
                        collectWalletId === w.id && formStyles.chipTextActive,
                      ]}
                    >
                      {w.name}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                style={formStyles.input}
                keyboardType="decimal-pad"
                value={collectAmount}
                onChangeText={setCollectAmount}
                placeholderTextColor={colors.muted}
              />

              <Pressable
                style={formStyles.button}
                onPress={() => {
                  setError(null)
                  if (!collectWalletId) {
                    setError('Elegí la billetera del cobro')
                    return
                  }
                  collect.mutate()
                }}
                disabled={collect.isPending}
              >
                {collect.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={formStyles.buttonText}>Registrar cobro</Text>
                )}
              </Pressable>

              <Pressable onPress={remindOnWhatsApp}>
                <Text style={styles.remind}>Recordar por WhatsApp</Text>
              </Pressable>
            </>
          ) : null}
        </>
      ) : null}

      {error ? <Text style={formStyles.error}>{error}</Text> : null}

      <Pressable style={formStyles.button} onPress={() => confirm.mutate()} disabled={confirm.isPending}>
        {confirm.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={formStyles.buttonText}>Confirmar</Text>
        )}
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  amount: { fontSize: 28, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted },
  remind: { color: colors.accent, textAlign: 'center', paddingVertical: 10, fontWeight: '600' },
})
