import { AuthProvider, useAuth } from '@/src/auth/AuthContext'
import { colors, fonts, ThemeProvider as AppThemeProvider, type } from '@/src/theme'
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from '@expo-google-fonts/archivo'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments, type Theme } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

SplashScreen.preventAutoHideAsync()

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.brand,
    background: colors.bg,
    card: colors.bg,
    text: colors.ink,
    border: colors.border,
    notification: colors.brand,
  },
}

/** Cabecera compartida por las pantallas apiladas fuera de las tabs. */
const stackHeader = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.bg },
  headerShadowVisible: false,
  headerTintColor: colors.ink,
  headerTitleStyle: { ...type.heading, color: colors.ink },
  headerBackTitleStyle: { fontFamily: fonts.medium },
} as const

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return

    const inAuth = segments[0] === '(auth)'
    const inOnboarding = segments[0] === 'onboarding'

    if (!user && !inAuth) {
      router.replace('/(auth)/login')
      return
    }

    if (user && !user.profileTemplate && !inOnboarding) {
      router.replace('/onboarding')
      return
    }

    if (user?.profileTemplate && (inAuth || inOnboarding)) {
      router.replace('/(tabs)')
    }
  }, [user, loading, segments, router])

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    )
  }

  return <>{children}</>
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient())
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync()
    }
  }, [fontsLoaded, fontError])

  // Sin tipografía cargada la app se vería con la familia del sistema: mejor
  // esperar detrás del splash que mostrar un salto de fuente.
  if (!fontsLoaded && !fontError) return null

  return (
    <AppThemeProvider>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <StatusBar style="light" />
              <AuthGate>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="onboarding" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="wallets" options={{ ...stackHeader, title: 'Billeteras' }} />
                  <Stack.Screen name="clients" options={{ ...stackHeader, title: 'Clientes' }} />
                  <Stack.Screen name="categories" options={{ ...stackHeader, title: 'Categorías' }} />
                  <Stack.Screen name="integrations" options={{ ...stackHeader, title: 'Integraciones' }} />
                  <Stack.Screen name="movement/[id]" options={{ ...stackHeader, title: 'Movimiento' }} />
                  <Stack.Screen name="receivables" options={{ ...stackHeader, title: 'Te deben' }} />
                </Stack>
              </AuthGate>
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </AppThemeProvider>
  )
}
