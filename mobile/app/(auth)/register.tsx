import { useAuth } from '@/src/auth/AuthContext'
import { spacing } from '@/src/theme'
import { Button, Field, Screen, Txt } from '@/src/ui'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'

export default function RegisterScreen() {
  const { register } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    setBusy(true)
    setError(null)
    try {
      await register(email.trim(), password)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la cuenta.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <View style={styles.intro}>
            <Txt variant="title">Empezá en minutos</Txt>
            <Txt variant="body" tone="muted">
              Elegís tu perfil y te armamos las billeteras y categorías.
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
              autoComplete="new-password"
              placeholder="Elegí una contraseña"
              hint="Usá al menos 8 caracteres."
              value={password}
              onChangeText={setPassword}
              error={error ?? undefined}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
            <Button label="Crear cuenta" size="lg" block loading={busy} onPress={onSubmit} />
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
    gap: spacing.xxxl,
  },
  intro: { gap: spacing.sm },
  form: { gap: spacing.lg },
})
