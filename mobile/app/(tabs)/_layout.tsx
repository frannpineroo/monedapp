import { apiRequest } from '@/src/api/client'
import type { Movement } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors } from '@/src/theme'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { useQuery } from '@tanstack/react-query'
import { Tabs } from 'expo-router'

function TabIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name']
  color: string
}) {
  return <FontAwesome size={22} style={{ marginBottom: -2 }} {...props} />
}

export default function TabLayout() {
  const { accessToken } = useAuth()
  const pending = useQuery({
    queryKey: ['movements', { needsReview: true }],
    queryFn: () => apiRequest<Movement[]>('/movements?needsReview=true', { token: accessToken }),
    enabled: !!accessToken,
  })
  const pendingCount = pending.data?.length ?? 0

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => <TabIcon name="credit-card" color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="movements"
        options={{
          title: 'Movimientos',
          tabBarIcon: ({ color }) => <TabIcon name="list" color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="new-movement"
        options={{
          title: 'Nuevo',
          tabBarIcon: ({ color }) => <TabIcon name="plus-circle" color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Revisar',
          tabBarIcon: ({ color }) => <TabIcon name="inbox" color={String(color)} />,
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ajustes',
          tabBarIcon: ({ color }) => <TabIcon name="cog" color={String(color)} />,
        }}
      />
    </Tabs>
  )
}
