import { AuthProvider, useAuth } from '@/src/auth/AuthContext'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack, useRouter, useSegments } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

SplashScreen.preventAutoHideAsync()

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

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync()
    }
  }, [loading])

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }

  return <>{children}</>
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  )
}
