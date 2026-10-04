import { useCallback, useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Platform, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { saveSheetResponses } from '@/lib/api'
import { queueCount, readConflicts, removeConflict, getLastSyncAt, type ConflictItem } from '@/lib/offline/queue'
import { flushQueue, onSyncChanged } from '@/lib/offline/sync'
import type { Profile } from '@/lib/types'

export default function ProfileScreen() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(0)
  const [conflicts, setConflicts] = useState<ConflictItem[]>([])
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)

  const loadSync = useCallback(async () => {
    setPending(await queueCount())
    setConflicts(await readConflicts())
    setLastSync(await getLastSyncAt())
  }, [])

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
    loadSync()
    return onSyncChanged(loadSync)
  }, [loadSync])

  async function handleSyncNow() {
    setSyncing(true)
    const res = await flushQueue()
    setSyncing(false)
    await loadSync()
    if (res.offline) Alert.alert('동기화', '네트워크에 연결되지 않았습니다.')
    else if (res.sent > 0 || res.conflicted > 0) {
      Alert.alert('동기화', `전송 ${res.sent}건 완료${res.conflicted > 0 ? ` · 충돌 ${res.conflicted}건 확인 필요` : ''}`)
    }
  }

  /** 충돌 해결 — 기본은 서버 값 유지(버림), 덮기는 force 재전송(서버 최신 우선+사용자 확인) */
  async function resolveConflict(c: ConflictItem, override: boolean) {
    if (override) {
      const res = await saveSheetResponses({
        inspectionId: c.inspectionId,
        month: c.month,
        rows: c.mine.result ? [{ item_code: c.item_code, result: c.mine.result, memo: c.mine.memo }] : [],
        clearCodes: c.mine.result ? [] : [c.item_code],
        force: true,
      })
      if (res.error) { Alert.alert('실패', res.error); return }
    }
    await removeConflict(c.id)
    await loadSync()
  }

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
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
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

      {/* 현장 동기화 (C1 Phase D) — 오프라인 큐 상태와 수동 flush */}
      <View style={styles.card}>
        <View style={styles.syncHeader}>
          <Text style={styles.syncTitle}>현장 동기화</Text>
          <TouchableOpacity
            style={[styles.syncBtn, syncing && styles.syncBtnOff]}
            disabled={syncing}
            onPress={handleSyncNow}
          >
            <Text style={styles.syncBtnText}>{syncing ? '동기화 중…' : '지금 동기화'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>전송 대기</Text>
          <Text style={[styles.rowValue, pending > 0 && styles.pendingValue]}>{pending}건</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>마지막 동기화</Text>
          <Text style={styles.rowValue}>
            {lastSync ? new Date(lastSync).toLocaleString('ko-KR') : '-'}
          </Text>
        </View>
      </View>

      {conflicts.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.conflictTitle}>⚠️ 확인 필요 {conflicts.length}건 — 다른 사용자가 먼저 수정</Text>
          {conflicts.map(c => (
            <View key={c.id} style={styles.conflictRow}>
              <Text style={styles.conflictCode}>{c.item_code}</Text>
              <Text style={styles.conflictDesc}>
                서버 {c.server.result} ← 내 입력 {c.mine.result ?? '／'}
              </Text>
              <View style={styles.conflictBtns}>
                <TouchableOpacity style={styles.keepBtn} onPress={() => resolveConflict(c, false)}>
                  <Text style={styles.keepBtnText}>서버 유지</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.overBtn} onPress={() => resolveConflict(c, true)}>
                  <Text style={styles.overBtnText}>내 값 덮기</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>로그아웃</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f6f7fa' },
  container: { padding: 24, alignItems: 'center', paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  syncHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  syncTitle: { fontSize: 14, fontWeight: '800', color: '#1e2a4a' },
  syncBtn: { backgroundColor: '#f97316', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  syncBtnOff: { backgroundColor: '#e5e7eb' },
  syncBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  pendingValue: { color: '#f97316', fontWeight: '800' },
  conflictTitle: { fontSize: 13, fontWeight: '800', color: '#dc2626', marginBottom: 8 },
  conflictRow: {
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6',
  },
  conflictCode: { fontSize: 12, fontWeight: '700', color: '#6b7280' },
  conflictDesc: { fontSize: 13, color: '#111827', marginVertical: 4 },
  conflictBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },
  keepBtn: {
    flex: 1, backgroundColor: '#f3f4f6', borderRadius: 8,
    paddingVertical: 9, alignItems: 'center',
  },
  keepBtnText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  overBtn: {
    flex: 1, backgroundColor: '#fef2f2', borderRadius: 8,
    paddingVertical: 9, alignItems: 'center',
  },
  overBtnText: { fontSize: 12, fontWeight: '700', color: '#dc2626' },
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
