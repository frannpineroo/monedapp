import { apiRequest } from '@/src/api/client'
import type { Movement } from '@/src/api/types'
import { useAuth } from '@/src/auth/AuthContext'
import { colors, fonts, radius } from '@/src/theme'
import Feather from '@expo/vector-icons/Feather'
import { useQuery } from '@tanstack/react-query'
import { Tabs } from 'expo-router/js-tabs'
import { StyleSheet, View } from 'react-native'

type FeatherName = React.ComponentProps<typeof Feather>['name']

function TabIcon({ name, color }: { name: FeatherName; color: string }) {
  return <Feather name={name} size={22} color={color} />
}

/** La acción principal del ledger: cargar un movimiento. Va marcada, no escondida. */
function NewMovementIcon({ focused }: { focused: boolean }) {
  return (
    <View style={[styles.newIcon, focused && styles.newIconFocused]}>
      <Feather name="plus" size={20} color={colors.onBrand} />
    </View>
  )
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
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: styles.label,
        tabBarBadgeStyle: styles.badge,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => <TabIcon name="home" color={String(color)} />,
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
          tabBarIcon: ({ focused }) => <NewMovementIcon focused={focused} />,
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
          tabBarIcon: ({ color }) => <TabIcon name="settings" color={String(color)} />,
        }}
      />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    elevation: 0,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 0.1,
  },
  // El contador de pendientes pide una acción: va en arcilla, no en pizarra.
  badge: {
    backgroundColor: colors.attention,
    color: colors.bg,
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
  newIcon: {
    width: 34,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.brandPressed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newIconFocused: { backgroundColor: colors.brand },
})
