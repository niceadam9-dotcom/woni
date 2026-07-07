import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/types'

export default function ProfileScreen() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('id, employee_id, name, email, role, position')
        .eq('id', user.id)
        .single()
      if (data) setProfile(data as unknown as Profile)
      setLoading(false)
    }
    load()
  }, [])

  async function handleLogout() {
    if (Platform.OS === 'web') {
      if (!window.confirm('로그아웃 하시겠습니까?')) return
      await supabase.auth.signOut()
      router.replace('/(auth)/login')
      return
    }
    Alert.alert('로그아웃', '로그아웃 하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut()
          router.replace('/(auth)/login')
        },
      },
    ])
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#7b68ee" /></View>
  }

  return (
    <View style={styles.container}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{profile?.name?.[0] ?? '?'}</Text>
      </View>
      <Text style={styles.name}>{profile?.name}</Text>
      <Text style={styles.email}>{profile?.email}</Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>사원번호</Text>
          <Text style={styles.rowValue}>{profile?.employee_id}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>직책</Text>
          <Text style={styles.rowValue}>{profile?.position ?? '-'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>권한</Text>
          <Text style={styles.rowValue}>{profile?.role}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>로그아웃</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0eefc', padding: 24, alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#7b68ee', justifyContent: 'center', alignItems: 'center',
    marginTop: 32, marginBottom: 12,
  },
  avatarText: { fontSize: 32, color: '#fff', fontWeight: '700' },
  name: { fontSize: 20, fontWeight: '700', color: '#090c1d', marginBottom: 4 },
  email: { fontSize: 14, color: '#9ca3af', marginBottom: 24 },
  card: {
    width: '100%', backgroundColor: '#fff', borderRadius: 14,
    padding: 16, marginBottom: 24,
  },
  row: {
    flexDirection: 'row', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  rowLabel: { width: 80, fontSize: 13, color: '#9ca3af' },
  rowValue: { flex: 1, fontSize: 13, color: '#090c1d', fontWeight: '500' },
  logoutBtn: {
    width: '100%', height: 50, borderRadius: 12,
    backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center',
  },
  logoutText: { fontSize: 16, color: '#dc2626', fontWeight: '600' },
})
