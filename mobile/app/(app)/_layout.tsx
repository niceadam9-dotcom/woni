import { useEffect } from 'react'
import { Tabs, useRouter } from 'expo-router'
import { Text } from 'react-native'
import { supabase } from '@/lib/supabase'

export default function AppLayout() {
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace('/(auth)/login')
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/(auth)/login')
    })

    return () => subscription.unsubscribe()
  }, [router])

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#7b68ee',
        tabBarInactiveTintColor: '#b0acd6',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#e8e6f8',
          borderTopWidth: 1,
        },
        headerStyle: { backgroundColor: '#7b68ee' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '점검 목록',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📋</Text>,
        }}
      />
      <Tabs.Screen
        name="inspections/[id]"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="docs"
        options={{
          title: '서류',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📄</Text>,
          headerShown: false,
        }}
      />
      <Tabs.Screen name="docs/fire-plans"        options={{ href: null }} />
      <Tabs.Screen name="docs/work-records"      options={{ href: null }} />
      <Tabs.Screen name="docs/self-inspection"   options={{ href: null }} />
      <Tabs.Screen name="docs/training-records"  options={{ href: null }} />
      <Tabs.Screen name="docs/fire-records"      options={{ href: null }} />
      <Tabs.Screen
        name="profile"
        options={{
          title: '내 정보',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👤</Text>,
        }}
      />
    </Tabs>
  )
}
