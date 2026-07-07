import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { fetchMyPlanItems } from '@/lib/api'
import type { PlanItem } from '@/lib/types'

const TYPE_COLORS: Record<string, string> = {
  '종합': '#7b68ee',
  '최초': '#3b82f6',
  '기타': '#6b7280',
}

const STATUS_LABELS: Record<string, string> = {
  planned: '예정',
  confirmed: '확정',
  completed: '완료',
  cancelled: '취소',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '날짜 미정'
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}(${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]})`
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  const today = new Date().toISOString().split('T')[0]
  return dateStr === today
}

function PlanCard({ item, onPress }: { item: PlanItem; onPress: () => void }) {
  const today = isToday(item.scheduled_date)
  return (
    <TouchableOpacity
      style={[styles.card, today && styles.cardToday]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.typeBadge, { backgroundColor: TYPE_COLORS[item.inspection_type] + '20' }]}>
          <Text style={[styles.typeText, { color: TYPE_COLORS[item.inspection_type] }]}>
            {item.inspection_type} {item.sequence_num}차
          </Text>
        </View>
        <View style={[styles.statusBadge, today && styles.statusBadgeToday]}>
          <Text style={[styles.statusText, today && styles.statusTextToday]}>
            {today ? '오늘' : STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>

      <Text style={styles.customerName}>{item.customer_name}</Text>
      <Text style={styles.customerCode}>{item.customer_code}</Text>

      <View style={styles.cardFooter}>
        <Text style={styles.dateText}>📅 {formatDate(item.scheduled_date)}</Text>
        {item.customer_address && (
          <Text style={styles.addressText} numberOfLines={1}>
            📍 {item.customer_address}
          </Text>
        )}
      </View>

      {item.inspection_id && (
        <View style={styles.startedBadge}>
          <Text style={styles.startedText}>점검 진행중</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

export default function InspectionsScreen() {
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

  const todayItems = items.filter(i => isToday(i.scheduled_date))
  const upcomingItems = items.filter(i => !isToday(i.scheduled_date))

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#7b68ee" />
      </View>
    )
  }

  return (
    <FlatList
      style={styles.container}
      data={[...todayItems, ...upcomingItems]}
      keyExtractor={item => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load() }}
          tintColor="#7b68ee"
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {todayItems.length > 0 && (
            <View style={styles.sectionLabel}>
              <Text style={styles.sectionLabelText}>오늘 점검 {todayItems.length}건</Text>
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>배정된 점검이 없습니다.</Text>
        </View>
      }
      renderItem={({ item, index }) => {
        const showUpcomingHeader = index === todayItems.length && upcomingItems.length > 0
        return (
          <View>
            {showUpcomingHeader && (
              <View style={styles.sectionLabel}>
                <Text style={styles.sectionLabelText}>예정 점검</Text>
              </View>
            )}
            <PlanCard
              item={item}
              onPress={() => router.push(`/(app)/inspections/${item.id}`)}
            />
          </View>
        )
      }}
      contentContainerStyle={styles.list}
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0eefc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 32 },
  header: { marginBottom: 4 },
  sectionLabel: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  sectionLabelText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#514b81',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#7b68ee',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardToday: {
    borderLeftWidth: 4,
    borderLeftColor: '#7b68ee',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeText: { fontSize: 12, fontWeight: '600' },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
  statusBadgeToday: { backgroundColor: '#f5f4ff' },
  statusText: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  statusTextToday: { color: '#7b68ee' },
  customerName: { fontSize: 17, fontWeight: '700', color: '#090c1d', marginBottom: 2 },
  customerCode: { fontSize: 12, color: '#b0acd6', marginBottom: 10 },
  cardFooter: { gap: 4 },
  dateText: { fontSize: 13, color: '#514b81' },
  addressText: { fontSize: 12, color: '#9ca3af' },
  startedBadge: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  startedText: { fontSize: 11, color: '#16a34a', fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#9ca3af' },
})
