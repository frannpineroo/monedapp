import { apiRequest, ApiError } from '@/src/api/client'
import type { ConnectResponse, Integration, SyncResult } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import { formStyles } from '@/src/ui/formStyles'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

const statusLabel: Record<string, string> = {
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Error',
}

export default function IntegrationsScreen() {
  const { accessToken } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiRequest<Integration[]>('/integrations', { token: accessToken }),
    enabled: !!accessToken,
  })

  const mp = (integrations.data ?? []).find((i) => i.provider === 'mercadopago')

  async function refreshAll() {
    await queryClient.invalidateQueries({ queryKey: ['integrations'] })
    await queryClient.invalidateQueries({ queryKey: ['movements'] })
    await queryClient.invalidateQueries({ queryKey: ['balance-by-wallet'] })
    await queryClient.invalidateQueries({ queryKey: ['wallets'] })
  }

  const connect = useMutation({
    mutationFn: async () => {
      const returnUrl = Linking.createURL('integrations/mercadopago')
      const { authorizationUrl } = await apiRequest<ConnectResponse>(
        '/integrations/mercadopago/connect',
        { method: 'POST', token: accessToken, body: { mobileRedirectUri: returnUrl } }
      )

      const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, returnUrl)
      if (result.type !== 'success') return { status: 'cancelled' }

      const status = Linking.parse(result.url).queryParams?.status
      return { status: typeof status === 'string' ? status : 'unknown' }
    },
    onSuccess: async (result) => {
      await refreshAll()
      if (result.status !== 'connected' && result.status !== 'cancelled') {
        setError('No se pudo conectar Mercado Pago')
      }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo conectar'),
  })

  const sync = useMutation({
    mutationFn: () =>
      apiRequest<SyncResult>('/integrations/mercadopago/sync', {
        method: 'POST',
        token: accessToken,
        body: {},
      }),
    onSuccess: async (result) => {
      await refreshAll()
      Alert.alert('Sincronización', `Se importaron ${result.created} movimientos.`)
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo sincronizar'),
  })

  const disconnect = useMutation({
    mutationFn: () =>
      apiRequest<void>('/integrations/mercadopago', { method: 'DELETE', token: accessToken }),
    onSuccess: refreshAll,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo desconectar'),
  })

  const busy = connect.isPending || sync.isPending || disconnect.isPending

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <View style={styles.card}>
        <Text style={styles.title}>Mercado Pago</Text>
        <Text style={styles.status}>{statusLabel[mp?.status ?? 'disconnected']}</Text>
        {mp?.lastSyncAt ? (
          <Text style={styles.meta}>
            Última sincronización: {new Date(mp.lastSyncAt).toLocaleString('es-AR')}
          </Text>
        ) : null}
        {mp?.lastError ? <Text style={formStyles.error}>{mp.lastError}</Text> : null}
      </View>

      {error ? <Text style={formStyles.error}>{error}</Text> : null}

      {mp?.status === 'connected' ? (
        <>
          <Pressable style={formStyles.button} onPress={() => sync.mutate()} disabled={busy}>
            {sync.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={formStyles.buttonText}>Sincronizar ahora</Text>
            )}
          </Pressable>
          <Pressable onPress={() => disconnect.mutate()} disabled={busy}>
            <Text style={styles.disconnect}>Desconectar</Text>
          </Pressable>
        </>
      ) : (
        <Pressable style={formStyles.button} onPress={() => connect.mutate()} disabled={busy}>
          {connect.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={formStyles.buttonText}>Conectar Mercado Pago</Text>
          )}
        </Pressable>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.ink },
  status: { fontSize: 15, color: colors.accent, fontWeight: '600' },
  meta: { fontSize: 13, color: colors.muted },
  disconnect: { color: colors.danger, textAlign: 'center', paddingVertical: 10, fontWeight: '600' },
})
