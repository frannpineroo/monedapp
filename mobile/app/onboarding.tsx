import { apiRequest } from '@/src/api/client'
import type { ProfileTemplate, User } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'

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
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>¿Cómo laburás?</Text>
      <Text style={styles.subtitle}>Elegí una plantilla. Armamos tus billeteras automáticamente.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={templates.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 12, paddingTop: 8 }}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => choose(item.id)}
            disabled={busyId !== null}
          >
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.cardDesc}>{item.description}</Text>
            {busyId === item.id ? <ActivityIndicator color={colors.accent} /> : null}
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 24,
    paddingTop: 64,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.ink,
  },
  subtitle: {
    fontSize: 16,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.ink,
  },
  cardDesc: {
    fontSize: 14,
    color: colors.muted,
  },
  error: {
    color: colors.danger,
    marginBottom: 8,
  },
})
