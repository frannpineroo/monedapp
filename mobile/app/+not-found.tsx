import { spacing } from '@/src/theme'
import { Button, Screen, Txt } from '@/src/ui'
import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'

export default function NotFoundScreen() {
  const router = useRouter()

  return (
    <Screen contentStyle={styles.container}>
      <View style={styles.body}>
        <Txt variant="title" align="center">
          Esta pantalla no existe
        </Txt>
        <Txt variant="body" tone="muted" align="center">
          El enlace que abriste no lleva a ningún lado de la app.
        </Txt>
        <Button label="Ir al inicio" size="lg" onPress={() => router.replace('/')} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  body: { alignItems: 'center', gap: spacing.lg, maxWidth: 320 },
})
