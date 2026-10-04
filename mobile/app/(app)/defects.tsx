import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native'
import { supabase } from '@/lib/supabase'
import type { DefectSeverity } from '@/lib/types'

// 불량 현황 — 내가 담당한 점검 건들의 불량·조치 상태(웹 불량 관리와 같은 데이터).
interface DefectRow {
  id: string
  inspection_id: string
  defect_name: string
  defect_detail: string | null
  severity: DefectSeverity
  photo_url: string | null
  action_completed_at: string | null
  created_at: string
  customer_name: string
}

const SEVERITY_COLORS: Record<DefectSeverity, { bg: string; fg: string }> = {
  '경미': { bg: '#f0fdf4', fg: '#16a34a' },
  '보통': { bg: '#fff7ed', fg: '#f97316' },
  '중대': { bg: '#fef2f2', fg: '#dc2626' },
}

async function fetchMyDefects(): Promise<DefectRow[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('inspection_defects')
    .select(`
      id, inspection_id, defect_name, defect_detail, severity, photo_url,
      action_completed_at, created_at,
      inspections!inner(assigned_employee_id, customers(customer_name))
    `)
    .eq('inspections.assigned_employee_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(row => {
    const insp = row.inspections as { customers: { customer_name: string } | null } | null
    return {
      id: row.id as string,
      inspection_id: row.inspection_id as string,
      defect_name: row.defect_name as string,
      defect_detail: row.defect_detail as string | null,
      severity: (row.severity as DefectSeverity) ?? '보통',
      photo_url: row.photo_url as string | null,
      action_completed_at: row.action_completed_at as string | null,
      created_at: row.created_at as string,
      customer_name: insp?.customers?.customer_name ?? '',
    }
  })
}

export default function DefectsScreen() {
  const [defects, setDefects] = useState<DefectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const data = await fetchMyDefects()
    setDefects(data)
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    )
  }

  const openCount = defects.filter(d => !d.action_completed_at).length

  return (
    <FlatList
      style={styles.container}
      data={defects}
      keyExtractor={item => item.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor="#f97316" />
      }
      ListHeaderComponent={
        defects.length > 0 ? (
          <View style={styles.summary}>
            <Text style={styles.summaryText}>
              전체 {defects.length}건 · 조치 대기 {openCount}건
            </Text>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>⚠️</Text>
          <Text style={styles.emptyText}>등록된 불량이 없습니다.</Text>
        </View>
      }
      renderItem={({ item }) => {
        const sev = SEVERITY_COLORS[item.severity] ?? SEVERITY_COLORS['보통']
        const done = !!item.action_completed_at
        return (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.sevBadge, { backgroundColor: sev.bg }]}>
                <Text style={[styles.sevText, { color: sev.fg }]}>{item.severity}</Text>
              </View>
              <View style={[styles.stateBadge, done ? styles.stateDone : styles.stateOpen]}>
                <Text style={[styles.stateText, done ? styles.stateTextDone : styles.stateTextOpen]}>
                  {done ? '조치 완료' : '조치 대기'}
                </Text>
              </View>
            </View>
            <Text style={styles.name}>{item.defect_name}</Text>
            {item.defect_detail ? (
              <Text style={styles.detail} numberOfLines={2}>{item.defect_detail}</Text>
            ) : null}
            <View style={styles.cardFooter}>
              <Text style={styles.customer}>{item.customer_name}</Text>
              <Text style={styles.meta}>
                {item.photo_url ? '📷 ' : ''}{item.created_at.slice(0, 10)}
              </Text>
            </View>
          </View>
        )
      }}
      contentContainerStyle={styles.list}
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7fa' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 32 },
  summary: { paddingVertical: 6, paddingHorizontal: 2, marginBottom: 6 },
  summaryText: { fontSize: 13, fontWeight: '700', color: '#514b81' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8eaf0',
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  sevBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  sevText: { fontSize: 12, fontWeight: '700' },
  stateBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  stateOpen: { backgroundColor: '#fef2f2' },
  stateDone: { backgroundColor: '#f0fdf4' },
  stateText: { fontSize: 12, fontWeight: '700' },
  stateTextOpen: { color: '#dc2626' },
  stateTextDone: { color: '#16a34a' },
  name: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 4 },
  detail: { fontSize: 13, color: '#6b7280', lineHeight: 18, marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  customer: { fontSize: 12, fontWeight: '600', color: '#514b81' },
  meta: { fontSize: 12, color: '#9ca3af' },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#9ca3af' },
})
