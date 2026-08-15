'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ClipboardList, Loader2, RefreshCw } from 'lucide-react'
import {
  getInspectionSheetOverviewAction, loadSheetEditorAction,
  saveSheetResponsesAction, createDefectsFromXAction,
  bulkAllGoodAction, searchQuickItemsAction, copyPreviousRoundResponsesAction,
} from '@/app/(dashboard)/inspections/sheet-actions'
import type { SheetOverview, SheetProgress } from '@/lib/sheet-overview'
import { SheetItemEditor, type SheetItem, type SheetResult } from '@/components/inspections/sheet-item-editor'
import { useSheetResponsesRealtime } from '@/hooks/use-sheet-responses-realtime'
import { useDebouncedAutosave } from '@/hooks/use-debounced-autosave'

/** 회차별 작성·조회 트리의 점검표 노드 (소방계획서_16 S4).
 *
 *  별지 ④⑨⑩⑪은 이 트리에서 작성·생성까지 되는데 그 원천인 점검표만 화면을 떠나야 했다.
 *  설비(시트) 요약 행은 항상 보여주고(진행률·불량), 클릭한 시트만 항목을 지연 로드해 인라인 입력한다.
 *  항목 입력부는 점검 상세와 공용(sheet-item-editor.tsx) — 저장도 같은 액션이라 동기화 로직이 없다.
 *
 *  ⚠ 이 컴포넌트에 '점검표 입력' 문자열을 재사용하지 말 것 —
 *     test-annex-interaction.mts가 그 문자열 개수로 회차 펼침 상태를 판정한다. */

type Props = {
  inspectionId: string
  /** 역할 축 권한 (can(role,'inspection_register')) — 점검 건 축(overview.canEdit)과 AND로 게이트 */
  canRegister: boolean
  /** 저장 후 상위 회차 카드의 응답 수 표시를 갱신 */
  onSaved?: (respondedTotal: number, defectDelta: number) => void
}

const numCls = (p: SheetProgress) =>
  p.responded === 0 ? 'text-amber-600' : p.responded >= p.total ? 'text-green-600' : 'text-amber-600'

export function PlanAnnexSheetTree({ inspectionId, canRegister, onSaved }: Props) {
  const [ov, setOv] = useState<SheetOverview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [installedOnly, setInstalledOnly] = useState(true)
  const [isLoading, startLoading] = useTransition()

  // 인라인 확장 — 한 회차에서 동시에 펼치는 시트는 1개 (DOM·재조회 범위를 좁힌다)
  const [openSheet, setOpenSheet] = useState<string | null>(null)
  const [items, setItems] = useState<SheetItem[]>([])
  const [draft, setDraft] = useState<Record<string, SheetResult>>({})
  const [baseline, setBaseline] = useState<Record<string, SheetResult>>({})
  const [editErr, setEditErr] = useState('')
  const [notice, setNotice] = useState('')
  const [isBusy, startBusy] = useTransition()
  // S5-5: 원격 변경이 왔는데 편집 중(dirty)이면 자동 갱신 대신 배너
  const [stale, setStale] = useState(false)
  // S4-7: 빠른 입력 — 불량 검색 태깅 (점검 상세와 같은 액션·같은 흐름)
  const [quickQ, setQuickQ] = useState('')
  const [quickResults, setQuickResults] = useState<Array<{ item_code: string; item_name: string; sheet_name: string; current: SheetResult | null }>>([])
  const [picked, setPicked] = useState<{ item_code: string; item_name: string; sheet_name: string } | null>(null)
  const [quickMemo, setQuickMemo] = useState('')

  const load = useCallback(() => {
    startLoading(async () => {
      try {
        const res = await getInspectionSheetOverviewAction([inspectionId])
        if (res.error) { setErr(res.error); return }
        setErr(null)
        setOv(res.overviews?.[inspectionId] ?? null)
      } catch {
        // requirePermission 리다이렉트 등 — 카드 전체가 죽지 않게 (plan-annex-section의 기존 패턴)
        setErr('점검표 진행률을 불러오지 못했습니다 — 권한이 없거나 일시 오류입니다.')
      }
    })
  }, [inspectionId])

  useEffect(() => { load() }, [load])

  // 불량 검색 — 2자 이상, 300ms 디바운스 (점검 상세와 동일)
  useEffect(() => {
    const t = setTimeout(() => {
      if (quickQ.trim().length < 2) { setQuickResults([]); return }
      searchQuickItemsAction(inspectionId, quickQ).then(r => setQuickResults(r.items ?? [])).catch(() => setQuickResults([]))
    }, 300)
    return () => clearTimeout(t)
  }, [quickQ, inspectionId])

  // ── Realtime (S5) — 다른 탭·다른 사용자의 저장을 새로고침 없이 반영 ──
  // 콜백에서 최신 상태가 필요하므로 ref로 미러 (훅 재구독 없이).
  // ⚠ 렌더 중에 ref를 쓰면(React Compiler 'Cannot access refs during render') 메모이제이션에 따라
  //    갱신이 건너뛰어 dirty 판정이 낡는다 — 실제로 dirty 배너가 뜨지 않는 회귀가 났다. effect에서 동기화한다.
  const openSheetRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  useEffect(() => {
    openSheetRef.current = openSheet
    let d = false
    for (const k of new Set([...Object.keys(draft), ...Object.keys(baseline)])) {
      if (draft[k] !== baseline[k]) { d = true; break }
    }
    dirtyRef.current = d
  })

  /** stale 세대 토큰 — 진행 중이던 재조회가 '그 뒤에 새로 올라온' 경고를 지우지 못하게 막는다.
   *  (앞선 remoteRefresh가 끝나며 setStale(false)를 호출해 배너가 저절로 닫히던 경합) */
  const staleTokenRef = useRef(0)

  /** 원격 변경 반영 — 요약 재조회 + 열린 시트가 있으면(비편집) 항목·기준값 재로드 */
  const remoteRefresh = useCallback(() => {
    const token = staleTokenRef.current
    startBusy(async () => {
      try {
        const res = await getInspectionSheetOverviewAction([inspectionId])
        if (res.error) return
        const next = res.overviews?.[inspectionId] ?? null
        if (next) { setOv(next); onSaved?.(next.totals.responded, 0) }
        const sheetId = openSheetRef.current
        if (sheetId) {
          const ed = await loadSheetEditorAction(inspectionId, sheetId)
          if (!ed.error) {
            setItems(ed.items ?? [])
            const init: Record<string, SheetResult> = {}
            for (const [code, r] of Object.entries(ed.responses ?? {})) init[code] = r.result
            setDraft(init); setBaseline(init)
          }
        }
        if (staleTokenRef.current === token) setStale(false)
      } catch { /* 일시 오류 — 다음 이벤트·수동 갱신에서 복구 */ }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionId])

  useSheetResponsesRealtime([inspectionId], () => {
    if (openSheetRef.current && dirtyRef.current) { staleTokenRef.current += 1; setStale(true); return }
    remoteRefresh()
  })

  const editable = canRegister && !!ov?.canEdit

  /** 시트 닫기 — 대기 중인 자동 저장을 흘려보낸 뒤 서버 값으로 요약을 수렴시킨다(로컬 근사치 정리).
   *  ⚠ 닫기를 flush 완료 뒤로 미루면, 그 사이 사용자가 다시 연 시트를 뒤늦게 닫아버린다(실제로 경합 발생).
   *     flush를 먼저 '시작'해 아직 살아 있는 refs로 delta를 읽게 하고, 화면은 즉시 닫는다. */
  function closeSheet() {
    const pending = autosave.flush()
    setOpenSheet(null); setItems([])
    void pending.then(() => load())
  }

  function openSheetRow(p: SheetProgress) {
    if (openSheet === p.sheetId) { closeSheet(); return }
    setOpenSheet(p.sheetId); setItems([]); setEditErr(''); setNotice('')
    startBusy(async () => {
      try {
        const res = await loadSheetEditorAction(inspectionId, p.sheetId)
        if (res.error) { setEditErr(res.error); return }
        setItems(res.items ?? [])
        const init: Record<string, SheetResult> = {}
        for (const [code, r] of Object.entries(res.responses ?? {})) init[code] = r.result
        setDraft(init); setBaseline(init)
      } catch {
        setEditErr('항목을 불러오지 못했습니다 — 권한이 없거나 일시 오류입니다.')
      }
    })
  }

  /* ── S4: 자동 저장 ──────────────────────────────────────────────────────────
   *  설비마다 [이 설비 저장]을 누르게 하면 현장에서 설비 수만큼 클릭이 늘고, 안 누르고 이동하면
   *  입력이 사라진다. 입력이 멈추면 스스로 저장하고 상태만 칩으로 알린다.
   *  저장 대상은 baseline과 다른 항목(delta)뿐 — 전량 upsert는 페이로드도 크고 Realtime 에코도 키운다. */
  const draftRef = useRef(draft)
  const baselineRef = useRef(baseline)
  const itemsRef = useRef(items)
  useEffect(() => { draftRef.current = draft; baselineRef.current = baseline; itemsRef.current = items })

  /** 저장 후 요약 갱신을 서버 재조회 없이 — 열린 시트만 draft로 다시 세고 합계를 그만큼 옮긴다.
   *  시트 간 중복 코드 dedup까지는 반영 못 하는 근사치라, 시트를 닫거나 원격 변경이 오면 재조회로 수렴시킨다. */
  const patchOverviewLocal = useCallback(() => {
    const sheetId = openSheetRef.current
    if (!sheetId) return
    setOv(prev => {
      if (!prev) return prev
      const d = draftRef.current
      const counted = itemsRef.current.filter(i => d[i.item_code])
      const responded = counted.length
      const counts = {
        O: counted.filter(i => d[i.item_code] === 'O').length,
        X: counted.filter(i => d[i.item_code] === 'X').length,
        N: counted.filter(i => d[i.item_code] === 'N').length,
      }
      const before = prev.sheets.find(s => s.sheetId === sheetId)
      if (!before) return prev
      const totals = {
        ...prev.totals,
        responded: prev.totals.responded + (responded - before.responded),
        x: prev.totals.x + (counts.X - before.counts.X),
      }
      onSaved?.(totals.responded, 0)
      return {
        ...prev,
        sheets: prev.sheets.map(s => s.sheetId === sheetId ? { ...s, responded, counts } : s),
        totals,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const autosave = useDebouncedAutosave(async () => {
    const d = draftRef.current, b = baselineRef.current
    const rows = itemsRef.current
      .filter(i => d[i.item_code] && d[i.item_code] !== b[i.item_code])
      .map(i => ({ item_code: i.item_code, result: d[i.item_code] }))
    // 해제(선택 → 해당없음)도 delta다. upsert만 보내면 화면에서만 풀리고 DB에는 종전 O/X가 남는다.
    const clearCodes = itemsRef.current
      .filter(i => b[i.item_code] && !d[i.item_code])
      .map(i => i.item_code)
    if (rows.length === 0 && clearCodes.length === 0) return {}
    const res = await saveSheetResponsesAction(inspectionId, rows, 0, clearCodes)
    if (res.error) return res
    // 저장분만 기준값으로 승격 — 저장 도중 바뀐 항목은 dirty로 남아 다음 저장에 실린다
    setBaseline(prev => {
      const next = { ...prev }
      for (const r of rows) next[r.item_code] = r.result
      for (const c of clearCodes) delete next[c]
      return next
    })
    patchOverviewLocal()
    return {}
  })

  // S4-5: 원격 변경이 감지되면 자동 저장을 멈춘다 — 내 디바운스가 남의 최신 값을 덮어쓰지 않게.
  // 사용자가 [최신 불러오기](남의 값 채택) 또는 [내 입력 저장](flush 후 재조회) 중 하나를 고르면 재개한다.
  useEffect(() => {
    if (stale) autosave.pause(); else autosave.resume()
  }, [stale, autosave])


  /* ── S4-7: 빠른 입력(§9-4 A안)을 트리에도 — 점검 상세에만 있던 기능이라 같은 일을 두 화면에서
   *  다르게 해야 했다. 액션은 그대로 재사용하고 호출부만 추가한다(이중 구현 금지 규약). ── */
  function bulkGood() {
    if (!window.confirm('설치된 설비의 모든 미입력 항목을 ○(정상)으로 채웁니다.\n이미 입력한 항목(○/✕/／)은 그대로 유지됩니다. 진행할까요?')) return
    setEditErr(''); setNotice('')
    startBusy(async () => {
      const res = await bulkAllGoodAction(inspectionId)
      if (res.error) { setEditErr(res.error); return }
      setNotice(`✅ 설비 시트 ${res.sheetCount}개 · ${res.filled}개 항목을 ○로 채웠습니다${(res.kept ?? 0) > 0 ? ` (기존 입력 ${res.kept}건 유지)` : ''} — 불량은 검색으로 태깅하세요.`)
      // 열린 시트가 있으면 채워진 값이 화면에 반영돼야 한다 — 요약·항목 모두 서버 값으로 재수렴
      remoteRefresh()
    })
  }

  /** S4-9: 지난 회차 결과 불러오기 — 안전장치는 서버(미입력만·불량 자동등록 없음·감사)와 여기(고지·검토 유도) 양쪽 */
  function copyPrevious() {
    if (!window.confirm(
      '지난 완료 회차의 점검표 결과를 이번 회차의 미입력 항목에만 채웁니다.\n\n'
      + '· 이미 입력한 항목은 그대로 유지됩니다.\n'
      + '· 불량(✕)은 값만 복사되고 불량내역에는 자동 등록되지 않습니다.\n\n'
      + '⚠ 실제 점검을 대체할 수 없습니다 — 불러온 뒤 현장 확인 결과로 반드시 수정하세요.\n\n진행할까요?'
    )) return
    setEditErr(''); setNotice('')
    startBusy(async () => {
      const res = await copyPreviousRoundResponsesAction(inspectionId)
      if (res.error) { setEditErr(res.error); return }

      // 요약 재조회 (여기서는 remoteRefresh 대신 직접 — 아래 '검토 유도'가 갱신된 값을 봐야 한다)
      const fresh = await getInspectionSheetOverviewAction([inspectionId])
      const next = fresh.overviews?.[inspectionId] ?? null
      if (next) { setOv(next); onSaved?.(next.totals.responded, 0) }

      // S4-10②: 검토 유도 — 복사만 하고 덮어두면 확인 없이 그대로 생성될 수 있다.
      // 불량(✕)이 실린 시트를 우선 펼쳐 눈에 걸리게 한다(없으면 응답이 들어온 첫 시트).
      const target = next?.sheets.find(s => s.counts.X > 0) ?? next?.sheets.find(s => s.responded > 0)
      if (target && openSheetRef.current !== target.sheetId) openSheetRow(target)

      setNotice(
        `✅ ${res.sourceLabel}에서 ${res.filled}개 항목을 불러왔습니다`
        + `${res.skipped ? ` (이번 회차 입력 ${res.skipped}건은 유지)` : ''}`
        + `${res.copiedX ? ` · 불량 ${res.copiedX}건은 값만 복사됨 — 확인 후 [등록] 필요` : ''}`
        + `${target ? ` — 검토하도록 '${target.sheetName}'를 펼쳤습니다.` : ''}`
        + ' 현장 확인 결과로 수정하세요.'
      )
    })
  }

  function saveQuickDefect() {
    if (!picked) return
    setEditErr(''); setNotice('')
    startBusy(async () => {
      const res = await saveSheetResponsesAction(inspectionId, [{ item_code: picked.item_code, result: 'X', memo: quickMemo }])
      if (res.error) { setEditErr(res.error); return }
      const reg = await createDefectsFromXAction(inspectionId)
      setNotice(`✅ ${picked.item_code} 불량(✕) 저장${reg.added ? ` + 불량내역 ${reg.added}건 자동 등록` : ''}`)
      setPicked(null); setQuickMemo(''); setQuickQ(''); setQuickResults([])
      remoteRefresh()
    })
  }

  function registerX(itemCode: string, memo: string) {
    setEditErr(''); setNotice('')
    startBusy(async () => {
      const res = await saveSheetResponsesAction(inspectionId, [{ item_code: itemCode, result: 'X', memo }])
      if (res.error) { setEditErr(res.error); return }
      const reg = await createDefectsFromXAction(inspectionId)
      setDraft(s => ({ ...s, [itemCode]: 'X' }))
      setBaseline(s => ({ ...s, [itemCode]: 'X' }))
      setNotice(`✅ ${itemCode} 불량(✕) 저장${reg.added ? ` + 불량내역 ${reg.added}건 자동 등록` : ''}`)
      const fresh = await getInspectionSheetOverviewAction([inspectionId])
      const next = fresh.overviews?.[inspectionId] ?? null
      if (next) { setOv(next); onSaved?.(next.totals.responded, reg.added ?? 0) }
    })
  }

  if (err) return <p className="py-1.5 text-[11px] text-amber-600">{err}</p>
  if (!ov) {
    return (
      <p className="py-1.5 text-[11px] text-[#b0acd6] inline-flex items-center gap-1">
        {/* 완료 문구('설비별 진행 N/M')와 접두사가 겹치면 상태 구분이 어렵다 — 다른 어휘로 */}
        <Loader2 className="size-3 animate-spin" /> 점검표 설비 목록을 불러오는 중…
      </p>
    )
  }

  // 설치 정보가 아예 없는 고객은 필터를 걸면 전부 사라지므로 자동 해제 (bulkAllGood와 같은 상황 처리)
  const filterOn = installedOnly && !ov.noFacilityInfo
  const rows = filterOn ? ov.sheets.filter(s => s.installed) : ov.sheets
  const hiddenCount = ov.sheets.length - rows.length

  return (
    <div className="pl-5 pb-1">
      <div className="flex items-center gap-2 flex-wrap py-1">
        <span className="text-[11px] text-[#514b81]">
          설비별 진행 {ov.totals.responded}/{ov.totals.total}
          {ov.totals.x > 0 && <span className="text-red-500 ml-1">✕{ov.totals.x}</span>}
        </span>
        {!ov.noFacilityInfo && (
          <label className="inline-flex items-center gap-1 text-[10px] text-[#847ba8] cursor-pointer">
            <input type="checkbox" checked={installedOnly} onChange={e => setInstalledOnly(e.target.checked)} className="size-3" />
            설치 설비만 보기{hiddenCount > 0 ? ` (${hiddenCount} 숨김)` : ''}
          </label>
        )}
        {ov.noFacilityInfo && (
          <span className="text-[10px] text-amber-600">설치 시설 정보가 없어 전체 시트를 표시합니다 — 1.4에서 등록하세요</span>
        )}
        {!editable && <span className="text-[10px] text-[#b0acd6]">보기 전용 — 담당자·팀장만 입력</span>}
        {/* S4-4: 자동 저장 상태 — 저장 버튼이 없으므로 이 칩이 유일한 저장 피드백이다 */}
        {editable && openSheet && autosave.status !== 'idle' && (
          <span className="text-[10px] inline-flex items-center gap-1">
            {autosave.status === 'saving' && <span className="text-[#847ba8] inline-flex items-center gap-0.5"><Loader2 className="size-2.5 animate-spin" /> 저장 중…</span>}
            {autosave.status === 'saved' && <span className="text-green-600">✓ 저장됨</span>}
            {autosave.status === 'paused' && <span className="text-amber-600">⏸ 저장 보류 — 아래 배너에서 선택</span>}
            {autosave.status === 'error' && (
              <>
                <span className="text-red-600">⚠ 저장 실패</span>
                <button onClick={() => void autosave.retry()} className="text-[#7b68ee] font-medium hover:underline">다시 시도</button>
              </>
            )}
          </span>
        )}
        <button onClick={load} disabled={isLoading} className="ml-auto text-[10px] text-[#b0acd6] hover:text-[#7b68ee] inline-flex items-center gap-0.5 disabled:opacity-50">
          <RefreshCw className={`size-2.5 ${isLoading ? 'animate-spin' : ''}`} /> 갱신
        </button>
      </div>
      {autosave.error && <p className="text-[11px] text-red-600 py-0.5">{autosave.error}</p>}

      {/* S5-5: dirty 중 원격 저장 감지 — 자동 덮어쓰기 대신 사용자가 선택 */}
      {stale && (
        <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 my-1">
          <span className="text-[11px] text-amber-700 flex-1">
            다른 곳에서 이 점검표가 저장되었습니다 — 입력 중이라 자동 갱신을 멈췄습니다.
          </span>
          {/* S4-5: 두 갈래를 명시 — 남의 값을 받거나(내 입력 폐기), 내 입력을 먼저 저장하고 받거나 */}
          <button onClick={() => void autosave.flush().then(remoteRefresh)} disabled={isBusy}
            className="text-[11px] text-[#7b68ee] font-medium hover:underline shrink-0 disabled:opacity-50">
            내 입력 저장
          </button>
          <button onClick={remoteRefresh} disabled={isBusy}
            className="text-[11px] text-[#514b81] hover:underline shrink-0 disabled:opacity-50">
            최신 불러오기
          </button>
        </div>
      )}

      {/* S4-7 빠른 입력(§9-4 A안) — 대부분 양호·불량 소수인 현장 패턴: ① 전체 양호 ② 불량만 검색 태깅 */}
      {editable && (
        <div className="rounded border border-[#eceafd] bg-[#fafaff] px-2 py-1.5 my-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={bulkGood} disabled={isBusy}
              title="설치 설비의 미입력 항목만 ○로 채웁니다 — 기존 입력은 유지"
              className="h-8 px-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-[11px] font-medium disabled:opacity-50">
              설치 설비 전체 양호 ○
            </button>
            <button onClick={copyPrevious} disabled={isBusy}
              title="지난 완료 회차 결과를 미입력 항목에만 채웁니다 — 실제 점검을 대체하지 않습니다"
              className="h-8 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#514b81] hover:bg-[#f5f4ff] disabled:opacity-50">
              지난 회차 결과 불러오기
            </button>
            <input value={quickQ} onChange={e => setQuickQ(e.target.value)}
              placeholder="불량 항목 검색 (2자 이상)"
              className="h-8 flex-1 basis-40 min-w-0 rounded-lg border border-[#d0ccf5] bg-white px-2 text-[11px] outline-none focus:border-[#7b68ee]" />
          </div>
          {quickResults.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded border border-[#e0ddf5] bg-white divide-y divide-[#f5f4ff]">
              {quickResults.map(q => (
                <button key={q.item_code} onClick={() => { setPicked(q); setQuickMemo('') }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-[#f5f4ff]">
                  <span className="text-[10px] text-[#b0acd6] w-14 shrink-0">{q.item_code}</span>
                  <span className="flex-1 min-w-0 truncate text-[#090c1d]">{q.item_name}</span>
                  <span className="text-[10px] text-[#b0acd6] shrink-0">{q.sheet_name}</span>
                  {q.current && <span className="text-[10px] shrink-0 text-[#847ba8]">현재 {q.current}</span>}
                </button>
              ))}
            </div>
          )}
          {picked && (
            <div className="flex items-center gap-2 flex-wrap rounded border border-red-200 bg-white px-2 py-1.5">
              <span className="text-[11px] text-[#090c1d] flex-1 basis-40 min-w-0 truncate">✕ {picked.item_code} {picked.item_name}</span>
              <input value={quickMemo} onChange={e => setQuickMemo(e.target.value)}
                placeholder="불량 메모 (선택)"
                className="h-8 flex-1 basis-32 min-w-0 rounded border border-red-200 px-2 text-[11px] outline-none focus:border-red-400" />
              <button onClick={saveQuickDefect} disabled={isBusy}
                className="h-8 px-2.5 rounded bg-red-500 hover:bg-red-600 text-white text-[11px] font-medium disabled:opacity-50">✕ 불량 저장</button>
              <button onClick={() => setPicked(null)} className="h-8 px-2 rounded border border-[#c8c4d0] text-[11px] text-[#514b81]">취소</button>
            </div>
          )}
          {notice && !openSheet && <p className="text-[11px] text-green-600">{notice}</p>}
          {editErr && !openSheet && <p className="text-[11px] text-red-600">{editErr}</p>}
        </div>
      )}

      {rows.length === 0 && <p className="text-[11px] text-[#b0acd6] py-1">표시할 설비 시트가 없습니다.</p>}

      <div className="space-y-0.5">
        {rows.map(p => {
          const open = openSheet === p.sheetId
          return (
            <div key={p.sheetId} className="rounded border border-[#f0eefb]">
              <button onClick={() => openSheetRow(p)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-[#fafaff]">
                {open ? <ChevronDown className="size-3 text-[#b0acd6] shrink-0" /> : <ChevronRight className="size-3 text-[#b0acd6] shrink-0" />}
                <span className="text-[11px] text-[#090c1d] flex-1 min-w-0 truncate">{p.sheetName}</span>
                {p.counts.X > 0 && <span className="text-[10px] text-red-500 shrink-0">✕{p.counts.X}</span>}
                <span className={`text-[10px] shrink-0 ${numCls(p)}`}>{p.responded}/{p.total}</span>
                {p.responded >= p.total ? (
                  <span className="text-[10px] text-green-600 shrink-0">✓</span>
                ) : (
                  <span className="text-[10px] text-amber-600 shrink-0">⚠ 미입력 {p.total - p.responded}</span>
                )}
              </button>
              {open && (
                <div className="px-2 pb-2 border-t border-[#f5f4ff]">
                  <SheetItemEditor
                    items={items} loading={isBusy} value={draft}
                    onResult={(code, r) => {
                      // dirty를 effect로만 갱신하면 커밋 전에 도착한 원격 이벤트가 '편집 중 아님'으로 오판해
                      // 내 입력을 덮어쓴다. 이벤트 핸들러의 ref 쓰기는 렌더 중 쓰기와 달리 안전하므로 즉시 표시한다.
                      dirtyRef.current = true
                      // r=null = 해제 → 키를 지운다(해당없음 = 값 없음)
                      setDraft(s => {
                        if (r === null) { const n = { ...s }; delete n[code]; return n }
                        return { ...s, [code]: r }
                      })
                      // ✕는 인라인 메모 + [등록](불량내역 자동 등록)으로 완결되는 별도 흐름이다.
                      // 여기서 미리 저장하면 메모 없는 X를 썼다가 곧바로 덮어쓰는 이중 쓰기가 되고
                      // Realtime 에코도 두 번 난다. 시트를 닫을 때 flush가 남은 ✕까지 함께 저장한다.
                      if (r !== 'X') autosave.schedule()
                    }}
                    onRegisterX={registerX}
                    canEdit={editable} busy={isBusy} error={editErr} notice={notice}
                    onSave={() => void autosave.flush()}
                    onCancel={closeSheet}
                    maxHeight="max-h-[340px]" showFooterHint={false}
                    /* S4-6: 자동 저장이 대신하므로 저장 버튼을 감춘다 — 점검 상세는 종전대로 유지 */
                    hideSave cancelLabel="닫기" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 점검표 노드 머리줄 — 아이콘·라벨·딥링크. 트리 본체와 분리해 호출부가 배치를 정한다 */
export function PlanAnnexSheetHeader({ inspectionId, responded, defects }: {
  inspectionId: string; responded: number; defects: number
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs border-b border-[#f3f1fc]">
      <ClipboardList className="size-3.5 text-[#7b68ee] shrink-0" />
      <span className="font-medium text-[#090c1d] w-44">점검표 입력</span>
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#f5f4ff] text-[#7b68ee]">입력</span>
      <span className="text-[#514b81]">응답 {responded} · 불량 {defects}</span>
      <Link href={`/inspections/${inspectionId}`} className="ml-auto text-[11px] text-[#7b68ee] hover:underline">
        점검 상세에서 입력 →
      </Link>
    </div>
  )
}
