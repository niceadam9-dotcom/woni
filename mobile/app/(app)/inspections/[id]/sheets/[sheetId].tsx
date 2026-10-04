import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View, Text, SectionList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, Platform, ScrollView,
} from 'react-native'
import { useLocalSearchParams, useNavigation } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { saveSheetResponses, type SheetSaveRow } from '@/lib/api'
import { getCatalog, type SheetCatalogItem } from '@/lib/sheet-catalog'
import { sheetScope, isItemInScope, sheetItemGroupRef } from '@/lib/sheet-scope'

/** 점검표 입력 — 웹 「점검표 입력」(sheet-entry)의 모바일판.
 *  O/X/／ 큰 터치 토글, 변경분만 저장, 저장은 /api/mobile/sheet-save(웹과 같은 코어).
 *  외관점검표(X% 항목)만 월 축을 쓴다 — 웹과 같은 규칙. */

type ItemState = {
  /** 'O' | 'X' = 값 / null = ／(해당없음, 행 없음) */
  result: 'O' | 'X' | null
  memo: string
  /** 서버에서 마지막으로 본 updated_at — 충돌 판정 기준점. 신규 입력은 null */
  baseUpdatedAt: string | null
  /** 서버에 행이 있었는가 — ／로 되돌릴 때 clearCodes로 보낼지 판정 */
  hadRow: boolean
}

function showAlert(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${message}`)
  else Alert.alert(title, message)
}

export default function SheetEntryScreen() {
  const { id, sheetId } = useLocalSearchParams<{ id: string; sheetId: string }>()
  const navigation = useNavigation()

  const [inspectionId, setInspectionId] = useState<string | null>(null)
  const [items, setItems] = useState<SheetCatalogItem[]>([])
  const [sheetName, setSheetName] = useState('')
  const [isExterior, setIsExterior] = useState(false)
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [state, setState] = useState<Record<string, ItemState>>({})
  const [original, setOriginal] = useState<Record<string, ItemState>>({})
  const [memoOpen, setMemoOpen] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (m: number) => {
    setLoading(true)
    const { data: plan } = await supabase
      .from('inspection_plan_items')
      .select('inspection_id, customers!inner(inspection_type)')
      .eq('id', id).single()
    const inspId = (plan as { inspection_id?: string | null } | null)?.inspection_id
    if (!plan || !inspId) { setLoading(false); return }
    setInspectionId(inspId)
    const inspectionType = ((plan as Record<string, unknown>).customers as { inspection_type: string | null } | null)?.inspection_type ?? null

    const [{ data: insp }, catalog] = await Promise.all([
      supabase.from('inspections').select('plan_type').eq('id', inspId).single(),
      getCatalog(),
    ])
    const scope = sheetScope((insp as { plan_type?: string | null } | null)?.plan_type ?? null, inspectionType)

    const sheet = catalog.sheets.find(s => s.id === sheetId)
    const sheetItems = catalog.items
      .filter(i => i.sheet_id === sheetId)
      .filter(i => isItemInScope(i, scope))
    setSheetName(sheet?.sheet_name ?? '')
    setItems(sheetItems)
    const ext = sheetItems.length > 0 && sheetItems[0].item_code.startsWith('X')
    setIsExterior(ext)

    const codes = sheetItems.map(i => i.item_code)
    const { data: resp } = codes.length > 0
      ? await supabase.from('inspection_sheet_responses')
        .select('item_code, month, result, memo, updated_at')
        .eq('inspection_id', inspId).in('item_code', codes)
      : { data: [] }

    const next: Record<string, ItemState> = {}
    for (const i of sheetItems) next[i.item_code] = { result: null, memo: '', baseUpdatedAt: null, hadRow: false }
    for (const r of (resp ?? []) as Array<{ item_code: string; month: number; result: string; memo: string | null; updated_at: string }>) {
      // 외관은 선택한 달의 행만, 일반은 month=0 행만 — 저장과 같은 축
      const wantMonth = r.item_code.startsWith('X') ? m : 0
      if (r.month !== wantMonth) continue
      next[r.item_code] = {
        result: r.result === 'O' || r.result === 'X' ? r.result : null,   // 'N'(해당없음)은 ／로 표시
        memo: r.memo ?? '',
        baseUpdatedAt: r.updated_at,
        hadRow: true,
      }
    }
    setState(next)
    setOriginal(JSON.parse(JSON.stringify(next)) as Record<string, ItemState>)
    setMemoOpen({})
    setLoading(false)
  }, [id, sheetId])

  useEffect(() => { load(month) }, [load, month])

  useEffect(() => {
    if (sheetName) navigation.setOptions({ title: sheetName })
  }, [navigation, sheetName])

  const sections = useMemo(() => {
    const byGroup = new Map<string, { title: string; data: SheetCatalogItem[] }>()
    for (const it of items) {
      const ref = sheetItemGroupRef(it)
      const title = ref.name === ref.code ? ref.code : `${ref.code}. ${ref.name}`
      const g = byGroup.get(ref.code) ?? { title, data: [] }
      g.data.push(it)
      byGroup.set(ref.code, g)
    }
    return [...byGroup.values()]
  }, [items])

  const dirtyCodes = useMemo(() => {
    const out: string[] = []
    for (const [code, s] of Object.entries(state)) {
      const o = original[code]
      if (!o) continue
      if (s.result !== o.result || s.memo.trim() !== o.memo.trim()) out.push(code)
    }
    return out
  }, [state, original])

  const setResult = (code: string, value: 'O' | 'X' | null) => {
    setState(prev => ({ ...prev, [code]: { ...prev[code], result: value } }))
    if (value === 'X') setMemoOpen(prev => ({ ...prev, [code]: true }))
  }

  const doSave = async (force: boolean) => {
    if (!inspectionId || dirtyCodes.length === 0) return
    setSaving(true)
    const rows: SheetSaveRow[] = []
    const clearCodes: string[] = []
    for (const code of dirtyCodes) {
      const s = state[code]
      if (s.result === null) {
        if (s.hadRow) clearCodes.push(code)   // 서버 행이 있었을 때만 지울 것이 있다
      } else {
        rows.push({ item_code: code, result: s.result, memo: s.memo.trim() || null, base_updated_at: s.baseUpdatedAt })
      }
    }
    const res = await saveSheetResponses({ inspectionId, rows, month: isExterior ? month : 0, clearCodes, force })
    setSaving(false)

    if (res.error) {
      showAlert('저장 실패', res.offline
        ? '네트워크에 연결되지 않았습니다. 연결 후 다시 저장해주세요.'   // Phase D에서 오프라인 큐로 대체
        : res.error)
      return
    }
    if (res.conflicts && res.conflicts.length > 0) {
      // 충돌 — 서버 최신 우선 + 사용자 확인(통합 계획 C1). 기본 선택 = 서버 값 유지.
      const detail = res.conflicts.slice(0, 5).map(c => `· ${c.item_code}: 서버 ${c.server.result}`).join('\n')
      if (Platform.OS === 'web') {
        const over = window.confirm(`다른 사용자가 먼저 수정한 항목 ${res.conflicts.length}건이 있습니다.\n${detail}\n\n[확인] 내 값으로 덮기 / [취소] 서버 값 유지`)
        if (over) { await doSave(true); return }
        await load(month)
      } else {
        Alert.alert(
          '다른 사용자가 먼저 수정했습니다',
          `${res.conflicts.length}건은 저장하지 않았습니다.\n${detail}`,
          [
            { text: '서버 값 유지', style: 'cancel', onPress: () => { load(month) } },
            { text: '내 값으로 덮기', style: 'destructive', onPress: () => { doSave(true) } },
          ],
        )
      }
      return
    }
    await load(month)   // base_updated_at 갱신 — 다음 저장의 충돌 기준점
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#f97316" /></View>
  }
  if (!inspectionId) {
    return <View style={styles.center}><Text style={styles.emptyText}>점검을 먼저 시작해주세요.</Text></View>
  }

  return (
    <View style={styles.container}>
      {isExterior && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthBar} contentContainerStyle={styles.monthBarContent}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.monthChip, month === m && styles.monthChipOn]}
              onPress={() => setMonth(m)}
            >
              <Text style={[styles.monthChipText, month === m && styles.monthChipTextOn]}>{m}월</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <SectionList
        style={styles.listWrap}
        sections={sections}
        keyExtractor={it => it.item_code}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <View style={styles.groupHeader}>
            <Text style={styles.groupHeaderText}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item: it }) => {
          const s = state[it.item_code]
          if (!s) return null
          const showMemo = memoOpen[it.item_code] || s.memo.length > 0
          return (
            <View style={styles.itemRow}>
              <View style={styles.itemHead}>
                <Text style={styles.itemCode}>{it.item_code}</Text>
                {it.subgroup_name ? <Text style={styles.itemSub}>{it.subgroup_name}</Text> : null}
              </View>
              <Text style={styles.itemName}>{it.item_name}</Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggle, s.result === 'O' && styles.toggleO]}
                  onPress={() => setResult(it.item_code, s.result === 'O' ? null : 'O')}
                >
                  <Text style={[styles.toggleText, s.result === 'O' && styles.toggleTextOn]}>○ 정상</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggle, s.result === 'X' && styles.toggleX]}
                  onPress={() => setResult(it.item_code, s.result === 'X' ? null : 'X')}
                >
                  <Text style={[styles.toggleText, s.result === 'X' && styles.toggleTextOn]}>✕ 불량</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggle, s.result === null && styles.toggleNa]}
                  onPress={() => setResult(it.item_code, null)}
                >
                  <Text style={[styles.toggleText, s.result === null && styles.toggleTextNaOn]}>／ 해당없음</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.memoBtn} onPress={() => setMemoOpen(p => ({ ...p, [it.item_code]: !showMemo }))}>
                  <Text style={styles.memoBtnText}>{s.memo ? '📝' : '✏️'}</Text>
                </TouchableOpacity>
              </View>
              {showMemo && (
                <TextInput
                  style={styles.memoInput}
                  placeholder="메모 (불량 위치·상태 등)"
                  placeholderTextColor="#b0b6c3"
                  value={s.memo}
                  multiline
                  onChangeText={t => setState(prev => ({ ...prev, [it.item_code]: { ...prev[it.item_code], memo: t } }))}
                />
              )}
            </View>
          )
        }}
        contentContainerStyle={styles.list}
      />

      <View style={styles.footer}>
        <Text style={styles.footerInfo}>
          {dirtyCodes.length > 0 ? `변경 ${dirtyCodes.length}건` : '변경 없음'}
        </Text>
        <TouchableOpacity
          style={[styles.saveBtn, (dirtyCodes.length === 0 || saving) && styles.saveBtnOff]}
          disabled={dirtyCodes.length === 0 || saving}
          onPress={() => doSave(false)}
        >
          <Text style={styles.saveBtnText}>{saving ? '저장 중…' : '저장'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7fa' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  listWrap: { flex: 1 },
  list: { padding: 12, paddingBottom: 90 },
  monthBar: { flexGrow: 0, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eef0f4' },
  monthBarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  monthChip: {
    borderWidth: 1, borderColor: '#fdba74', backgroundColor: '#fff',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
  },
  monthChipOn: { backgroundColor: '#f97316', borderColor: '#f97316' },
  monthChipText: { fontSize: 13, fontWeight: '600', color: '#f97316' },
  monthChipTextOn: { color: '#fff' },
  groupHeader: {
    backgroundColor: '#f6f7fa',
    paddingVertical: 8, paddingHorizontal: 4,
  },
  groupHeaderText: { fontSize: 13, fontWeight: '800', color: '#1e2a4a' },
  itemRow: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1, borderColor: '#e8eaf0',
    padding: 12, marginBottom: 8,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  itemCode: { fontSize: 11, color: '#9ca3af', fontWeight: '600' },
  itemSub: { fontSize: 11, color: '#6b7280' },
  itemName: { fontSize: 14, color: '#111827', lineHeight: 20, marginBottom: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggle: {
    flex: 1,
    borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fafafa',
    paddingVertical: 11, borderRadius: 9, alignItems: 'center',
  },
  toggleO: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  toggleX: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  toggleNa: { backgroundColor: '#6b7280', borderColor: '#6b7280' },
  toggleText: { fontSize: 13, fontWeight: '700', color: '#6b7280' },
  toggleTextOn: { color: '#fff' },
  toggleTextNaOn: { color: '#fff' },
  memoBtn: { paddingHorizontal: 8, paddingVertical: 10 },
  memoBtnText: { fontSize: 16 },
  memoInput: {
    marginTop: 8,
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8,
    padding: 10, fontSize: 13, color: '#111827', minHeight: 44,
    backgroundColor: '#fafafa',
  },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eef0f4',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  footerInfo: { fontSize: 13, fontWeight: '600', color: '#514b81' },
  saveBtn: {
    backgroundColor: '#f97316', borderRadius: 10,
    paddingHorizontal: 28, paddingVertical: 12,
  },
  saveBtnOff: { backgroundColor: '#e5e7eb' },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  emptyText: { fontSize: 15, color: '#9ca3af', textAlign: 'center' },
})
