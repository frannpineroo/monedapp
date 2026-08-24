import { apiRequest } from '@/src/api/client'
import type { Category, Client, Wallet } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { radius, spacing, useTheme, useThemeStyles, type Colors, type ThemePreference } from '@/src/theme'
import { Button, Chip, ChipRow, Screen, Section, Txt } from '@/src/ui'
import Feather from '@expo/vector-icons/Feather'
import { useQuery } from '@tanstack/react-query'
import { useRouter, type Href } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

const themeOptions: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'Automático' },
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
]

export default function SettingsScreen() {
  const styles = useThemeStyles(makeStyles)
  const { preference, setPreference, colors: c } = useTheme()
  const { accessToken, user, logout } = useAuth()
  const router = useRouter()

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

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiRequest<Category[]>('/categories', { token: accessToken }),
    enabled: !!accessToken,
  })

  const rows: { href: Href; label: string; count?: number }[] = [
    { href: '/wallets', label: 'Billeteras', count: wallets.data?.length },
    { href: '/clients', label: 'Clientes', count: clients.data?.length },
    { href: '/categories', label: 'Categorías', count: categories.data?.length },
    { href: '/integrations', label: 'Integraciones' },
  ]

  return (
    <Screen scroll>
      <Txt variant="title" style={styles.title}>
        Ajustes
      </Txt>

      <Section title="Tus datos">
        <View style={styles.card}>
          {rows.map((row, index) => (
            <Pressable
              key={String(row.href)}
              onPress={() => router.push(row.href)}
              style={({ pressed }) => [
                styles.row,
                index < rows.length - 1 && styles.rowBorder,
                pressed && styles.rowPressed,
              ]}
            >
              <Txt variant="bodyMedium">{row.label}</Txt>
              <View style={styles.rowRight}>
                {row.count !== undefined ? (
                  <Txt variant="caption" tone="faint">
                    {row.count}
                  </Txt>
                ) : null}
                <Feather name="chevron-right" size={16} color={c.faint} />
              </View>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title="Apariencia">
        <ChipRow>
          {themeOptions.map((option) => (
            <Chip
              key={option.id}
              label={option.label}
              selected={preference === option.id}
              onPress={() => setPreference(option.id)}
            />
          ))}
        </ChipRow>
        <Txt variant="caption" tone="faint" style={styles.appearanceHint}>
          Automático sigue el ajuste de tu teléfono.
        </Txt>
      </Section>

      <Section title="Cuenta">
        <View style={styles.card}>
          <View style={[styles.row, styles.rowBorder]}>
            <Txt variant="bodyMedium">Email</Txt>
            <Txt variant="caption" tone="faint">
              {user?.email}
            </Txt>
          </View>
          <View style={styles.logoutRow}>
            <Button label="Cerrar sesión" variant="destructive" block onPress={() => logout()} />
          </View>
        </View>
      </Section>
    </Screen>
  )
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    title: { marginBottom: spacing.xxl },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
      minHeight: 52,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowPressed: { backgroundColor: c.surfaceRaised },
    rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    logoutRow: { padding: spacing.lg },
    appearanceHint: { marginTop: spacing.xs },
  })
