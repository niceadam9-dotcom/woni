import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { getCatalog, type SheetRow, type SheetCatalogItem } from '@/lib/sheet-catalog'
import { sheetScope, isItemInScope, type SheetScope } from '@/lib/sheet-scope'
import { sheetMatchesFacilities, sheetShownWhenInstalledOnly } from '@/lib/sheet-map'

/** 시트 선택 — 웹 「점검표 입력」 좌측 트리의 모바일판.
 *  범위(자체 v2025 / 외관 v2022)·설치 매칭·진행률 판정은 웹과 같은 규칙(sheet-scope·sheet-map). */

type SheetEntry = {
  sheet: SheetRow
  total: number        // 범위 내 항목 수
  responded: number    // 응답 수
  installed: boolean   // 설치 설비 매칭
}

export default function SheetPickScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [entries, setEntries] = useState<SheetEntry[]>([])
  const [scope, setScope] = useState<SheetScope | null>(null)
  const [installedOnly, setInstalledOnly] = useState(true)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (forceRefresh = false) => {
    try {
      const { data: plan } = await supabase
        .from('inspection_plan_items')
        .select('customer_id, inspection_id, customers!inner(inspection_type)')
        .eq('id', id).single()
      const inspectionId = (plan as { inspection_id?: string | null } | null)?.inspection_id
      if (!plan || !inspectionId) { setError('점검을 먼저 시작해주세요.'); setLoading(false); return }
      const customerId = (plan as { customer_id: string }).customer_id
      const inspectionType = ((plan as Record<string, unknown>).customers as { inspection_type: string | null } | null)?.inspection_type ?? null

      const [{ data: insp }, catalog, { data: blds }, { data: resp }] = await Promise.all([
        supabase.from('inspections').select('plan_type').eq('id', inspectionId).single(),
        getCatalog(forceRefresh),
        supabase.from('buildings').select('id').eq('customer_id', customerId).eq('is_active', true),
        supabase.from('inspection_sheet_responses').select('item_code').eq('inspection_id', inspectionId),
      ])

      const bldIds = ((blds ?? []) as Array<{ id: string }>).map(b => b.id)
      const { data: facs } = bldIds.length > 0
        ? await supabase.from('fire_facilities').select('facility_code').in('building_id', bldIds).eq('installed', true)
        : { data: [] }
      const facilityCodes = ((facs ?? []) as Array<{ facility_code: string }>).map(f => f.facility_code)

      const sc = sheetScope((insp as { plan_type?: string | null } | null)?.plan_type ?? null, inspectionType)
      setScope(sc)

      const respondedCodes = new Set(((resp ?? []) as Array<{ item_code: string }>).map(r => r.item_code))
      const sheets = catalog.sheets.filter(s => s.version === sc.version)
      const bySheet = new Map<string, SheetCatalogItem[]>()
      for (const it of catalog.items) {
        const list = bySheet.get(it.sheet_id) ?? []
        list.push(it)
        bySheet.set(it.sheet_id, list)
      }
      const out: SheetEntry[] = sheets.map(sheet => {
        const items = (bySheet.get(sheet.id) ?? []).filter(i => isItemInScope(i, sc))
        const responded = items.filter(i => respondedCodes.has(i.item_code)).length
        return {
          sheet,
          total: items.length,
          responded,
          installed: sheetMatchesFacilities(sheet.sheet_name, facilityCodes),
        }
      })
      // 설치·입력중 시트 먼저 — 현장에서 바로 눌러야 할 시트가 위로
      out.sort((a, b) =>
        Number(b.installed || b.responded > 0) - Number(a.installed || a.responded > 0)
        || a.sheet.sheet_code.localeCompare(b.sheet.sheet_code))
      setEntries(out)
      setError(null)
    } catch {
      setError('점검표 목록을 불러오지 못했습니다.')
    }
    setLoading(false)
    setRefreshing(false)
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#f97316" /></View>
  }
  if (error) {
    return <View style={styles.center}><Text style={styles.emptyText}>{error}</Text></View>
  }

  const visible = installedOnly
    ? entries.filter(e => sheetShownWhenInstalledOnly({
      sheetCode: e.sheet.sheet_code, installed: e.installed, responded: e.responded,
    }))
    : entries

  return (
    <FlatList
      style={styles.container}
      data={visible}
      keyExtractor={e => e.sheet.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true) }} tintColor="#f97316" />
      }
      ListHeaderComponent={
        <View style={styles.chipRow}>
          {scope && (
            <View style={styles.scopeChip}>
              <Text style={styles.scopeChipText}>
                {scope.isSpecial ? (scope.isOperational ? '작동점검' : '종합점검') : '외관점검'}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.chip, installedOnly && styles.chipOn]}
            onPress={() => setInstalledOnly(true)}
          >
            <Text style={[styles.chipText, installedOnly && styles.chipTextOn]}>설치 설비</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, !installedOnly && styles.chipOn]}
            onPress={() => setInstalledOnly(false)}
          >
            <Text style={[styles.chipText, !installedOnly && styles.chipTextOn]}>전체</Text>
          </TouchableOpacity>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>표시할 점검표가 없습니다.</Text>
        </View>
      }
      renderItem={({ item: e }) => {
        const done = e.total > 0 && e.responded >= e.total
        return (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => router.push(`/(app)/inspections/${id}/sheets/${e.sheet.id}`)}
          >
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{e.sheet.sheet_name}</Text>
              <Text style={styles.rowSub}>
                {e.responded}/{e.total}
                {e.installed ? ' · 설치 설비' : ''}
              </Text>
            </View>
            <View style={[styles.progressBadge, done ? styles.progressDone : e.responded > 0 ? styles.progressSome : null]}>
              <Text style={[styles.progressText, done ? styles.progressTextDone : e.responded > 0 ? styles.progressTextSome : null]}>
                {done ? '완료' : e.responded > 0 ? '입력중' : '미입력'}
              </Text>
            </View>
          </TouchableOpacity>
        )
      }}
      contentContainerStyle={styles.list}
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7fa' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  list: { padding: 16, paddingBottom: 32 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  scopeChip: {
    backgroundColor: '#1e2a4a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  scopeChipText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  chip: {
    borderWidth: 1,
    borderColor: '#fdba74',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  chipOn: { backgroundColor: '#f97316', borderColor: '#f97316' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#f97316' },
  chipTextOn: { color: '#fff' },
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
  rowBody: { flex: 1, paddingRight: 8 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 3 },
  rowSub: { fontSize: 12, color: '#6b7280' },
  progressBadge: { backgroundColor: '#f3f4f6', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6 },
  progressSome: { backgroundColor: '#fff7ed' },
  progressDone: { backgroundColor: '#f0fdf4' },
  progressText: { fontSize: 12, fontWeight: '700', color: '#9ca3af' },
  progressTextSome: { color: '#f97316' },
  progressTextDone: { color: '#16a34a' },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#9ca3af', textAlign: 'center' },
})
