'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { SheetItemEditor, type SheetItem } from '@/components/inspections/sheet-item-editor'
import { useSheetAutosave } from '@/hooks/use-sheet-autosave'
import { useSheetResponsesRealtime } from '@/hooks/use-sheet-responses-realtime'
import {
  loadSheetSnapshotAction, saveSheetResponsesAction, createDefectsFromXAction,
  bulkAllGoodAction, copyPreviousRoundResponsesAction, getInspectionSheetOverviewAction,
} from '@/app/(dashboard)/inspections/sheet-actions'
import { sheetShownWhenInstalledOnly, facilitiesForSheet } from '@/lib/sheet-facility-map'
import { ALL_STANDARD_CODES } from '@/lib/facility-codes'
import type { SheetOverview, SheetProgress } from '@/lib/sheet-overview'

/** 점검표 입력 전용 화면 (소방계획서_28) — 좌 설비 목록 / 우 항목 입력.
 *
 *  설계 의도: **어느 설비가 비었는지 한 화면에서 보인다.** 별지 결과칸 공란의 원인은
 *  거의 항상 '그 시트에 응답 0건'인데, 종전 화면들은 그걸 말해주지 않았다.
 *  좌 목록은 `overview.sheets` **원본 순서 그대로** 그린다 — 미입력을 위로 끌어올리지 않는다.
 *  목록 순서가 흔들리면 찾기 어렵다(sheet-overview.ts:248 규약). 대신 [미입력만 보기]로 거른다.
 *
 *  저장은 `useSheetAutosave` 한 곳 — 이 화면과 점검 상세 드로어가 같은 규칙을 쓴다.
 *
 *  동시 편집 보호도 드로어(inspection-sheet-client)와 **같은 규약·같은 훅**이다
 *  (`useSheetResponsesRealtime` + 훅 계약 ③ pause/resume). 정책만 화면이 갖는다:
 *   · 편집 중(dirty·hasPending) 원격 변경 → 배너 + 자동저장 pause. 내 디바운스가 남의 값을 덮지 않는다.
 *   · 편집 중이 아니면 배너 없이 좌 목록 + **열린 시트**를 조용히 최신으로 되돌린다.
 *     열린 시트를 빼먹으면 낡은 baseline이 남아, 다음 토글이 clearCodes로 **남이 방금 넣은 행을 지운다**.
 */

const numCls = (r: number, t: number) =>
  t === 0 ? 'text-ink-faint' : r === 0 ? 'text-amber-600 font-semibold' : r < t ? 'text-ink-sub' : 'text-green-600 font-medium'

export function SheetEntryClient({
  inspectionId, customerName, roundLabel, overview,
  canEdit, initialSheetId, initialGroupCode, initialMonth, backHref, loadError,
}: {
  inspectionId: string
  customerName: string
  roundLabel: string
  overview: SheetOverview
  canEdit: boolean
  initialSheetId: string | null
  initialGroupCode: string | null
  initialMonth: number | null
  /** ?from= 복귀 경로(page.tsx가 검증) — 없으면 점검 상세. 진입점이 여럿이라 고정 목적지는 틀린다 */
  backHref: string | null
  loadError: string | null
}) {
  const [ov, setOv] = useState<SheetOverview>(overview)
  const [openId, setOpenId] = useState<string | null>(initialSheetId)
  const [loading, setLoading] = useState(false)
  const [busy, startBusy] = useTransition()
  const [err, setErr] = useState(loadError ?? '')
  const [notice, setNotice] = useState('')
  const [blankOnly, setBlankOnly] = useState(false)
  const [stale, setStale] = useState(false)   // 편집 중 원격 저장 감지 배너 (16 S5-5와 같은 규약)
  const [installedOnly, setInstalledOnly] = useState(!overview.noFacilityInfo)
  // 외관(자체점검이 아닌 건)만 월 축 — 없으면 month=0으로만 써서 다른 달 실적으로 오귀속된다(EX-4)
  const isExterior = !ov.scope.isSpecial
  const [month, setMonth] = useState(initialMonth ?? new Date().getMonth() + 1)
  const scrollBoxRef = useRef<HTMLDivElement>(null)

  const openSheet = useMemo(() => ov.sheets.find(s => s.sheetId === openId) ?? null, [ov.sheets, openId])
  const openIdRef = useRef(openId)
  const monthRef = useRef(month)
  useEffect(() => { openIdRef.current = openId; monthRef.current = month })
  /** 로드 경합 방지 — 사용자의 시트 클릭과 원격 갱신 재로드가 겹치면 마지막 요청만 반영한다 */
  const loadSeq = useRef(0)
  /** 내 저장 직후의 Realtime 에코 판정용 — DELETE는 old에 PK만 실려 updated_by 자기 식별이 불가능하다 */
  const lastSaveAtRef = useRef(0)

  /** 저장 직후 좌 목록을 서버 재조회 없이 옮긴다 — 열린 시트만 draft로 다시 세고 합계를 그만큼 이동.
   *  시트 간 중복 코드 dedup까지는 반영 못 하는 근사치라, 시트를 바꾸거나 [갱신]하면 서버 값으로 수렴한다. */
  const patchLocal = useCallback((draft: Record<string, 'O' | 'X' | 'N'>, items: Array<{ item_code: string }>) => {
    const sheetId = openIdRef.current
    if (!sheetId) return
    setOv(prev => {
      const before = prev.sheets.find(s => s.sheetId === sheetId)
      if (!before) return prev
      const counted = items.filter(i => draft[i.item_code])
      const counts = {
        O: counted.filter(i => draft[i.item_code] === 'O').length,
        X: counted.filter(i => draft[i.item_code] === 'X').length,
        N: counted.filter(i => draft[i.item_code] === 'N').length,
      }
      return {
        ...prev,
        sheets: prev.sheets.map(s => s.sheetId === sheetId ? { ...s, responded: counted.length, counts } : s),
        totals: {
          ...prev.totals,
          responded: prev.totals.responded + (counted.length - before.responded),
          x: prev.totals.x + (counts.X - before.counts.X),
        },
      }
    })
  }, [])

  const autosave = useSheetAutosave<SheetItem>({
    inspectionId,
    month: isExterior ? month : 0,
    onSaved: () => {
      lastSaveAtRef.current = Date.now()
      patchLocal(autosaveRef.current.draft, autosaveRef.current.items)
    },
  })
  // onSaved가 최신 draft/items를 봐야 한다 — 훅 반환값을 ref로 미러(클로저 고정 방지)
  const autosaveRef = useRef(autosave)
  useEffect(() => { autosaveRef.current = autosave })

  const refreshOverview = useCallback(() => {
    startBusy(async () => {
      const fresh = await getInspectionSheetOverviewAction([inspectionId])
      if (fresh.overviews?.[inspectionId]) setOv(fresh.overviews[inspectionId])
    })
  }, [inspectionId])

  /** 열린 시트를 서버 스냅샷으로 다시 채운다 — **시트 전환이 아니다**(flush·URL 동기화 없음).
   *  [최신 불러오기]와 '편집 중이 아닐 때의 조용한 갱신'이 이 한 곳을 공유한다. */
  const reloadOpenSheet = useCallback(async () => {
    const sheetId = openIdRef.current
    if (!sheetId) return
    const seq = ++loadSeq.current
    setLoading(true)
    const res = await loadSheetSnapshotAction(inspectionId, sheetId, isExterior ? monthRef.current : 0)
    if (seq !== loadSeq.current) return   // 그 사이 사용자가 다른 시트를 열었다 — 옛 응답을 붓지 않는다
    setLoading(false)
    if (res.error) { setErr(res.error); return }
    const responses: Record<string, 'O' | 'X' | 'N'> = {}
    for (const [code, v] of Object.entries(res.responses ?? {})) responses[code] = v.result
    autosaveRef.current.resetSheet(res.items ?? [], responses)
  }, [inspectionId, isExterior])

  // ── 원격 변경 감지 (16 S5) — 훅은 드로어와 공유하고, 덮어쓰기 정책만 이 화면이 갖는다 ──
  useSheetResponsesRealtime([inspectionId], () => {
    // dirty 배너가 항상 우선 — 에코 창이 원격 변경 감지를 삼키면 안 된다(S5-5·P14).
    // 자동저장이라 dirty 구간이 짧다 → 디바운스 대기·실행 중(hasPending)도 '편집 중'으로 본다
    if (openIdRef.current && (autosaveRef.current.dirty || autosaveRef.current.hasPending())) { setStale(true); return }
    if (Date.now() - lastSaveAtRef.current < 2000) return   // 내 저장 에코 — 갱신만 건너뜀
    setStale(false)
    refreshOverview()
    // 좌 목록만 갱신하면 열린 시트의 baseline이 낡은 채 남는다 — 그 상태로 항목을 토글하면
    // 해제가 clearCodes로 나가 **남이 방금 넣은 행을 지운다**. 편집 중이 아니므로 조용히 되돌린다.
    void reloadOpenSheet()
  })
  // ⚠ 훅 계약 ③ — 원격 변경이 미해소인 동안 자동저장 정지. 내 디바운스가 남의 최신 값을 덮지 않게
  useEffect(() => {
    if (stale) autosaveRef.current.pause()
    else autosaveRef.current.resume()
  }, [stale])

  /** [최신 불러오기] — 열린 시트·좌 목록을 서버 값으로 되돌린 **뒤에** 재개한다.
   *  순서가 뒤집히면 resume()이 큐에 남은 옛 입력을 먼저 흘려보내 남의 최신 값을 덮는다
   *  (resume은 queued가 있으면 즉시 run한다 — use-debounced-autosave.ts:75).
   *
   *  ⚠ 이 버튼은 **미저장 입력을 서버 값으로 대체**한다. 종전에는 그 사실을 title 속성으로만
   *  적어 두고 **말없이 실행**했다 — 원격 변경 배너가 떠서 자동저장이 pause된 상태(그때가 바로
   *  이 버튼을 누르는 상황이다)에서는 내가 방금 찍은 ○·✕가 아직 서버에 안 갔을 수 있고,
   *  그게 되돌아가면 사용자는 **자기 입력이 사라진 줄도 모른다**. 되돌릴 수 없는 삭제는 물어본다.
   *  미저장이 없을 때는 묻지 않는다 — 잃을 것이 없는데 묻는 확인창은 사람을 무감각하게 만든다. */
  function loadLatest() {
    // 디바운스 대기·실행 중(hasPending)도 '미저장'이다 — 자동저장이라 dirty 구간이 짧아서
    // dirty만 보면 "타이머가 아직 안 터진 입력"을 놓친다(원격 감지 :138과 같은 판정)
    const a = autosaveRef.current
    if (a.dirty || a.hasPending()) {
      if (!window.confirm('저장되지 않은 입력이 있습니다.\n서버 값으로 되돌리면 그 입력은 사라집니다. 계속할까요?')) return
    }
    void (async () => {
      await reloadOpenSheet()
      const fresh = await getInspectionSheetOverviewAction([inspectionId])
      if (fresh.overviews?.[inspectionId]) setOv(fresh.overviews[inspectionId])
      setStale(false)
    })()
  }

  /** 시트 열기 — 월 전환·시트 전환 전에 반드시 flush. 안 그러면 옛 시트/옛 달로 저장이 끝나지 않는다. */
  const openRow = useCallback(async (sheetId: string, m?: number) => {
    await autosaveRef.current.flush()
    setErr(''); setNotice(''); setStale(false)
    setOpenId(sheetId); openIdRef.current = sheetId
    const seq = ++loadSeq.current
    setLoading(true)
    const res = await loadSheetSnapshotAction(inspectionId, sheetId, isExterior ? (m ?? month) : 0)
    if (seq !== loadSeq.current) return
    setLoading(false)
    if (res.error) { setErr(res.error); return }
    const responses: Record<string, 'O' | 'X' | 'N'> = {}
    for (const [code, v] of Object.entries(res.responses ?? {})) responses[code] = v.result
    autosaveRef.current.resetSheet(res.items ?? [], responses)
    // URL 동기화는 replaceState — router.push는 클릭마다 RSC 왕복이 돈다.
    // sheet·facility·month만 만진다 — ?from= 복귀 경로는 시트를 갈아타도 살아남아야 한다
    const code = ov.sheets.find(s => s.sheetId === sheetId)?.sheetCode
    if (code) {
      const u = new URL(window.location.href)
      u.searchParams.set('sheet', code); u.searchParams.delete('facility')
      if (isExterior) u.searchParams.set('month', String(m ?? month))
      window.history.replaceState(null, '', u.toString())
    }
  }, [inspectionId, isExterior, month, ov.sheets])

  // 딥링크로 들어온 시트를 최초 1회 연다
  const bootedRef = useRef(false)
  useEffect(() => {
    if (bootedRef.current || !initialSheetId) return
    bootedRef.current = true
    void openRow(initialSheetId)
  }, [initialSheetId, openRow])

  /** 🔴 월 전환은 flush가 옛 달로 끝난 뒤에 — 뒤집히면 3월에 찍은 입력이 7월 행으로 저장된다 */
  async function changeMonth(next: number) {
    await autosaveRef.current.flush()
    setMonth(next)
    if (openIdRef.current) await openRow(openIdRef.current, next)
  }

  function registerX(itemCode: string, memo: string) {
    setErr(''); setNotice('')
    startBusy(async () => {
      // 🔴 반드시 flush가 먼저다. ✕ 자체는 훅이 예약하지 않지만(계약 ①), **이미 예약된 다른 입력의
      //    delta에 그 ✕가 함께 실린다.** 그 저장이 [등록] 뒤에 도착하면 memo가 null인 X로 덮어써
      //    방금 적은 불량 메모가 사라진다(드로어에서 실측된 결함 — P11 {"result":"X","memo":null}).
      await autosaveRef.current.flush()
      const res = await saveSheetResponsesAction(inspectionId, [{ item_code: itemCode, result: 'X', memo }], isExterior ? month : 0)
      if (res.error) { setErr(res.error); return }
      lastSaveAtRef.current = Date.now()
      // 등록분을 기준값으로 승격 — 안 하면 dirty가 남아 다음 저장이 이 X를 memo 없이 재전송한다
      // (승격을 빼면 원격 감지(stale)가 **내 쓰기**에 반응해 배너가 뜬다)
      autosaveRef.current.setBaseline(prev => ({ ...prev, [itemCode]: 'X' }))
      const reg = await createDefectsFromXAction(inspectionId)
      setNotice(`✅ ${itemCode} 불량(✕) 저장${reg.added ? ` + 불량내역 ${reg.added}건 자동 등록` : ''}`)
      if (openIdRef.current) void openRow(openIdRef.current)
      refreshOverview()
    })
  }

  function bulkGood() {
    if (!window.confirm('설치된 설비의 모든 미입력 항목을 ○(정상)으로 채웁니다.\n이미 입력한 항목(○/✕/／)은 그대로 유지됩니다. 진행할까요?')) return
    setErr(''); setNotice('')
    startBusy(async () => {
      const res = await bulkAllGoodAction(inspectionId)
      if (res.error) { setErr(res.error); return }
      lastSaveAtRef.current = Date.now()
      setNotice(`✅ 설비 시트 ${res.sheetCount}개 · ${res.filled}개 항목을 ○로 채웠습니다${(res.kept ?? 0) > 0 ? ` (기존 입력 ${res.kept}건 유지)` : ''}`)
      if (openIdRef.current) void openRow(openIdRef.current)
      refreshOverview()
    })
  }

  /** 지난 회차 복사 — 안전장치는 서버(미입력만·불량 자동등록 없음)와 여기(고지·검토 유도) 양쪽 */
  function copyPrevious() {
    if (!window.confirm(
      '지난 완료 회차의 점검표 결과를 이번 회차의 미입력 항목에만 채웁니다.\n\n'
      + '· 이미 입력한 항목은 그대로 유지됩니다.\n'
      + '· 불량(✕)은 값만 복사되고 불량내역에는 자동 등록되지 않습니다.\n\n'
      + '⚠ 실제 점검을 대체할 수 없습니다 — 불러온 뒤 현장 확인 결과로 반드시 수정하세요.\n\n진행할까요?'
    )) return
    setErr(''); setNotice('')
    startBusy(async () => {
      const res = await copyPreviousRoundResponsesAction(inspectionId)
      if (res.error) { setErr(res.error); return }
      lastSaveAtRef.current = Date.now()
      const fresh = await getInspectionSheetOverviewAction([inspectionId])
      const next = fresh.overviews?.[inspectionId] ?? null
      if (next) setOv(next)
      // 검토 유도 — 복사만 하고 덮어두면 확인 없이 그대로 생성될 수 있다. 불량이 실린 시트를 먼저 연다.
      const target = next?.sheets.find(s => s.counts.X > 0) ?? next?.sheets.find(s => s.responded > 0)
      if (target) void openRow(target.sheetId)
      setNotice(
        `✅ ${res.sourceLabel}에서 ${res.filled}개 항목을 불러왔습니다`
        + `${res.skipped ? ` (이번 회차 입력 ${res.skipped}건은 유지)` : ''}`
        + `${res.copiedX ? ` · 불량 ${res.copiedX}건은 값만 복사됨 — 확인 후 [등록] 필요` : ''}`
        + `${target ? ` — 검토하도록 '${target.sheetName}'를 열었습니다.` : ''}`
      )
    })
  }

  // ── 좌 목록 ──
  const visible = useMemo(() => {
    let list = ov.sheets
    if (installedOnly && !ov.noFacilityInfo) list = list.filter(sheetShownWhenInstalledOnly)
    if (blankOnly) list = list.filter(s => s.responded === 0)
    return list
  }, [ov.sheets, ov.noFacilityInfo, installedOnly, blankOnly])

  const blankCount = ov.sheets.filter(s => s.installed && s.responded === 0).length
  const uncovered = ov.uncoveredFacilityCodes ?? []

  // 형제 설비 고지 — 한 시트가 여러 설비를 덮는다는 사실을 숨기지 않는다(1.4에서 이관)
  const siblings = useMemo(() => {
    if (!openSheet) return [] as Array<{ name: string; installed: boolean }>
    const all = facilitiesForSheet(openSheet.sheetName, ALL_STANDARD_CODES)
    if (all.length <= 1) return []
    const inst = new Set(ov.installedFacilityCodes ?? [])
    return all.map(name => ({ name, installed: inst.has(name) }))
  }, [openSheet, ov.installedFacilityCodes])

  const saveChip = (() => {
    switch (autosave.status) {
      case 'saving': return <span className="text-[11px] text-brand flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> 저장 중</span>
      case 'saved': return <span className="text-[11px] text-green-600" data-testid="sheet-autosave">✓ 저장됨</span>
      case 'error': return <button onClick={() => void autosave.retry()} className="text-[11px] text-red-600 underline">저장 실패 — 다시 시도</button>
      case 'paused': return <span className="text-[11px] text-amber-600">저장 보류 — 원격 변경 확인 필요</span>
      default: return <span className="text-[11px] text-ink-faint" data-testid="sheet-autosave-idle">자동 저장</span>
    }
  })()

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Link href={backHref ?? `/inspections/${inspectionId}`} data-testid="sheet-entry-back"
          className="p-1.5 rounded-lg hover:bg-paper text-ink-sub" aria-label={backHref ? '이전 화면으로' : '점검 상세로'}>
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink truncate">점검표 입력 — {customerName}</h1>
          <p className="text-xs text-ink-sub">{roundLabel} · 전체 {ov.totals.responded}/{ov.totals.total}
            {blankCount > 0 && <span className="text-amber-600 font-medium"> · ⚠ 설치 설비 중 미입력 {blankCount}개</span>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2" data-testid="sheet-entry-autosave" data-status={autosave.status}>{saveChip}</div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button onClick={bulkGood} disabled={busy} className="h-8 px-3 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper disabled:opacity-50">설치 설비 전체 양호 ○</button>
          <button onClick={copyPrevious} disabled={busy} className="h-8 px-3 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper disabled:opacity-50">지난 회차 결과 불러오기</button>
          {isExterior && (
            <label className="text-xs text-ink-sub flex items-center gap-1.5 ml-1">점검 월
              <select value={month} onChange={e => void changeMonth(Number(e.target.value))} disabled={busy}
                className="h-8 px-2 rounded-lg border border-line text-xs" data-testid="sheet-entry-month">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
              </select>
            </label>
          )}
          <button onClick={refreshOverview} disabled={busy} className="h-8 px-2.5 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper disabled:opacity-50 flex items-center gap-1">
            <RefreshCw className="size-3" /> 갱신
          </button>
        </div>
      )}
      {!canEdit && <p className="text-xs text-ink-faint mb-3">보기 전용 — 이 점검 건의 담당자·팀장·관리자만 입력할 수 있습니다.</p>}
      {/* 편집 중 원격 저장 감지 — 자동 덮어쓰기 금지, 선택은 사용자가 한다(드로어와 같은 문구·같은 규약).
          이 동안 자동저장은 pause다(훅 계약 ③) — 아래 칩이 '저장 보류'로 바뀐다 */}
      {stale && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2" data-testid="sheet-entry-stale">
          <span className="text-xs text-amber-700 flex-1">
            다른 곳에서 이 점검표가 저장되었습니다 — 입력 중이라 자동 갱신·자동 저장을 멈췄습니다.
          </span>
          <button onClick={loadLatest} data-testid="sheet-entry-load-latest"
            title="열린 시트를 서버 값으로 다시 불러옵니다 — 아직 저장되지 않은 입력은 서버 값으로 대체됩니다"
            className="text-xs text-brand font-medium hover:underline shrink-0">
            최신 불러오기
          </button>
        </div>
      )}
      {notice && <p className="text-xs text-green-600 mb-2">{notice}</p>}
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-4">
        {/* ── 좌: 설비 목록 ── */}
        <div className="rounded-xl border border-brand-line-soft bg-surface p-3">
          <div className="flex items-center gap-3 mb-2 text-[11px]">
            <label className="flex items-center gap-1 text-ink-sub">
              <input type="checkbox" checked={installedOnly} onChange={e => setInstalledOnly(e.target.checked)} disabled={ov.noFacilityInfo} />
              설치 설비만
            </label>
            <label className="flex items-center gap-1 text-ink-sub">
              <input type="checkbox" checked={blankOnly} onChange={e => setBlankOnly(e.target.checked)} data-testid="sheet-entry-blank-only" />
              미입력만
            </label>
          </div>
          <ul className="space-y-0.5 max-h-[calc(100dvh-260px)] overflow-y-auto">
            {visible.map(s => (
              <li key={s.sheetId}>
                <button onClick={() => void openRow(s.sheetId)}
                  data-testid={`sheet-row-${s.sheetCode}`}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center gap-2 ${
                    openId === s.sheetId ? 'bg-[#efeaff] text-[#3f2fae] dark:bg-brand-tint dark:text-brand'
                      : s.installed && s.responded === 0 ? 'bg-amber-50 hover:bg-amber-100'
                        : 'hover:bg-paper'}`}>
                  <span className="flex-1 truncate">{s.sheetName}</span>
                  {s.counts.X > 0 && <span className="text-red-600">✕{s.counts.X}</span>}
                  <span className={numCls(s.responded, s.total)}>{s.responded}/{s.total}</span>
                  {s.installed && s.responded === 0 && <span className="text-amber-600">⚠</span>}
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="text-xs text-ink-faint px-2 py-3">조건에 맞는 설비가 없습니다.</li>}
          </ul>

          {uncovered.length > 0 && (
            <div className="mt-3 pt-3 border-t border-brand-line-soft">
              <p className="text-[11px] text-ink-faint mb-1">덮는 점검표 없음 — 별지 결과칸은 공란으로 남습니다</p>
              <ul className="space-y-0.5">
                {uncovered.map(c => <li key={c} className="text-[11px] text-ink-faint px-2.5 py-1">{c}</li>)}
              </ul>
            </div>
          )}
        </div>

        {/* ── 우: 항목 입력 ── */}
        <div className="rounded-xl border border-brand-line-soft bg-surface p-4 min-h-[320px]">
          {!openSheet ? (
            <p className="text-sm text-ink-faint">왼쪽에서 설비를 선택하세요.
              {blankCount > 0 && <> 미입력 {blankCount}개가 <span className="text-amber-600">⚠</span>로 표시돼 있습니다.</>}
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2 mb-1">
                <h2 className="text-sm font-semibold text-ink">{openSheet.sheetName}</h2>
                <span className={`text-xs ${numCls(openSheet.responded, openSheet.total)}`}>{openSheet.responded}/{openSheet.total}</span>
              </div>
              {siblings.length > 0 && (
                <p className="text-[11px] text-ink-sub mb-2">
                  이 점검표는 {siblings.map(s => `${s.installed ? '☑' : '☐'}${s.name}`).join(' · ')}의 결과에 함께 반영됩니다.
                </p>
              )}
              {/* ⚠ 이 div의 ref는 실효가 없다 — 아래 SheetItemEditor에도 같은 ref를 넘기는데
                  React가 자식 ref를 먼저 붙이므로 최종 current는 **안쪽 스크롤 박스**가 아니라
                  이 바깥 div가 된다. 이 화면엔 SheetGroupToc(점프·스파이 소비자)이 없어 지금은
                  무증상이지만, 목차를 붙이는 순간 점프가 죽는다. 소방계획서_38 OS-1(범위 밖). */}
              <div ref={scrollBoxRef}>
                <SheetItemEditor
                  items={autosave.items}
                  loading={loading}
                  value={autosave.draft}
                  onResult={autosave.setResult}
                  onRegisterX={registerX}
                  canEdit={canEdit}
                  busy={busy}
                  grouping="outline"
                  scrollBoxRef={scrollBoxRef}
                  // ⚠ 드로어와 달리 여기는 매직넘버를 유지한다(소방계획서_38 S4-2·D-7).
                  // 조상이 grid item(:360 lg:grid-cols-[…] → :403 일반 div)이라 flex 사슬이
                  // 없다 — flex-1이 무시되고 min-h-0만 남아 박스가 무한히 자라고 master-detail의
                  // '좌 목록 상시 노출'이 깨진다. 360px도 여전히 옳다: 박스 위 크롬(제목·카운트·
                  // siblings)은 이 파일의 클래스라 배율 토큰화 대상이 아니어서 높이가 안 변한다.
                  maxHeight="max-h-[calc(100dvh-360px)]"
                  hideSave
                  hideCancel
                  showFooterHint={false}
                  onSave={() => {}}
                  onCancel={() => {}}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
