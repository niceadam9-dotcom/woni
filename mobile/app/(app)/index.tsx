import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { fetchMyPlanItems } from '@/lib/api'
import { fetchNotices, formatNoticeDate, type NoticePost } from '@/lib/notices'
import type { PlanItem } from '@/lib/types'

// 홈 레이아웃은 소방넷(sobangnet.com) 모바일 화면과 동일 구성:
// 주황 헤더 카드 → 2×2 메뉴 카드 → 공지사항 목록.
// 메뉴 4칸은 승진소방 웹 ERP에 실재하는 기능만 연결한다(2026-10-04 사용자 지시 — 소방법 앱류 제외).
const MENU_ITEMS = [
  {
    key: 'inspection',
    title: '소방점검',
    desc: '배정된 점검과 점검표를\n현장에서 입력합니다.',
    icon: '🧯',
    href: '/(app)/inspections' as const,
  },
  {
    key: 'schedule',
    title: '점검 일정',
    desc: '오늘과 예정된 점검 일정을\n확인합니다.',
    icon: '📅',
    href: '/(app)/schedule' as const,
  },
  {
    key: 'defects',
    title: '불량 현황',
    desc: '등록한 불량과 조치 상태를\n확인합니다.',
    icon: '⚠️',
    href: '/(app)/defects' as const,
  },
  {
    key: 'docs',
    title: '현장 서류',
    desc: '소방계획서 등 현장 서류\n5종을 작성합니다.',
    icon: '📄',
    href: '/(app)/docs' as const,
  },
] as const

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  return dateStr === new Date().toISOString().split('T')[0]
}

export default function HomeScreen() {
  const router = useRouter()
  const [planItems, setPlanItems] = useState<PlanItem[]>([])
  const [notices, setNotices] = useState<NoticePost[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const [plans, posts] = await Promise.all([fetchMyPlanItems(), fetchNotices(5)])
    setPlanItems(plans)
    setNotices(posts)
    setRefreshing(false)
  }, [])

  useEffect(() => { load() }, [load])

  const todayCount = planItems.filter(i => isToday(i.scheduled_date)).length
  const upcomingCount = planItems.length - todayCount

  const onMenuPress = (item: (typeof MENU_ITEMS)[number]) => {
    router.push(item.href)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>승진소방</Text>
        <TouchableOpacity onPress={() => router.push('/(app)/profile')}>
          <Text style={styles.topBarIcon}>👤</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor="#f97316" />
        }
      >
        {/* 주황 헤더 카드 */}
        <TouchableOpacity
          style={styles.hero}
          activeOpacity={0.85}
          onPress={() => router.push('/(app)/inspections')}
        >
          <View style={styles.heroTextArea}>
            <Text style={styles.heroTitle}>소방안전관리</Text>
            <Text style={styles.heroDesc}>승진소방 현장 업무를{'\n'}한 곳에서 처리합니다.</Text>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>
                오늘 점검 {todayCount}건 · 예정 {upcomingCount}건
              </Text>
            </View>
          </View>
          <View style={styles.heroIconWrap}>
            <Text style={styles.heroIcon}>🚒</Text>
          </View>
        </TouchableOpacity>

        {/* 2×2 메뉴 카드 */}
        <View style={styles.grid}>
          {MENU_ITEMS.map(item => (
            <TouchableOpacity
              key={item.key}
              style={styles.menuCard}
              activeOpacity={0.7}
              onPress={() => onMenuPress(item)}
            >
              <Text style={styles.menuTitle}>{item.title}</Text>
              <Text style={styles.menuDesc}>{item.desc}</Text>
              <View style={styles.menuFooter}>
                <Text style={styles.menuIcon}>{item.icon}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* 공지사항 */}
        <View style={styles.noticeSection}>
          <View style={styles.noticeHeader}>
            <Text style={styles.noticeHeading}>📢 공지사항</Text>
            <TouchableOpacity onPress={() => router.push('/(app)/notices')}>
              <Text style={styles.noticeMore}>더보기 ›</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.noticeTable}>
            <View style={styles.noticeTableHead}>
              <Text style={[styles.noticeHeadCell, styles.noticeTitleCol]}>제목</Text>
              <Text style={[styles.noticeHeadCell, styles.noticeDateCol]}>작성일</Text>
            </View>
            {notices.length === 0 ? (
              <View style={styles.noticeEmpty}>
                <Text style={styles.noticeEmptyText}>등록된 공지가 없습니다.</Text>
              </View>
            ) : (
              notices.map(post => (
                <TouchableOpacity
                  key={post.id}
                  style={styles.noticeRow}
                  activeOpacity={0.6}
                  onPress={() => router.push('/(app)/notices')}
                >
                  <Text style={[styles.noticeCell, styles.noticeTitleCol]} numberOfLines={1}>
                    {post.title}
                  </Text>
                  <Text style={[styles.noticeDateText, styles.noticeDateCol]}>
                    {formatNoticeDate(post.created_at)}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const ORANGE = '#f97316'
const NAVY = '#1e2a4a'

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ORANGE },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: ORANGE,
  },
  brand: { fontSize: 18, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  topBarIcon: { fontSize: 20 },
  container: { flex: 1, backgroundColor: '#f6f7fa' },
  content: { padding: 16, paddingBottom: 40 },

  hero: {
    flexDirection: 'row',
    backgroundColor: ORANGE,
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  heroTextArea: { flex: 1 },
  heroTitle: { fontSize: 21, fontWeight: '800', color: '#fff', marginBottom: 6 },
  heroDesc: { fontSize: 13, color: '#ffedd5', lineHeight: 19, marginBottom: 12 },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  heroBadgeText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginLeft: 12,
  },
  heroIcon: { fontSize: 32 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 18,
  },
  menuCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eaf0',
    padding: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  menuTitle: { fontSize: 16, fontWeight: '800', color: NAVY, marginBottom: 6 },
  menuDesc: { fontSize: 12, color: '#6b7280', lineHeight: 17, marginBottom: 12 },
  menuFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  soonBadge: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  soonBadgeText: { fontSize: 10, fontWeight: '700', color: '#9ca3af' },
  menuIcon: { fontSize: 22, marginLeft: 'auto' },

  noticeSection: { marginBottom: 8 },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  noticeHeading: { fontSize: 15, fontWeight: '800', color: NAVY },
  noticeMore: { fontSize: 13, color: '#6b7280', fontWeight: '600' },
  noticeTable: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8eaf0',
    overflow: 'hidden',
  },
  noticeTableHead: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fc',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eef0f4',
  },
  noticeHeadCell: { fontSize: 12, fontWeight: '700', color: '#6b7280' },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f8',
  },
  noticeCell: { fontSize: 13, color: '#111827' },
  noticeDateText: { fontSize: 12, color: '#9ca3af' },
  noticeTitleCol: { flex: 1, paddingRight: 10 },
  noticeDateCol: { width: 82, textAlign: 'right' },
  noticeEmpty: { paddingVertical: 24, alignItems: 'center' },
  noticeEmptyText: { fontSize: 13, color: '#9ca3af' },
})
