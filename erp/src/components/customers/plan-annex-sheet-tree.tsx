'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ClipboardList, Loader2, RefreshCw } from 'lucide-react'
import {
  getInspectionSheetOverviewAction, loadSheetEditorAction,
  saveSheetResponsesAction, createDefectsFromXAction,
} from '@/app/(dashboard)/inspections/sheet-actions'
import type { SheetOverview, SheetProgress } from '@/lib/sheet-overview'
import { SheetItemEditor, type SheetItem, type SheetResult } from '@/components/inspections/sheet-item-editor'

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

  const editable = canRegister && !!ov?.canEdit

  function openSheetRow(p: SheetProgress) {
    if (openSheet === p.sheetId) { setOpenSheet(null); setItems([]); return }
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

  function save() {
    const rows = items.filter(i => draft[i.item_code]).map(i => ({ item_code: i.item_code, result: draft[i.item_code] }))
    if (rows.length === 0) { setEditErr('입력한 항목이 없습니다.'); return }
    setEditErr(''); setNotice('')
    startBusy(async () => {
      const res = await saveSheetResponsesAction(inspectionId, rows)
      if (res.error) { setEditErr(res.error); return }
      setBaseline({ ...draft })
      setNotice(`✅ ${rows.length}개 항목 저장됨`)
      // 편집기를 닫지 않는다 — 현장에서 이어 입력하는 흐름을 끊지 않기 위해 요약만 갱신
      const fresh = await getInspectionSheetOverviewAction([inspectionId])
      const next = fresh.overviews?.[inspectionId] ?? null
      if (next) { setOv(next); onSaved?.(next.totals.responded, 0) }
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
        <button onClick={load} disabled={isLoading} className="ml-auto text-[10px] text-[#b0acd6] hover:text-[#7b68ee] inline-flex items-center gap-0.5 disabled:opacity-50">
          <RefreshCw className={`size-2.5 ${isLoading ? 'animate-spin' : ''}`} /> 갱신
        </button>
      </div>

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
                    onResult={(code, r) => setDraft(s => ({ ...s, [code]: r }))}
                    onRegisterX={registerX}
                    canEdit={editable} busy={isBusy} error={editErr} notice={notice}
                    onSave={save}
                    onCancel={() => { setOpenSheet(null); setItems([]); setDraft(baseline) }}
                    maxHeight="max-h-[340px]" showFooterHint={false} saveLabel="이 설비 저장" />
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
