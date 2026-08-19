import { useAuth } from '@/src/auth/AuthContext'
import { spacing } from '@/src/theme'
import { Button, Field, LinkButton, Screen, Txt } from '@/src/ui'
import { Wordmark } from '@/src/ui/Wordmark'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'

export default function LoginScreen() {
  const { login } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo entrar. Revisá el email y la contraseña.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <View style={styles.intro}>
            <Wordmark />
            <Txt variant="body" tone="muted">
              Tu plata en pesos y dólares, en un solo lugar.
            </Txt>
          </View>

          <View style={styles.form}>
            <Field
              label="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="vos@ejemplo.com"
              value={email}
              onChangeText={setEmail}
            />
            <Field
              label="Contraseña"
              secureTextEntry
              autoComplete="current-password"
              placeholder="········"
              value={password}
              onChangeText={setPassword}
              error={error ?? undefined}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
            <Button label="Entrar" size="lg" block loading={busy} onPress={onSubmit} />
          </View>

          <View style={styles.footer}>
            <Txt variant="caption" tone="faint">
              ¿Primera vez acá?
            </Txt>
            <LinkButton label="Crear cuenta" onPress={() => router.push('/(auth)/register')} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.huge,
  },
  intro: { gap: spacing.md },
  form: { gap: spacing.lg },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
})
