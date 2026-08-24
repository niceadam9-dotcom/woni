'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { SheetItemEditor, type SheetItem } from '@/components/inspections/sheet-item-editor'
import { useSheetAutosave } from '@/hooks/use-sheet-autosave'
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
 */

const numCls = (r: number, t: number) =>
  t === 0 ? 'text-[#b0acd6]' : r === 0 ? 'text-amber-600 font-semibold' : r < t ? 'text-[#514b81]' : 'text-green-600 font-medium'

export function SheetEntryClient({
  inspectionId, customerName, roundLabel, overview,
  canEdit, initialSheetId, initialGroupCode, initialMonth, loadError,
}: {
  inspectionId: string
  customerName: string
  roundLabel: string
  overview: SheetOverview
  canEdit: boolean
  initialSheetId: string | null
  initialGroupCode: string | null
  initialMonth: number | null
  loadError: string | null
}) {
  const [ov, setOv] = useState<SheetOverview>(overview)
  const [openId, setOpenId] = useState<string | null>(initialSheetId)
  const [loading, setLoading] = useState(false)
  const [busy, startBusy] = useTransition()
  const [err, setErr] = useState(loadError ?? '')
  const [notice, setNotice] = useState('')
  const [blankOnly, setBlankOnly] = useState(false)
  const [installedOnly, setInstalledOnly] = useState(!overview.noFacilityInfo)
  // 외관(자체점검이 아닌 건)만 월 축 — 없으면 month=0으로만 써서 다른 달 실적으로 오귀속된다(EX-4)
  const isExterior = !ov.scope.isSpecial
  const [month, setMonth] = useState(initialMonth ?? new Date().getMonth() + 1)
  const scrollBoxRef = useRef<HTMLDivElement>(null)

  const openSheet = useMemo(() => ov.sheets.find(s => s.sheetId === openId) ?? null, [ov.sheets, openId])
  const openIdRef = useRef(openId)
  useEffect(() => { openIdRef.current = openId })

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
    onSaved: () => patchLocal(autosaveRef.current.draft, autosaveRef.current.items),
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

  /** 시트 열기 — 월 전환·시트 전환 전에 반드시 flush. 안 그러면 옛 시트/옛 달로 저장이 끝나지 않는다. */
  const openRow = useCallback(async (sheetId: string, m?: number) => {
    await autosaveRef.current.flush()
    setErr(''); setNotice('')
    setOpenId(sheetId); openIdRef.current = sheetId
    setLoading(true)
    const res = await loadSheetSnapshotAction(inspectionId, sheetId, isExterior ? (m ?? month) : 0)
    setLoading(false)
    if (res.error) { setErr(res.error); return }
    const responses: Record<string, 'O' | 'X' | 'N'> = {}
    for (const [code, v] of Object.entries(res.responses ?? {})) responses[code] = v.result
    autosaveRef.current.resetSheet(res.items ?? [], responses)
    // URL 동기화는 replaceState — router.push는 클릭마다 RSC 왕복이 돈다
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
      // 등록분을 기준값으로 승격 — 안 하면 dirty가 남아 다음 저장이 이 X를 memo 없이 재전송한다
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
      case 'saving': return <span className="text-[11px] text-[#7b68ee] flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> 저장 중</span>
      case 'saved': return <span className="text-[11px] text-green-600" data-testid="sheet-autosave">✓ 저장됨</span>
      case 'error': return <button onClick={() => void autosave.retry()} className="text-[11px] text-red-600 underline">저장 실패 — 다시 시도</button>
      case 'paused': return <span className="text-[11px] text-amber-600">저장 보류 — 원격 변경 확인 필요</span>
      default: return <span className="text-[11px] text-[#b0acd6]" data-testid="sheet-autosave-idle">자동 저장</span>
    }
  })()

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/inspections/${inspectionId}`} className="p-1.5 rounded-lg hover:bg-[#f8f9fa] text-[#514b81]" aria-label="점검 상세로">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-[#090c1d] truncate">점검표 입력 — {customerName}</h1>
          <p className="text-xs text-[#514b81]">{roundLabel} · 전체 {ov.totals.responded}/{ov.totals.total}
            {blankCount > 0 && <span className="text-amber-600 font-medium"> · ⚠ 설치 설비 중 미입력 {blankCount}개</span>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">{saveChip}</div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button onClick={bulkGood} disabled={busy} className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] disabled:opacity-50">설치 설비 전체 양호 ○</button>
          <button onClick={copyPrevious} disabled={busy} className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] disabled:opacity-50">지난 회차 결과 불러오기</button>
          {isExterior && (
            <label className="text-xs text-[#514b81] flex items-center gap-1.5 ml-1">점검 월
              <select value={month} onChange={e => void changeMonth(Number(e.target.value))} disabled={busy}
                className="h-8 px-2 rounded-lg border border-[#c8c4d0] text-xs" data-testid="sheet-entry-month">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
              </select>
            </label>
          )}
          <button onClick={refreshOverview} disabled={busy} className="h-8 px-2.5 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] disabled:opacity-50 flex items-center gap-1">
            <RefreshCw className="size-3" /> 갱신
          </button>
        </div>
      )}
      {!canEdit && <p className="text-xs text-[#b0acd6] mb-3">보기 전용 — 이 점검 건의 담당자·팀장·관리자만 입력할 수 있습니다.</p>}
      {notice && <p className="text-xs text-green-600 mb-2">{notice}</p>}
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-4">
        {/* ── 좌: 설비 목록 ── */}
        <div className="rounded-xl border border-[#e8e6f0] bg-white p-3">
          <div className="flex items-center gap-3 mb-2 text-[11px]">
            <label className="flex items-center gap-1 text-[#514b81]">
              <input type="checkbox" checked={installedOnly} onChange={e => setInstalledOnly(e.target.checked)} disabled={ov.noFacilityInfo} />
              설치 설비만
            </label>
            <label className="flex items-center gap-1 text-[#514b81]">
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
                    openId === s.sheetId ? 'bg-[#efeaff] text-[#3f2fae]'
                      : s.installed && s.responded === 0 ? 'bg-amber-50 hover:bg-amber-100'
                        : 'hover:bg-[#f8f9fa]'}`}>
                  <span className="flex-1 truncate">{s.sheetName}</span>
                  {s.counts.X > 0 && <span className="text-red-600">✕{s.counts.X}</span>}
                  <span className={numCls(s.responded, s.total)}>{s.responded}/{s.total}</span>
                  {s.installed && s.responded === 0 && <span className="text-amber-600">⚠</span>}
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="text-xs text-[#b0acd6] px-2 py-3">조건에 맞는 설비가 없습니다.</li>}
          </ul>

          {uncovered.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#e8e6f0]">
              <p className="text-[11px] text-[#b0acd6] mb-1">덮는 점검표 없음 — 별지 결과칸은 공란으로 남습니다</p>
              <ul className="space-y-0.5">
                {uncovered.map(c => <li key={c} className="text-[11px] text-[#b0acd6] px-2.5 py-1">{c}</li>)}
              </ul>
            </div>
          )}
        </div>

        {/* ── 우: 항목 입력 ── */}
        <div className="rounded-xl border border-[#e8e6f0] bg-white p-4 min-h-[320px]">
          {!openSheet ? (
            <p className="text-sm text-[#b0acd6]">왼쪽에서 설비를 선택하세요.
              {blankCount > 0 && <> 미입력 {blankCount}개가 <span className="text-amber-600">⚠</span>로 표시돼 있습니다.</>}
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2 mb-1">
                <h2 className="text-sm font-semibold text-[#090c1d]">{openSheet.sheetName}</h2>
                <span className={`text-xs ${numCls(openSheet.responded, openSheet.total)}`}>{openSheet.responded}/{openSheet.total}</span>
              </div>
              {siblings.length > 0 && (
                <p className="text-[11px] text-[#514b81] mb-2">
                  이 점검표는 {siblings.map(s => `${s.installed ? '☑' : '☐'}${s.name}`).join(' · ')}의 결과에 함께 반영됩니다.
                </p>
              )}
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
