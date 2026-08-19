import { colors, fonts, type } from '@/src/theme'
import { Stack } from 'expo-router'

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerTitleStyle: { ...type.heading, color: colors.ink },
        headerBackTitleStyle: { fontFamily: fonts.medium },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: true, title: 'Crear cuenta' }} />
    </Stack>
  )
}
