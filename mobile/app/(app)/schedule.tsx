import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, SectionList, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { fetchMyPlanItems } from '@/lib/api'
import type { PlanItem } from '@/lib/types'

// 점검 일정 — 웹 점검 달력과 같은 데이터(inspection_plan_items)를 날짜별로 묶어 보여준다.
function dayLabel(dateStr: string | null): string {
  if (!dateStr) return '날짜 미정'
  const d = new Date(dateStr)
  const label = `${d.getMonth() + 1}월 ${d.getDate()}일 (${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]})`
  const today = new Date().toISOString().split('T')[0]
  return dateStr === today ? `오늘 — ${label}` : label
}

export default function ScheduleScreen() {
  const router = useRouter()
  const [items, setItems] = useState<PlanItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const data = await fetchMyPlanItems()
    setItems(data)
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

  const byDate = new Map<string, PlanItem[]>()
  for (const item of items) {
    const key = item.scheduled_date ?? ''
    const list = byDate.get(key) ?? []
    list.push(item)
    byDate.set(key, list)
  }
  const sections = [...byDate.entries()]
    .sort(([a], [b]) => (a || '9999').localeCompare(b || '9999'))
    .map(([date, data]) => ({ title: dayLabel(date || null), data }))

  return (
    <SectionList
      style={styles.container}
      sections={sections}
      keyExtractor={item => item.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor="#f97316" />
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.dateHeader}>
          <Text style={styles.dateHeaderText}>{section.title}</Text>
        </View>
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📅</Text>
          <Text style={styles.emptyText}>예정된 점검 일정이 없습니다.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.7}
          onPress={() => router.push(`/(app)/inspections/${item.id}`)}
        >
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>{item.customer_name}</Text>
            <Text style={styles.rowSub}>
              {item.inspection_type} {item.sequence_num}차
              {item.customer_address ? ` · ${item.customer_address}` : ''}
            </Text>
          </View>
          {item.inspection_id && (
            <View style={styles.startedBadge}>
              <Text style={styles.startedText}>진행중</Text>
            </View>
          )}
        </TouchableOpacity>
      )}
      contentContainerStyle={styles.list}
      stickySectionHeadersEnabled={false}
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7fa' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 32 },
  dateHeader: { paddingVertical: 8, paddingHorizontal: 2, marginTop: 6 },
  dateHeaderText: { fontSize: 13, fontWeight: '800', color: '#f97316' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8eaf0',
    padding: 14,
    marginBottom: 8,
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 3 },
  rowSub: { fontSize: 12, color: '#6b7280' },
  startedBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 8,
  },
  startedText: { fontSize: 11, color: '#16a34a', fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#9ca3af' },
})
