import { useEffect } from 'react'
import { Tabs, useRouter } from 'expo-router'
import { Text } from 'react-native'
import { supabase } from '@/lib/supabase'
import { startSyncTriggers } from '@/lib/offline/sync'

export default function AppLayout() {
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace('/(auth)/login')
    })

    // ⚠ 명시적 SIGNED_OUT일 때만 내보낸다(C1 Phase D) — 오프라인에서 토큰 리프레시가
    // 실패했다고 입력 중인 화면을 닫으면 안 된다. 진짜 로그아웃만 이 이벤트를 낸다.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/(auth)/login')
    })

    const stopSync = startSyncTriggers()   // 오프라인 큐 — 시작·연결·복귀 시 flush
    return () => { subscription.unsubscribe(); stopSync() }
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
