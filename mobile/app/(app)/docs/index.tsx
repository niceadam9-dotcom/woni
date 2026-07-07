import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'

const DOC_TYPES = [
  { type: 'fire_plan',        label: '소방계획서',           icon: '🔥', route: '/docs/fire-plans' },
  { type: 'work_record',      label: '업무수행기록표',        icon: '📝', route: '/docs/work-records' },
  { type: 'self_inspection',  label: '자체점검기록부',        icon: '✅', route: '/docs/self-inspection' },
  { type: 'training_record',  label: '자위소방대·교육훈련',   icon: '🚒', route: '/docs/training-records' },
  { type: 'fire_incident',    label: '화재/비화재보 기록부',  icon: '🚨', route: '/docs/fire-records' },
] as const

type DocSummary = { doc_type: string; count: number; last_date: string | null }

export default function DocsIndexScreen() {
  const router = useRouter()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data } = await supabase
        .from('mobile_documents')
        .select('doc_type')
        .eq('employee_id', user.id)

      if (data) {
        const c: Record<string, number> = {}
        for (const row of data) {
          c[row.doc_type] = (c[row.doc_type] ?? 0) + 1
        }
        setCounts(c)
      }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#7b68ee" /></View>
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>현장 서류</Text>
      <Text style={styles.subHeader}>현장에서 작성하는 소방 관련 서류</Text>

      <FlatList
        data={DOC_TYPES}
        keyExtractor={item => item.type}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(item.route as Parameters<typeof router.push>[0])}
          >
            <Text style={styles.icon}>{item.icon}</Text>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{item.label}</Text>
              <Text style={styles.cardCount}>
                {counts[item.type] ?? 0}건 작성됨
              </Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0eefc' },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:    { fontSize: 22, fontWeight: '700', color: '#090c1d', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 4 },
  subHeader: { fontSize: 13, color: '#9ca3af', paddingHorizontal: 20, paddingBottom: 16 },
  list:      { padding: 16, gap: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 14,
    shadowColor: '#7b68ee',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  icon:      { fontSize: 28 },
  cardBody:  { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#090c1d' },
  cardCount: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  arrow:     { fontSize: 20, color: '#b0acd6' },
})
