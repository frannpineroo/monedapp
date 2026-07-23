import { colors } from '@/src/theme'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { Tabs } from 'expo-router'

function TabIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name']
  color: string
}) {
  return <FontAwesome size={22} style={{ marginBottom: -2 }} {...props} />
}

export default function TabLayout() {
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
    </Tabs>
  )
}
