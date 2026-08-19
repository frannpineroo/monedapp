import { ApiError, apiRequest } from '@/src/api/client'
import type { ConnectResponse, Integration, SyncResult } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors, radius, spacing } from '@/src/theme'
import { Badge, Button, Card, Screen, Txt, type BadgeTone } from '@/src/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'

const statusLabel: Record<string, string> = {
  connected: 'Conectado',
  disconnected: 'Sin conectar',
  error: 'Con error',
}

const statusTone: Record<string, BadgeTone> = {
  connected: 'positive',
  disconnected: 'neutral',
  error: 'attention',
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
  const status = mp?.status ?? 'disconnected'

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
    <Screen scroll>
      <Txt variant="caption" tone="faint" style={styles.intro}>
        Lo que llegue de una integración entra como movimiento para revisar, no directo al balance.
      </Txt>

      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Txt variant="heading">Mercado Pago</Txt>
          <Badge label={statusLabel[status]} tone={statusTone[status]} />
        </View>
        {mp?.lastSyncAt ? (
          <Txt variant="caption" tone="faint">
            Última sincronización: {new Date(mp.lastSyncAt).toLocaleString('es-AR')}
          </Txt>
        ) : (
          <Txt variant="caption" tone="faint">
            Conectá tu cuenta para importar los cobros automáticamente.
          </Txt>
        )}
        {mp?.lastError ? (
          <Txt variant="caption" tone="danger">
            {mp.lastError}
          </Txt>
        ) : null}
      </Card>

      {error ? (
        <View style={styles.error}>
          <Txt variant="captionStrong" tone="danger">
            {error}
          </Txt>
        </View>
      ) : null}

      {status === 'connected' ? (
        <View style={styles.actions}>
          <Button
            label="Sincronizar ahora"
            size="lg"
            block
            loading={sync.isPending}
            disabled={busy}
            onPress={() => sync.mutate()}
          />
          <Button
            label="Desconectar"
            variant="destructive"
            block
            loading={disconnect.isPending}
            disabled={busy}
            onPress={() => disconnect.mutate()}
          />
        </View>
      ) : (
        <Button
          label="Conectar Mercado Pago"
          size="lg"
          block
          loading={connect.isPending}
          disabled={busy}
          onPress={() => connect.mutate()}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  intro: { marginBottom: spacing.lg },
  card: { marginBottom: spacing.xl },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  actions: { gap: spacing.md },
  error: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.attentionEdge,
    backgroundColor: colors.attentionSoft,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
})
