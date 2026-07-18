import { Stack } from 'expo-router'

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: '#F7F4EF' },
        headerTintColor: '#1C1917',
      }}
    >
      <Stack.Screen name="login" options={{ title: 'MonedApp' }} />
      <Stack.Screen name="register" options={{ title: 'Crear cuenta' }} />
    </Stack>
  )
}
