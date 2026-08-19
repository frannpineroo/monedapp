import { apiRequest } from '@/src/api/client'
import type { ProfileTemplate, User } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors, radius, spacing } from '@/src/theme'
import { Card, Screen, Txt } from '@/src/ui'
import Feather from '@expo/vector-icons/Feather'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

export default function OnboardingScreen() {
  const { accessToken, setUser } = useAuth()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const templates = useQuery({
    queryKey: ['profile-templates'],
    queryFn: () => apiRequest<ProfileTemplate[]>('/profile-templates'),
  })

  async function choose(templateId: string) {
    if (!accessToken) return
    setBusyId(templateId)
    setError(null)
    try {
      const user = await apiRequest<User>('/users/me/onboarding', {
        method: 'POST',
        token: accessToken,
        body: { templateId },
      })
      setUser(user)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar el onboarding')
    } finally {
      setBusyId(null)
    }
  }

  if (templates.isLoading) {
    return (
      <Screen contentStyle={styles.centered}>
        <ActivityIndicator color={colors.brand} />
      </Screen>
    )
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.intro}>
        <Txt variant="title">¿Cómo laburás?</Txt>
        <Txt variant="body" tone="muted">
          Elegí una plantilla y te armamos las billeteras y categorías.
        </Txt>
      </View>

      {error ? (
        <View style={styles.error}>
          <Txt variant="captionStrong" tone="danger">
            {error}
          </Txt>
        </View>
      ) : null}

      <View style={styles.list}>
        {(templates.data ?? []).map((item) => (
          <Card key={item.id} onPress={busyId === null ? () => choose(item.id) : undefined}>
            <View style={styles.cardRow}>
              <View style={styles.cardText}>
                <Txt variant="bodyStrong">{item.name}</Txt>
                <Txt variant="caption" tone="faint" style={styles.cardDesc}>
                  {item.description}
                </Txt>
              </View>
              {busyId === item.id ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Feather name="arrow-right" size={18} color={colors.faint} />
              )}
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { paddingTop: spacing.huge },
  intro: { gap: spacing.sm, marginBottom: spacing.xxxl },
  list: { gap: spacing.md },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  cardText: { flex: 1 },
  cardDesc: { marginTop: spacing.xs },
  error: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.attentionEdge,
    backgroundColor: colors.attentionSoft,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
})
