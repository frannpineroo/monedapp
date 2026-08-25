import { ApiError, apiRequest } from '@/src/api/client'
import type { Client, Movement, Receivable, Wallet } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { formatAmount, signForType, toneForType } from '@/src/lib/format'
import { radius, spacing, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
import { Button, Field, Money, Screen, Select, Txt } from '@/src/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

/** `null` no puede ser el value de una opción: este centinela lo representa. */
const SIN_CLIENTE = '__none__'

const typeLabel: Record<Movement['type'], string> = {
  income: 'Ingreso',
  expense: 'Gasto',
  transfer: 'Transferencia',
  invoice: 'Factura',
  collection: 'Cobro',
}

export default function MovementDetailScreen() {
  const styles = useThemeStyles(makeStyles)
  const theme = useThemeColors()
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
    return (
      <Screen contentStyle={styles.centered}>
        <ActivityIndicator color={theme.brand} />
      </Screen>
    )
  }

  const data = movement.data
  const isIncome = data.type === 'income'
  const isInvoice = data.type === 'invoice'
  const collecting = isInvoice && receivable.data != null && receivable.data.status !== 'paid'

  return (
    <Screen
      scroll
      edges={['bottom']}
      footer={
        // Cobrar es la acción principal de una factura: ahí el guardado pasa a segundo plano.
        <Button
          label={data.needsReview ? 'Confirmar movimiento' : 'Guardar cambios'}
          variant={collecting ? 'secondary' : 'primary'}
          size="lg"
          block
          loading={confirm.isPending}
          onPress={() => confirm.mutate()}
        />
      }
    >
      <View style={styles.hero}>
        <Txt variant="label" tone="faint">
          {data.currency}
        </Txt>
        <Money
          value={data.amount}
          variant="display"
          sign={signForType(data.type)}
          tone={toneForType(data.type)}
        />
        <Txt variant="caption" tone="faint" align="right" style={styles.heroMeta}>
          {typeLabel[data.type]} · {data.wallet?.name ?? data.currency} · {data.source ?? 'manual'}
        </Txt>
      </View>

      <Field
        label="Descripción"
        value={description}
        onChangeText={setDescription}
        containerStyle={styles.field}
      />

      {isIncome ? (
        <View style={styles.group}>
          <Select
            label="Cliente"
            value={clientId ?? SIN_CLIENTE}
            options={[
              { value: SIN_CLIENTE, label: 'Sin cliente' },
              ...(clients.data ?? []).map((client) => ({ value: client.id, label: client.name })),
            ]}
            onChange={(next) => setClientId(next === SIN_CLIENTE ? null : next)}
          />
        </View>
      ) : null}

      {isInvoice && receivable.data ? (
        <View style={styles.invoiceCard}>
          <View style={styles.outstandingRow}>
            <Txt variant="label" tone="faint">
              Saldo pendiente
            </Txt>
            <Money
              value={receivable.data.outstanding}
              tone={receivable.data.status === 'overdue' ? 'attention' : 'ink'}
            />
          </View>

          {receivable.data.collections.length > 0 ? (
            <View style={styles.collections}>
              {receivable.data.collections.map((c) => (
                <View key={c.id} style={styles.collectionRow}>
                  <Txt variant="caption" tone="faint">
                    {new Date(c.date).toLocaleDateString('es-AR')}
                  </Txt>
                  <Money value={c.amount} tone="positive" sign="+" />
                </View>
              ))}
            </View>
          ) : null}

          {receivable.data.status !== 'paid' ? (
            <>
              <View style={styles.group}>
                <Select
                  label="Cobrar en"
                  value={collectWalletId}
                  options={(wallets.data ?? []).map((w) => ({
                    value: w.id,
                    label: w.name,
                    meta: w.currency,
                  }))}
                  onChange={setCollectWalletId}
                />
              </View>

              <Field
                label="Monto del cobro"
                keyboardType="decimal-pad"
                value={collectAmount}
                onChangeText={setCollectAmount}
              />

              <Button
                label="Registrar cobro"
                block
                loading={collect.isPending}
                onPress={() => {
                  setError(null)
                  if (!collectWalletId) {
                    setError('Elegí la billetera del cobro')
                    return
                  }
                  collect.mutate()
                }}
              />
              <Button label="Recordar por WhatsApp" variant="secondary" block onPress={remindOnWhatsApp} />
            </>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <View style={styles.error}>
          <Txt variant="captionStrong" tone="danger">
            {error}
          </Txt>
        </View>
      ) : null}
    </Screen>
  )
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    centered: { alignItems: 'center', justifyContent: 'center' },
    hero: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.lg,
      marginBottom: spacing.xl,
    },
    heroMeta: { marginTop: spacing.sm },
    field: { marginBottom: spacing.xl },
    group: { gap: spacing.sm, marginBottom: spacing.xl },
    invoiceCard: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.lg,
      gap: spacing.lg,
      marginBottom: spacing.xl,
    },
    outstandingRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    collections: {
      gap: spacing.sm,
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    collectionRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    },
    error: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.danger,
      backgroundColor: c.dangerSoft,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
  })
