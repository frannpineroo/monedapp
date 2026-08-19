import { apiRequest, ApiError } from '@/src/api/client'
import type { Client, Movement } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount } from '@/src/lib/format'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
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

  const movement = useQuery({
    queryKey: ['movement', id],
    queryFn: () => apiRequest<Movement>(`/movements/${id}`, { token: accessToken }),
    enabled: !!accessToken && !!id,
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
})
