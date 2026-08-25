import { AuthProvider, useAuth } from '@/src/auth/AuthContext'
import { fonts, radius, ThemeProvider as AppThemeProvider, type, useTheme } from '@/src/theme'
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from '@expo-google-fonts/archivo'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useRouter,
  useSegments,
  type Theme,
} from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

SplashScreen.preventAutoHideAsync()

function AuthGate({ children }: { children: React.ReactNode }) {
  const { colors: c } = useTheme()
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.brand} />
      </View>
    )
  }

  return <>{children}</>
}

function ThemedApp() {
  const { name, colors: c } = useTheme()

  const navTheme: Theme = {
    ...(name === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(name === 'dark' ? DarkTheme : DefaultTheme).colors,
      primary: c.brand,
      background: c.bg,
      card: c.bg,
      text: c.ink,
      border: c.border,
      notification: c.brand,
    },
  }

  /** Cabecera compartida por las pantallas apiladas fuera de las tabs. */
  const stackHeader = {
    headerShown: true,
    headerStyle: { backgroundColor: c.bg },
    headerShadowVisible: false,
    headerTintColor: c.ink,
    headerTitleStyle: { ...type.heading, color: c.ink },
    headerBackTitleStyle: { fontFamily: fonts.medium },
  } as const

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <AuthGate>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="wallets" options={{ ...stackHeader, title: 'Billeteras' }} />
          <Stack.Screen name="clients" options={{ ...stackHeader, title: 'Clientes' }} />
          <Stack.Screen name="categories" options={{ ...stackHeader, title: 'Categorías' }} />
          <Stack.Screen name="integrations" options={{ ...stackHeader, title: 'Integraciones' }} />
          <Stack.Screen name="movement/[id]" options={{ ...stackHeader, title: 'Movimiento' }} />
          <Stack.Screen name="receivables" options={{ ...stackHeader, title: 'Te deben' }} />
          <Stack.Screen
            name="new-movement"
            options={{
              presentation: 'formSheet',
              // Un solo detent al 94%: se ve que hay pantalla detrás. No usar
              // 'fitToContents': el form tiene teclado y flex: 1.
              sheetAllowedDetents: [0.94],
              sheetGrabberVisible: true,
              sheetCornerRadius: radius.xxl,
            }}
          />
        </Stack>
      </AuthGate>
    </ThemeProvider>
  )
}

function ThemeGate() {
  const { loading } = useTheme()
  // Sin preferencia leída todavía: mejor esperar detrás del splash que
  // mostrar un frame con el tema equivocado.
  if (loading) return null
  return <ThemedApp />
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
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemeGate />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </AppThemeProvider>
  )
}
