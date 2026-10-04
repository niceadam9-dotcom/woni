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
        // 소방넷(정평이앤씨) 동일 아이덴티티 — 주황 상단 바 + 하단 아이콘 툴바
        tabBarActiveTintColor: '#f97316',
        tabBarInactiveTintColor: '#c4c9d4',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#f0e9e2',
          borderTopWidth: 1,
        },
        headerStyle: { backgroundColor: '#f97316' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          headerShown: false,
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🏠</Text>,
        }}
      />
      <Tabs.Screen
        name="inspections/index"
        options={{ href: null, title: '점검 목록' }}
      />
      <Tabs.Screen
        name="inspections/[id]/index"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="inspections/[id]/sheets/index"
        options={{ href: null, title: '점검표' }}
      />
      <Tabs.Screen
        name="inspections/[id]/sheets/[sheetId]"
        options={{ href: null, title: '점검표 입력' }}
      />
      <Tabs.Screen
        name="notices"
        options={{ href: null, title: '공지사항' }}
      />
      <Tabs.Screen
        name="schedule"
        options={{ href: null, title: '점검 일정' }}
      />
      <Tabs.Screen
        name="defects"
        options={{ href: null, title: '불량 현황' }}
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
