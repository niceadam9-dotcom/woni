'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, Loader2, AlertTriangle, Zap, Search } from 'lucide-react'
import {
  loadSheetSnapshotAction, saveSheetResponsesAction, createDefectsFromXAction,
  bulkAllGoodAction, bulkSheetNAAction, searchQuickItemsAction,
} from '@/app/(dashboard)/inspections/sheet-actions'
import { sheetScope, scopeLabel } from '@/lib/sheet-scope'
import { FIRE_SUB_BY_SUBGROUP } from '@/lib/facility-codes'
import { useExteriorMonth } from '@/components/inspections/exterior-month'
import { SheetItemEditor, type SheetItem as Item, type SheetResult as Result } from '@/components/inspections/sheet-item-editor'
import { SheetGroupBoard } from '@/components/inspections/sheet-group-board'
import { SheetDrawer } from '@/components/inspections/sheet-drawer'
import { SheetGroupToc, type TocEntry } from '@/components/inspections/sheet-group-toc'
import { useUnsavedNavGuard, usePlanSaveHandler } from '@/components/ui/unsaved-nav'
import { pickAutoOpenSheet } from '@/lib/inspection-step-links'
import type { SheetProgress, SheetGroupProgress } from '@/lib/sheet-overview'
import { useSheetResponsesRealtime } from '@/hooks/use-sheet-responses-realtime'

type Sheet = { id: string; sheet_code: string; sheet_name: string }

/** 드로어 개폐·dirty 게이트의 단일 소유자 (소방계획서_23 S7-10 오케스트레이터).
 *
 *  구조(개정 1·2판): 왼쪽 = 머더 카드 보드 상시(SheetGroupBoard, 접이 없음 — Q-2) /
 *  오른쪽 = 시트 단위 포털 드로어(SheetDrawer + SheetGroupToc + SheetItemEditor outline — Q-14).
 *  카드 클릭 = 그 시트 전체를 드로어로 열고 해당 머더로 점프. 같은 시트 안 이동은 재로드·확인창 없음(S7-11).
 *  미저장 이동은 unsaved-nav 3버튼 확인창(Q-18 — window.confirm 금지).
 *  보드 진행률은 서버 progress 위에 열린 시트의 로컬 값을 오버레이(G-9) — 저장·일괄 직후 즉시 갱신. */
export function InspectionSheetClient({ inspectionId, inspectionType, planType, sheets, responses, progress, xCount, canManage, ledgerSubCodes = [], autoOpenSheet = false }: {
  inspectionId: string
  inspectionType: string
  planType: string | null   // special_종합·special_작동·null=자체점검 / monthly·레거시 event=외관
  sheets: Sheet[]
  responses: Record<string, { result: Result; memo: string | null }>
  /** 시트별 진행률 — sheet-overview.ts 집계(withGroups=true — 머더 버킷 포함) */
  progress: Record<string, SheetProgress>
  xCount: number
  canManage: boolean
  /** 대장 하위(FIRE_SUB_ITEMS) 설치 코드 — Q-22 ② 힌트 배너용. 비면 배너 침묵(P-15) */
  ledgerSubCodes?: string[]
  /** 딥링크 `?sheet=auto` — 마운트 시 첫 미완성 시트 드로어를 자동으로 연다 */
  autoOpenSheet?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [sel, setSel] = useState<Sheet | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [local, setLocal] = useState<Record<string, Result>>({})
  const [base, setBase] = useState<Record<string, Result>>({})   // 편집 기준값 — dirty 판정용 (S5-5)
  const [pendingJump, setPendingJump] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [stale, setStale] = useState(false)   // S5-5: 편집 중 원격 저장 감지 배너
  // §9-4 A안: 빠른 결과 입력 — 전체 양호 + 불량 검색 태깅
  const [quickQ, setQuickQ] = useState('')
  const [quickResults, setQuickResults] = useState<Array<{ item_code: string; item_name: string; sheet_name: string; current: Result | null }>>([])
  const [picked, setPicked] = useState<{ item_code: string; item_name: string; sheet_name: string } | null>(null)
  const [quickMemo, setQuickMemo] = useState('')
  const quickDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollBoxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (quickDebounce.current) clearTimeout(quickDebounce.current)
    quickDebounce.current = setTimeout(() => {
      if (quickQ.trim().length < 2) { setQuickResults([]); return }
      searchQuickItemsAction(inspectionId, quickQ).then(r => setQuickResults(r.items ?? [])).catch(() => setQuickResults([]))
    }, 300)
    return () => { if (quickDebounce.current) clearTimeout(quickDebounce.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickQ])

  // 자체점검 여부·종류 = plan_type 우선 (일반관리 자체점검 대응 — W-20). null 레거시는 inspection_type 폴백
  const scope = sheetScope(planType, inspectionType)
  // EX-4(소방계획서_19, 125): 외관점검표는 12개월 연간 서식 — 한 점검 건에 달을 나눠 기록한다.
  const isExterior = planType === 'monthly' || planType === 'event'
  const { month, setMonth } = useExteriorMonth()

  // ── dirty — local ↔ base 차이 ──
  const dirty = useMemo(() => {
    for (const k of new Set([...Object.keys(local), ...Object.keys(base)]))
      if (local[k] !== base[k]) return true
    return false
  }, [local, base])
  const selRef = useRef<Sheet | null>(null)
  selRef.current = sel
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  // ── Realtime (S5) — 편집 중이면 드로어 안 배너, 아니면 RSC 갱신 ──
  const reinitRef = useRef(false)   // [최신 불러오기] — dirty여도 1회 강제 재초기화
  // 저장속도 개선(2026-08-15): 내 저장의 DELETE 이벤트는 old에 PK만 실려 updated_by 자기 식별이
  // 불가능하다(훅 주석 참조) — 방금 저장한 직후의 이벤트는 에코로 보고 refresh를 건너뛴다
  const lastSaveAtRef = useRef(0)
  useSheetResponsesRealtime([inspectionId], () => {
    // dirty 배너가 항상 우선 — 에코 창이 원격 변경 감지(S5-5·P14)를 삼키면 안 된다
    if (selRef.current && dirtyRef.current) { setStale(true); return }
    if (Date.now() - lastSaveAtRef.current < 2000) return   // 내 저장 에코 — refresh만 건너뜀
    setStale(false)
    router.refresh()
  })
  // router.refresh()로 responses prop이 새로 오면, 편집 중이 아닐 때만 열린 편집기 값을 재초기화
  useEffect(() => {
    if (!selRef.current) return
    if (dirtyRef.current && !reinitRef.current) return
    reinitRef.current = false
    if (isExterior) {
      // EX-4 재검증 R-2·R-3: responses prop은 월 무구분 축약(page.tsx가 month 없이 조회)이라
      // 그대로 부으면 다른 달 값이 이 달 편집기에 주입되고, 저장 시 그 달로 복제된다 —
      // 열린 시트를 지금 달 스냅샷(doOpen과 같은 월 필터 경로)으로 다시 로드한다
      const seq = ++loadSeq.current
      const sheetId = selRef.current.id
      void (async () => {
        const snap = await loadSheetSnapshotAction(inspectionId, sheetId, month)
        if (seq !== loadSeq.current || snap.error) return
        const visible = snap.items ?? []
        setItems(visible)
        const init: Record<string, Result> = {}
        for (const it of visible) { const r = (snap.responses ?? {})[it.item_code]; if (r) init[it.item_code] = r.result }
        setLocal(init); setBase(init)
      })()
      return
    }
    const init: Record<string, Result> = {}
    for (const it of items) { const r = responses[it.item_code]; if (r) init[it.item_code] = r.result }
    setLocal(init); setBase(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responses])

  /** 로드 경합 방지 — 카드 A→B를 빠르게 누르면 두 요청이 겹친다. 마지막 요청만 반영(loadSeq) */
  const loadSeq = useRef(0)
  function doOpen(sheet: Sheet, groupCode: string | null, forMonth = month) {
    setError(''); setStale(false); setSel(sheet)
    const seq = ++loadSeq.current
    startTransition(async () => {
      // 스냅샷 1왕복(S6-2) — 항목(서버 범위 필터 적용)+응답+권한. 종전 2왕복(항목→외관 월 응답)을 접는다
      const snap = await loadSheetSnapshotAction(inspectionId, sheet.id, isExterior ? forMonth : 0)
      if (seq !== loadSeq.current) return
      if (snap.error) { setError(snap.error); return }
      const visible = snap.items ?? []
      setItems(visible)
      const init: Record<string, Result> = {}
      for (const it of visible) { const r = (snap.responses ?? {})[it.item_code]; if (r) init[it.item_code] = r.result }
      setLocal(init); setBase(init)
      setPendingJump(groupCode ?? (visible[0] ? groupCodeOf(visible[0]) : null))
    })
  }
  function doClose() {
    setSel(null); setItems([]); setLocal({}); setBase({}); setPendingJump(null)
    // 편집 중 미뤄둔 원격 변경이 있으면 나가면서 반영
    if (stale) { setStale(false); router.refresh() }
  }

  // ── Q-18 — 미저장 이동은 unsaved-nav 3버튼([저장하고 이동]) 확인창. window.confirm 금지 ──
  type NavTarget = { kind: 'open'; sheet: Sheet; groupCode: string | null } | { kind: 'close' } | { kind: 'month'; month: number }
  const guard = useUnsavedNavGuard<NavTarget>({
    message: '점검표에 저장하지 않은 입력이 있습니다. 저장하지 않고 이동하면 이 시트의 입력이 사라집니다.',
    onProceed: t => {
      if (t.kind === 'open') doOpen(t.sheet, t.groupCode)
      else if (t.kind === 'close') doClose()
      else applyMonth(t.month)
    },
  })
  // [저장하고 이동] — 드로어의 save를 등록(dirty일 때만 응답)
  usePlanSaveHandler(() => doSave(), dirty)

  /** 카드·시트 헤더 → 열기. 같은 시트면 점프만(재로드 금지 — 종전 open()은 무조건 재로드해
   *  미저장 입력을 날렸다, S7-11). 다른 시트로는 dirty 게이트를 거친다 */
  function requestOpen(sheetId: string, groupCode: string | null) {
    // canManage 없어도 연다 — 조회 전용 드로어(○/✕ 비활성·[저장] 없음, S8 프로브 17). 편집 게이트는 에디터 canEdit이 갖는다
    const sheet = sheets.find(s => s.id === sheetId)
    if (!sheet) return
    if (sel?.id === sheetId) { setPendingJump(groupCode ?? groupEntries[0]?.code ?? null); return }
    if (dirtyRef.current) { guard.request({ kind: 'open', sheet, groupCode }); return }
    doOpen(sheet, groupCode)
  }
  function requestClose(reason: 'esc' | 'backdrop' | 'button') {
    if (reason === 'backdrop' && dirtyRef.current) return   // dismissOnBackdrop=false와 이중 방어
    if (dirtyRef.current) { guard.request({ kind: 'close' }); return }
    doClose()
  }
  /** EX-4: 월 전환 — dirty면 같은 guard(Q-18), 아니면 그 달 값으로 다시 채운다 */
  function changeMonth(next: number) {
    if (dirtyRef.current) { guard.request({ kind: 'month', month: next }); return }
    applyMonth(next)
  }
  function applyMonth(next: number) {
    setMonth(next)
    if (selRef.current) doOpen(selRef.current, null, next)
  }

  /** 딥링크 `?sheet=auto` — 달력·계획 패널의 [점검표 입력]이 여기로 보낸다. 마운트 1회만 연다.
   *
   *  ① 단계의 정상 완료 경로는 '점검표 응답 1건 이상'인데(inspection-step-status.ts evidenceDone),
   *  종전엔 그 자리로 가는 링크가 없어 사용자가 [사유 완료]밖에 누를 수 없었다. 이 훅이 그 경로를 잇는다.
   *  선택 규칙은 pickAutoOpenSheet(순수 함수 — 프로브가 DB 없이 단언한다).
   *  전부 입력된 상태면 열지 않는다 — 다 채운 사람에게 드로어를 던지면 방해일 뿐이다. */
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (!autoOpenSheet || autoOpenedRef.current) return
    autoOpenedRef.current = true
    const list = sheets.map(s => progress[s.id]).filter((p): p is SheetProgress => !!p)
    const target = pickAutoOpenSheet(list)
    if (target) requestOpen(target.sheetId, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenSheet])

  /** 저장(S7-14) — 시트 전체 rows + 해제분 clearCodes. 저장 후 드로어를 닫지 않고 base=local — 연속 입력 */
  function doSave(): Promise<boolean> {
    setError('')
    const snapshot = local
    const rows = items.filter(i => snapshot[i.item_code]).map(i => ({ item_code: i.item_code, result: snapshot[i.item_code] }))
    // 기준값에는 있었는데 지금은 없는 항목 = 미점검(공란)으로 되돌린 것 → DB에서 지운다(Q-19).
    // 이게 없으면 화면에서만 풀리고 저장된 값이 남아 문서에 그대로 인쇄된다.
    const clearCodes = items.filter(i => base[i.item_code] && !snapshot[i.item_code]).map(i => i.item_code)
    return new Promise(resolve => {
      startTransition(async () => {
        const res = await saveSheetResponsesAction(inspectionId, rows, isExterior ? month : 0, clearCodes)
        if (res.error) { setError(res.error); resolve(false); return }
        setBase(snapshot); setStale(false)
        lastSaveAtRef.current = Date.now()
        setNotice('✅ 저장했습니다 — 계속 입력할 수 있습니다.')
        // 저장속도 개선(2026-08-15): 상세 페이지 재렌더(1~4초)가 저장을 지배했다 — 단계 상태가
        // 실제로 바뀐 저장(서버가 판정)에만 refresh. 화면 값은 로컬 상태+보드 오버레이가 이미 최신이다
        if (res.stepsChanged) router.refresh()
        resolve(true)
      })
    })
  }

  function groupCodeOf(it: Item): string {
    return it.group_code ?? (/^[A-Z]/.test(it.item_code) ? (it.group ?? '') : it.item_code.replace(/-\d+$/, ''))
  }

  // ── 파생 — 드로어 목차 엔트리·시트 카운트 (로컬 값 기준 = 라이브) ──
  const groupEntries: TocEntry[] = useMemo(() => {
    const map = new Map<string, TocEntry>()
    for (const it of items) {
      const code = groupCodeOf(it)
      let e = map.get(code)
      if (!e) { e = { code, name: it.group_name ?? code, total: 0, responded: 0, x: 0 }; map.set(code, e) }
      e.total++
      const r = local[it.item_code]
      if (r) { e.responded++; if (r === 'X') e.x++ }
    }
    return [...map.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, local])
  const selCounts = useMemo(() => {
    let responded = 0, x = 0, n = 0
    for (const it of items) { const r = local[it.item_code]; if (r) { responded++; if (r === 'X') x++; if (r === 'N') n++ } }
    return { responded, x, n, total: items.length }
  }, [items, local])

  /** G-9 — 보드 진행률 오버레이: 열린 시트만 로컬 값으로 재집계해 서버 progress를 대체.
   *  저장·일괄 직후 카드 n/m·섹션 합계가 새로고침 없이 즉시 맞는다(프로브 21) */
  const overlaidProgress: SheetProgress[] = useMemo(() => {
    const list = sheets.map(s => progress[s.id]).filter((p): p is SheetProgress => !!p)
    if (!sel) return list
    return list.map(p => {
      if (p.sheetId !== sel.id) return p
      const buckets = new Map<string, SheetGroupProgress>()
      const counts = { O: 0, X: 0, N: 0 }
      let responded = 0
      for (const it of items) {
        const code = groupCodeOf(it)
        let b = buckets.get(code)
        if (!b) {
          b = {
            groupKey: `${p.sheetId}:${code}`, groupCode: code, groupName: it.group_name ?? code,
            groupOrder: buckets.size + 1, total: 0, responded: 0, x: 0, subgroupNames: [],
          }
          buckets.set(code, b)
        }
        b.total++
        if (it.subgroup_name && !b.subgroupNames.includes(it.subgroup_name)) b.subgroupNames.push(it.subgroup_name)
        const r = local[it.item_code]
        if (r) { responded++; counts[r]++; b.responded++; if (r === 'X') b.x++ }
      }
      return { ...p, total: items.length || p.total, responded, counts, groups: [...buckets.values()] }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets, progress, sel, items, local])
  const noFacilityInfo = overlaidProgress.length > 0 && overlaidProgress.every(p => !p.installed)

  // ── Q-20 — 시트 단위 ／ 일괄 (빈 칸만·토글, Q-21) ──
  function localSheetNA() {
    const empty = items.filter(i => !local[i.item_code]).map(i => i.item_code)
    if (empty.length > 0) {
      if (!window.confirm(`이 시트의 미입력 ${empty.length}개 항목을 ／(해당없음)로 표시합니다.\n이미 입력한 ○/✕/／ ${selCounts.responded}건은 그대로 유지됩니다. 진행할까요?`)) return
      setLocal(s => { const n = { ...s }; for (const c of empty) n[c] = 'N'; return n })
      return
    }
    const ns = items.filter(i => local[i.item_code] === 'N').map(i => i.item_code)
    if (ns.length === 0) return
    if (!window.confirm(`미입력 항목이 없습니다. 이 시트의 ／(해당없음) ${ns.length}건을 해제할까요? (○/✕는 유지)`)) return
    setLocal(s => { const n = { ...s }; for (const c of ns) delete n[c]; return n })
  }
  /** 보드의 [／ 전체] — 열린 시트면 로컬 위임(dirty 충돌 방지), 닫힌 시트면 서버 액션 1왕복(S6-6) */
  function boardSheetNA(sheetId: string) {
    if (sel?.id === sheetId) { localSheetNA(); return }
    const p = progress[sheetId]
    if (!p) return
    const empty = p.total - p.responded
    setError(''); setNotice('')
    if (empty > 0) {
      if (!window.confirm(`[${p.sheetName}] 미입력 ${empty}개 항목을 ／(해당없음)로 기록합니다.\n이미 입력한 ○/✕/／ ${p.responded}건은 그대로 유지됩니다. 진행할까요?`)) return
      startTransition(async () => {
        const res = await bulkSheetNAAction(inspectionId, sheetId, isExterior ? month : 0, 'apply')
        if (res.error) { setError(res.error); return }
        setNotice(`✅ [${p.sheetName}] ${res.applied}개 항목을 ／로 기록했습니다.`)
        router.refresh()
      })
      return
    }
    if (p.counts.N === 0) return
    if (!window.confirm(`[${p.sheetName}] 미입력 항목이 없습니다. ／(해당없음) ${p.counts.N}건을 해제할까요? (○/✕는 유지)`)) return
    startTransition(async () => {
      const res = await bulkSheetNAAction(inspectionId, sheetId, isExterior ? month : 0, 'release')
      if (res.error) { setError(res.error); return }
      setNotice(`✅ [${p.sheetName}] ／ ${res.released}건을 해제했습니다.`)
      router.refresh()
    })
  }

  // ── Q-22 ② — 대장 힌트 배너: 하위 행이 1건 이상 있을 때만(P-15 침묵), 판정은 사람 ──
  const ledgerHint = useMemo(() => {
    if (!sel || ledgerSubCodes.length === 0) return null
    const missing: Array<{ name: string; codes: string[] }> = []
    const seen = new Set<string>()
    for (const it of items) {
      const sub = it.subgroup_name
      if (!sub || seen.has(sub)) continue
      const ledger = FIRE_SUB_BY_SUBGROUP[sub]
      if (!ledger || ledgerSubCodes.includes(ledger)) continue
      seen.add(sub)
      missing.push({ name: sub, codes: items.filter(i => i.subgroup_name === sub).map(i => i.item_code) })
    }
    return missing.length > 0 ? missing : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, items, ledgerSubCodes])
  function applyLedgerHint() {
    if (!ledgerHint) return
    setLocal(s => {
      const n = { ...s }
      for (const g of ledgerHint) for (const c of g.codes) if (!n[c]) n[c] = 'N'   // 빈 칸만 (Q-21)
      return n
    })
  }

  function bulkGood() {
    if (!window.confirm('설치된 설비의 모든 미입력 항목을 ○(정상)으로 채웁니다.\n이미 입력한 항목(○/✕/／)은 그대로 유지됩니다. 진행할까요?')) return
    setError(''); setNotice('')
    startTransition(async () => {
      // EX-4: 외관은 고른 달에 채운다 — 월을 접어 판정하면 3월에 채운 항목이 7월엔 안 채워진다
      const res = await bulkAllGoodAction(inspectionId, isExterior ? month : 0)
      if (res.error) { setError(res.error); return }
      setNotice(`✅ 설비 시트 ${res.sheetCount}개 · ${res.filled}개 항목을 ○로 채웠습니다${(res.kept ?? 0) > 0 ? ` (기존 입력 ${res.kept}건 유지)` : ''} — 불량은 아래 검색으로 태깅하세요.`)
      router.refresh()
    })
  }

  function saveQuickDefect() {
    if (!picked) return
    setError(''); setNotice('')
    startTransition(async () => {
      const res = await saveSheetResponsesAction(inspectionId, [{ item_code: picked.item_code, result: 'X', memo: quickMemo }], isExterior ? month : 0)
      if (res.error) { setError(res.error); return }
      const reg = await createDefectsFromXAction(inspectionId)
      setNotice(`✅ ${picked.item_code} 불량(✕) 저장${reg.added ? ` + 불량내역 ${reg.added}건 자동 등록` : ''}`)
      setPicked(null); setQuickMemo(''); setQuickQ(''); setQuickResults([])
      router.refresh()
    })
  }

  function registerDefects() {
    setError(''); setNotice('')
    startTransition(async () => {
      const res = await createDefectsFromXAction(inspectionId)
      if (res.error) { setError(res.error); return }
      setNotice(res.added ? `${res.added}건의 불량을 등록했습니다.` : '새로 등록할 불량이 없습니다.')
      router.refresh()
    })
  }

  // R13-d: 시트 X 항목 그 자리에서 즉시 등록 (X 저장 + 불량내역 자동 등록)
  function registerInlineX(itemCode: string, memo: string) {
    setError(''); setNotice('')
    startTransition(async () => {
      const res = await saveSheetResponsesAction(inspectionId, [{ item_code: itemCode, result: 'X', memo }], isExterior ? month : 0)
      if (res.error) { setError(res.error); return }
      const reg = await createDefectsFromXAction(inspectionId)
      setNotice(`✅ ${itemCode} 불량(✕) 저장${reg.added ? ` + 불량내역 ${reg.added}건 자동 등록` : ''}`)
      router.refresh()
    })
  }

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardCheck className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">점검표 입력</h2>
        <span className="text-xs text-[#b0acd6] ml-auto">{scopeLabel(scope)}</span>
      </div>

      {/* EX-4(소방계획서_19, 125): 외관점검표는 12개월 연간 서식 — 같은 점검 건에 달을 나눠 기록한다 */}
      {isExterior && canManage && (
        <div className="mb-3 flex items-center gap-2 flex-wrap rounded-lg border border-[#e0ddf5] bg-[#fafaff] px-3 py-2">
          <span className="text-[11px] font-semibold text-[#514b81]">점검 월</span>
          <select value={month} onChange={e => changeMonth(Number(e.target.value))} disabled={isPending}
            className="h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]">
            <option value={0}>점검일 기준(기본)</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>{m}월</option>
            ))}
          </select>
          <span className="text-[11px] text-[#b0acd6]">
            달을 바꿔 저장하면 그 달의 실적으로 기록됩니다 — 외관점검표는 기록한 달이 한 장에 누적 인쇄됩니다.
          </span>
        </div>
      )}

      {canManage && xCount > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
          <AlertTriangle className="size-3.5 text-red-500 shrink-0" />
          <span className="text-xs text-red-700">불량(X) {xCount}건 — 표준 문구로 불량내역에 등록</span>
          <button onClick={registerDefects} disabled={isPending}
            className="ml-auto h-7 px-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-medium disabled:opacity-50">
            불량 등록
          </button>
        </div>
      )}
      {notice && <p className="text-xs text-green-600 mb-2">{notice}</p>}
      {error && !sel && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {/* §9-4 A안: 빠른 결과 입력 — 대부분 양호·불량 소수 패턴 (모바일 현장 입력 대응) */}
      {canManage && (
        <div className="mb-3 rounded-lg border border-[#e0ddf5] bg-[#fafaff] p-3 space-y-2">
          <p className="text-[11px] font-semibold text-[#514b81] flex items-center gap-1">
            <Zap className="size-3 text-[#7b68ee]" /> 빠른 결과 입력
            <span className="font-normal text-[#b0acd6]">— ① 전체 양호 후 ② 불량 항목만 검색해 태깅</span>
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={bulkGood} disabled={isPending}
              className="h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium disabled:opacity-50">
              설치 설비 전체 양호 ○
            </button>
            <div className="relative flex-1 min-w-52">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={quickQ} onChange={e => { setQuickQ(e.target.value); setPicked(null) }}
                placeholder="불량 항목 검색 (명칭·코드 2자 이상)"
                className="h-8 w-full rounded-lg border border-[#d0ccf5] bg-white pl-7 pr-2 text-xs outline-none focus:border-[#7b68ee]" />
            </div>
          </div>
          {!picked && quickResults.length > 0 && (
            <div className="max-h-44 overflow-y-auto rounded-lg border border-[#e0ddf5] bg-white divide-y divide-[#f3f1fb]">
              {quickResults.map(r => (
                <button key={r.item_code} onClick={() => { setPicked(r); setQuickMemo('') }}
                  className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-[#f5f4ff] flex items-center gap-2">
                  <span className="text-[10px] text-[#b0acd6] w-16 shrink-0">{r.item_code}</span>
                  <span className="text-[#090c1d] flex-1 min-w-0 truncate">{r.item_name}</span>
                  <span className="text-[10px] text-[#b0acd6] shrink-0 max-w-24 truncate">{r.sheet_name}</span>
                  {r.current && <span className={`text-[10px] font-bold shrink-0 ${r.current === 'X' ? 'text-red-500' : r.current === 'O' ? 'text-green-600' : 'text-gray-400'}`}>{r.current === 'O' ? '○' : r.current === 'X' ? '✕' : '／'}</span>}
                </button>
              ))}
            </div>
          )}
          {!picked && quickQ.trim().length >= 2 && quickResults.length === 0 && (
            <p className="text-[11px] text-[#b0acd6]">검색 결과 없음 — 다른 키워드로 시도해보세요 (예: 수신기, 감지기, 유도등)</p>
          )}
          {picked && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 space-y-1.5">
              <p className="text-xs text-red-700"><span className="font-semibold">{picked.item_code}</span> {picked.item_name} <span className="text-[10px] text-red-400">({picked.sheet_name})</span></p>
              <div className="flex items-center gap-2 flex-wrap">
                <input value={quickMemo} onChange={e => setQuickMemo(e.target.value)} placeholder="불량 메모 (선택 — 불량내역 상세로 들어감)"
                  className="h-8 flex-1 min-w-48 rounded-lg border border-red-200 bg-white px-2 text-xs outline-none focus:border-red-400" />
                <button onClick={saveQuickDefect} disabled={isPending}
                  className="h-8 px-3 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-medium disabled:opacity-50">
                  {isPending ? <Loader2 className="size-3.5 animate-spin" /> : '✕ 불량 저장 (자동 등록)'}
                </button>
                <button onClick={() => setPicked(null)} className="h-8 px-2 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81]">취소</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 머더 카드 보드 — 상시(Q-2, 접이 없음). 드로어가 떠도 사라지지 않는다(포털 오버레이 — Q-4) */}
      <p className="text-[11px] text-[#b0acd6] mb-2">
        머더(중분류) 카드를 누르면 그 시트 전체가 오른쪽에 열리고 해당 위치로 이동합니다 — ○(정상)/✕(불량), ／(해당없음)는 일괄 버튼.
      </p>
      <SheetGroupBoard progress={overlaidProgress} noFacilityInfo={noFacilityInfo}
        canEdit={canManage} busy={isPending}
        onOpen={requestOpen} onSheetNA={boardSheetNA} />

      {/* 시트 단위 드로어 (Q-14) — 개폐·dirty 게이트는 이 컴포넌트가 소유, 셸은 dirty를 모른다 */}
      <SheetDrawer open={!!sel} onRequestClose={requestClose} dismissOnBackdrop={!dirty}
        title={sel?.sheet_name ?? ''}
        headerRight={
          <span className="flex items-center gap-2 ml-auto min-w-0">
            <span className={`text-[10px] shrink-0 ${selCounts.total > 0 && selCounts.responded >= selCounts.total ? 'text-green-600' : 'text-[#b0acd6]'}`}>
              {selCounts.responded}/{selCounts.total}{selCounts.x > 0 ? ` ✕${selCounts.x}` : ''}
            </span>
            {canManage && (
              <button onClick={localSheetNA} disabled={isPending} data-testid="drawer-sheet-na"
                title="이 시트의 미입력 항목을 전부 ／(해당없음)로 — 입력된 ○/✕는 보존 (재클릭 시 ／만 해제)"
                className="h-6 px-2 rounded text-[10px] font-medium border border-[#d0ccf5] text-[#514b81] hover:bg-[#ebe9ff] disabled:opacity-40 shrink-0">
                ／ 전체
              </button>
            )}
            {dirty && <span className="text-[10px] font-semibold text-amber-600 shrink-0" data-testid="drawer-dirty">● 미저장</span>}
          </span>
        }
        banner={
          <>
            {/* S5-5: dirty 중 원격 저장 감지 — 자동 덮어쓰기 금지, 사용자가 선택 (드로어 안 배너 — R-7) */}
            {stale && (
              <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2">
                <span className="text-xs text-amber-700 flex-1">
                  다른 곳에서 이 점검표가 저장되었습니다 — 입력 중이라 자동 갱신을 멈췄습니다.
                </span>
                <button onClick={() => { reinitRef.current = true; setStale(false); router.refresh() }}
                  className="text-xs text-[#7b68ee] font-medium hover:underline shrink-0">
                  최신 불러오기
                </button>
              </div>
            )}
            {/* Q-22 ② — 대장 힌트: 판정은 사람(22 Q-8). 대장 하위가 전부 비어 있으면 침묵(P-15) */}
            {ledgerHint && canManage && (
              <div className="flex items-center gap-2 flex-wrap border-b border-[#e0ddf5] bg-[#fafaff] px-4 py-2" data-testid="ledger-hint-banner">
                <span className="text-[11px] text-[#514b81] flex-1 min-w-40">
                  설비 대장 기준 미설치로 보이는 그룹 {ledgerHint.length}개 — {ledgerHint.map(g => `[${g.name}]`).join(' ')}
                </span>
                <button onClick={applyLedgerHint} disabled={isPending} data-testid="ledger-hint-apply"
                  className="h-6 px-2 rounded text-[10px] font-medium bg-[#7b68ee] text-white hover:bg-[#6647f0] disabled:opacity-40 shrink-0">
                  해당 그룹 일괄 ／
                </button>
              </div>
            )}
          </>
        }
        toc={<SheetGroupToc entries={groupEntries} scrollBoxRef={scrollBoxRef}
          pendingJump={pendingJump} onJumpConsumed={() => setPendingJump(null)} />}>
        <SheetItemEditor
          items={items} loading={isPending && items.length === 0} value={local}
          grouping="outline" scrollBoxRef={scrollBoxRef}
          maxHeight="max-h-[calc(100dvh-260px)] max-sm:max-h-[calc(92dvh-250px)]"
          // r=null = 해제 → 키를 지운다(미점검 = 값 없음, Q-19). 남겨 두면 저장 시 값이 다시 쓰인다
          onResult={(code, r) => setLocal(s => {
            if (r === null) { const n = { ...s }; delete n[code]; return n }
            return { ...s, [code]: r }
          })}
          onRegisterX={registerInlineX}
          canEdit={canManage} busy={isPending} error={sel ? error : undefined} notice={sel ? notice : undefined}
          onSave={() => { void doSave() }} onCancel={() => requestClose('button')}
          cancelLabel="닫기" showFooterHint={false} />
      </SheetDrawer>

      {guard.dialog}
    </div>
  )
}
