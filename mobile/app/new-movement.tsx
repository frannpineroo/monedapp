import { apiRequest } from '@/src/api/client'
import type { Category, Client, ExchangeRate, Movement, Wallet } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { radius, spacing, type, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
import { Button, Chip, ChipRow, Field, Screen, Txt } from '@/src/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

type MovementType = 'income' | 'expense' | 'transfer' | 'invoice'

const typeOptions: { id: MovementType; label: string }[] = [
  { id: 'income', label: 'Ingreso' },
  { id: 'expense', label: 'Gasto' },
  { id: 'transfer', label: 'Transferencia' },
  { id: 'invoice', label: 'Factura' },
]

/** Grupo de opciones: rótulo arriba, chips debajo. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useThemeStyles(makeStyles)
  return (
    <View style={styles.group}>
      <Txt variant="label" tone="faint">
        {label}
      </Txt>
      <ChipRow>{children}</ChipRow>
    </View>
  )
}

export default function NewMovementScreen() {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
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
  const [invoiceCurrency, setInvoiceCurrency] = useState('ARS')
  const [dueDate, setDueDate] = useState('')

  const categoryKind = type === 'expense' ? 'EXPENSE' : 'INCOME'

  const categories = useQuery({
    queryKey: ['categories', categoryKind],
    queryFn: () => apiRequest<Category[]>(`/categories?kind=${categoryKind}`, { token: accessToken }),
    enabled: !!accessToken && type !== 'transfer',
  })

  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  const selectedWalletId = walletId ?? wallets.data?.[0]?.id ?? null

  const [rateType, setRateType] = useState<string | null>(null)

  const selectedWallet = useMemo(
    () => (wallets.data ?? []).find((w) => w.id === selectedWalletId) ?? null,
    [wallets.data, selectedWalletId]
  )
  const currency = type === 'invoice' ? invoiceCurrency : (selectedWallet?.currency ?? 'ARS')
  const today = new Date().toISOString().slice(0, 10)

  const rates = useQuery({
    queryKey: ['exchange-rates', currency, today],
    queryFn: () =>
      apiRequest<ExchangeRate[]>(`/exchange-rates?currency=${currency}&date=${today}`, {
        token: accessToken,
      }),
    enabled: !!accessToken && currency !== 'ARS',
  })

  // Si cambia la billetera, el tipo elegido puede no existir para la nueva moneda.
  const activeRate = (rates.data ?? []).find((r) => r.type === rateType) ?? rates.data?.[0] ?? null

  const createClient = useMutation({
    mutationFn: (name: string) =>
      apiRequest<Client>('/clients', { method: 'POST', token: accessToken, body: { name } }),
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

  const createCategory = useMutation({
    mutationFn: (name: string) =>
      apiRequest<Category>('/categories', {
        method: 'POST',
        token: accessToken,
        body: { name, kind: categoryKind },
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['categories'] })
      setCategoryId(created.id)
      setNewCategoryName('')
      setShowNewCategory(false)
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'No se pudo crear la categoría')
    },
  })

  const create = useMutation({
    mutationFn: () =>
      apiRequest<Movement>('/movements', {
        method: 'POST',
        token: accessToken,
        body:
          type === 'invoice'
            ? {
                type: 'invoice',
                clientId,
                amount: Number(amount),
                currency: invoiceCurrency,
                dueDate,
                description,
                date: new Date().toISOString().slice(0, 10),
                categoryId: categoryId ?? undefined,
              }
            : {
                walletId: selectedWalletId,
                toWalletId: type === 'transfer' ? toWalletId : undefined,
                clientId: type === 'income' && clientId ? clientId : undefined,
                categoryId: type !== 'transfer' ? (categoryId ?? undefined) : undefined,
                type,
                amount: Number(amount),
                description,
                date: new Date().toISOString().slice(0, 10),
                exchangeRateType: currency !== 'ARS' ? (activeRate?.type ?? undefined) : undefined,
              },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['movements'] })
      await queryClient.invalidateQueries({ queryKey: ['balance-by-wallet'] })
      await queryClient.invalidateQueries({ queryKey: ['receivables'] })
      setAmount('')
      setDescription('')
      setClientId(null)
      setCategoryId(null)
      setDueDate('')
      // Cierra el form sheet y devuelve al usuario a donde estaba. No lo
      // mandamos a otra tab: el alta es una interrupción, no un destino.
      router.back()
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
    if (next !== 'income' && next !== 'invoice') {
      setClientId(null)
      setShowNewClient(false)
      setNewClientName('')
    }
    setCategoryId(null)
    setShowNewCategory(false)
    setNewCategoryName('')
  }

  function submit() {
    setError(null)
    if (type === 'invoice') {
      if (!clientId) {
        setError('Elegí un cliente para la factura')
        return
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        setError('Escribí el vencimiento como 2026-09-14')
        return
      }
    } else if (!selectedWalletId) {
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
    if (type !== 'transfer' && type !== 'invoice' && !categoryId) {
      setError('Elegí una categoría')
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

  function submitNewCategory() {
    setError(null)
    const name = newCategoryName.trim()
    if (!name) {
      setError('Escribí el nombre de la categoría')
      return
    }
    createCategory.mutate(name)
  }

  const converted =
    activeRate && Number(amount) > 0
      ? Number(amount) * Number(activeRate.sell ?? activeRate.value)
      : null
  const estimatedRate = activeRate?.source === 'db-fallback' || activeRate?.source === 'stub'

  return (
    <Screen
      scroll
      footer={
        <Button
          label="Guardar movimiento"
          size="lg"
          block
          loading={create.isPending}
          onPress={submit}
        />
      }
    >
      <Txt variant="title" style={styles.title}>
        Nuevo movimiento
      </Txt>

      <ChipRow style={styles.typeRow}>
        {typeOptions.map((opt) => (
          <Chip
            key={opt.id}
            label={opt.label}
            selected={type === opt.id}
            onPress={() => selectType(opt.id)}
          />
        ))}
      </ChipRow>

      {/* El monto encabeza la carga: primero el número, después el contexto. */}
      <View style={styles.amountCard}>
        <Txt variant="label" tone="faint">
          {currency}
        </Txt>
        <TextInput
          style={styles.amountInput}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={c.faint}
          selectionColor={c.brand}
          value={amount}
          onChangeText={setAmount}
        />
        {converted !== null ? (
          <Txt variant="caption" tone="faint" align="right">
            ≈ {converted.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS
            {estimatedRate ? ' · cotización estimada' : ''}
          </Txt>
        ) : null}
      </View>

      <Field
        label="Descripción"
        placeholder="Ej. Cobro cliente X"
        value={description}
        onChangeText={setDescription}
        containerStyle={styles.field}
      />

      {type === 'invoice' ? (
        <>
          <Group label="Moneda">
            {['ARS', 'USD', 'USDT'].map((c) => (
              <Chip
                key={c}
                label={c}
                selected={invoiceCurrency === c}
                onPress={() => setInvoiceCurrency(c)}
              />
            ))}
          </Group>
          <Field
            label="Vence el"
            placeholder="2026-09-14"
            hint="Formato año-mes-día."
            value={dueDate}
            onChangeText={setDueDate}
            containerStyle={styles.field}
          />
        </>
      ) : (
        <Group label={type === 'transfer' ? 'Desde' : 'Billetera'}>
          {(wallets.data ?? []).map((w) => (
            <Chip
              key={w.id}
              label={w.name}
              selected={selectedWalletId === w.id}
              onPress={() => setWalletId(w.id)}
            />
          ))}
        </Group>
      )}

      {type === 'transfer' ? (
        <Group label="Hacia">
          {otherWallets.map((w) => (
            <Chip
              key={w.id}
              label={w.name}
              selected={toWalletId === w.id}
              onPress={() => setToWalletId(w.id)}
            />
          ))}
        </Group>
      ) : null}

      {type === 'income' || type === 'invoice' ? (
        <>
          <Group label={type === 'invoice' ? 'Cliente' : 'Cliente (opcional)'}>
            {type === 'income' ? (
              <Chip label="Sin cliente" selected={clientId === null} onPress={() => setClientId(null)} />
            ) : null}
            {(clients.data ?? []).map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={clientId === c.id}
                onPress={() => setClientId(c.id)}
              />
            ))}
            <Chip
              label="Nuevo cliente"
              selected={showNewClient}
              onPress={() => setShowNewClient((v) => !v)}
            />
          </Group>
          {showNewClient ? (
            <View style={styles.inlineCreate}>
              <Field
                placeholder="Nombre del cliente"
                value={newClientName}
                onChangeText={setNewClientName}
                containerStyle={styles.inlineField}
              />
              <Button
                label="Agregar"
                variant="secondary"
                loading={createClient.isPending}
                onPress={submitNewClient}
              />
            </View>
          ) : null}
        </>
      ) : null}

      {type !== 'transfer' ? (
        <>
          <Group label="Categoría">
            {(categories.data ?? []).map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={categoryId === c.id}
                onPress={() => setCategoryId(c.id)}
              />
            ))}
            <Chip
              label="Nueva categoría"
              selected={showNewCategory}
              onPress={() => setShowNewCategory((v) => !v)}
            />
          </Group>
          {showNewCategory ? (
            <View style={styles.inlineCreate}>
              <Field
                placeholder="Nombre de la categoría"
                value={newCategoryName}
                onChangeText={setNewCategoryName}
                containerStyle={styles.inlineField}
              />
              <Button
                label="Agregar"
                variant="secondary"
                loading={createCategory.isPending}
                onPress={submitNewCategory}
              />
            </View>
          ) : null}
        </>
      ) : null}

      {currency !== 'ARS' && (rates.data ?? []).length > 0 ? (
        <Group label="Cotización">
          {(rates.data ?? []).map((r) => (
            <Chip
              key={r.id}
              label={`${r.type} ${Number(r.sell ?? r.value).toLocaleString('es-AR', {
                maximumFractionDigits: 0,
              })}`}
              selected={activeRate?.id === r.id}
              onPress={() => setRateType(r.type)}
            />
          ))}
        </Group>
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
    title: { marginBottom: spacing.lg },
    typeRow: { marginBottom: spacing.xl },
    amountCard: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.lg,
      marginBottom: spacing.xl,
    },
    amountInput: {
      ...type.display,
      color: c.ink,
      textAlign: 'right',
      paddingVertical: spacing.xs,
    },
    field: { marginBottom: spacing.xl },
    group: { gap: spacing.sm, marginBottom: spacing.xl },
    inlineCreate: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      marginTop: -spacing.md,
      marginBottom: spacing.xl,
    },
    inlineField: { flex: 1 },
    error: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.danger,
      backgroundColor: c.dangerSoft,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
  })
