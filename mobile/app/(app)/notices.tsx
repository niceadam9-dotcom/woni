import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native'
import { fetchNotices, formatNoticeDate, type NoticePost } from '@/lib/notices'

export default function NoticesScreen() {
  const [posts, setPosts] = useState<NoticePost[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await fetchNotices()
    setPosts(data)
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { load() }, [load])

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
      data={posts}
      keyExtractor={post => post.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor="#7b68ee" />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📢</Text>
          <Text style={styles.emptyText}>등록된 공지가 없습니다.</Text>
        </View>
      }
      renderItem={({ item }) => {
        const expanded = expandedId === item.id
        return (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => setExpandedId(expanded ? null : item.id)}
          >
            <View style={styles.cardHeader}>
              {item.is_notice && (
                <View style={styles.noticeBadge}>
                  <Text style={styles.noticeBadgeText}>공지</Text>
                </View>
              )}
              <Text style={styles.title} numberOfLines={expanded ? undefined : 1}>
                {item.title}
              </Text>
            </View>
            <Text style={styles.date}>{formatNoticeDate(item.created_at)}</Text>
            {expanded && item.content.length > 0 && (
              <Text style={styles.body}>{item.content}</Text>
            )}
          </TouchableOpacity>
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8eaf0',
    padding: 16,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeBadge: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fdba74',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  noticeBadgeText: { fontSize: 11, fontWeight: '700', color: '#f97316' },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: '#111827' },
  date: { fontSize: 12, color: '#9ca3af', marginTop: 6 },
  body: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f8',
    fontSize: 14,
    lineHeight: 21,
    color: '#374151',
  },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#9ca3af' },
})
