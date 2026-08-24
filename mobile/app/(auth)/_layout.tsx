import { fonts, type, useThemeColors } from '@/src/theme'
import { Stack } from 'expo-router'

export default function AuthLayout() {
  const c = useThemeColors()
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.ink,
        headerTitleStyle: { ...type.heading, color: c.ink },
        headerBackTitleStyle: { fontFamily: fonts.medium },
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: true, title: 'Crear cuenta' }} />
    </Stack>
  )
}
