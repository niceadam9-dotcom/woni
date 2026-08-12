'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, Check, Loader2, CircleCheck, AlertTriangle, Zap, Search } from 'lucide-react'
import {
  loadSheetItemsAction, saveSheetResponsesAction, createDefectsFromXAction,
  bulkAllGoodAction, searchQuickItemsAction, loadExteriorMonthResponsesAction,
} from '@/app/(dashboard)/inspections/sheet-actions'
import { sheetScope, isItemInScope, scopeLabel } from '@/lib/sheet-scope'
import { useExteriorMonth } from '@/components/inspections/exterior-month'
import { SheetItemEditor, type SheetItem as Item, type SheetResult as Result } from '@/components/inspections/sheet-item-editor'
import type { SheetProgress } from '@/lib/sheet-overview'
import { useSheetResponsesRealtime } from '@/hooks/use-sheet-responses-realtime'

type Sheet = { id: string; sheet_code: string; sheet_name: string }

/** 점검표 입력 (P34-2) — 설비 선택 → 항목별 ○/X/／. 작동점검이면 종합전용(●) 항목 숨김.
 *  점검 종류 판정은 plan_type 축(소방계획서_6 W-20) — 외관 렌더는 레거시 event·정기 건 전용.
 *  항목 입력부는 회차별 작성·조회 트리와 공용(sheet-item-editor.tsx) — 이중 구현 금지 */
export function InspectionSheetClient({ inspectionId, inspectionType, planType, sheets, responses, progress, xCount, canManage }: {
  inspectionId: string
  inspectionType: string
  planType: string | null   // special_종합·special_작동·null=자체점검 / monthly·event=외관
  sheets: Sheet[]
  responses: Record<string, { result: Result; memo: string | null }>
  /** 시트별 진행률 — sheet-overview.ts 집계(sheet_id 조인). 종전 item_code 접두 파싱을 대체 */
  progress: Record<string, SheetProgress>
  xCount: number
  canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [sel, setSel] = useState<Sheet | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [local, setLocal] = useState<Record<string, Result>>({})
  const [base, setBase] = useState<Record<string, Result>>({})   // 편집 기준값 — dirty 판정용 (S5-5)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [stale, setStale] = useState(false)   // S5-5: 편집 중 원격 저장 감지 배너
  // §9-4 A안: 빠른 결과 입력 — 전체 양호 + 불량 검색 태깅
  const [quickQ, setQuickQ] = useState('')
  const [quickResults, setQuickResults] = useState<Array<{ item_code: string; item_name: string; sheet_name: string; current: Result | null }>>([])
  const [picked, setPicked] = useState<{ item_code: string; item_name: string; sheet_name: string } | null>(null)
  const [quickMemo, setQuickMemo] = useState('')
  const quickDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (quickDebounce.current) clearTimeout(quickDebounce.current)
    quickDebounce.current = setTimeout(() => {
      if (quickQ.trim().length < 2) { setQuickResults([]); return }
      searchQuickItemsAction(inspectionId, quickQ).then(r => setQuickResults(r.items ?? [])).catch(() => setQuickResults([]))
    }, 300)
    return () => { if (quickDebounce.current) clearTimeout(quickDebounce.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickQ])

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
      // EX-4: 화면에서 고른 달로 저장 — 같은 화면의 [저장]과 축이 어긋나면 안 된다(독립 검증 지적)
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

  // R13-d: 시트 X 항목 그 자리에서 즉시 등록 (X 저장 + 불량내역 자동 등록).
  // 메모는 편집기가 소유하므로 인자로 받는다 (sheet-item-editor.tsx)
  function registerInlineX(itemCode: string, memo: string) {
    setError(''); setNotice('')
    startTransition(async () => {
      // EX-4: 인라인 X도 화면에서 고른 달로 — EX-1 비고칸 메모는 사실상 이 경로로만 생기므로,
      // 여기가 month=0이면 연간본에서 메모가 전부 시작월로 몰린다(독립 검증 실증)
      const res = await saveSheetResponsesAction(inspectionId, [{ item_code: itemCode, result: 'X', memo }], isExterior ? month : 0)
      if (res.error) { setError(res.error); return }
      const reg = await createDefectsFromXAction(inspectionId)
      setNotice(`✅ ${itemCode} 불량(✕) 저장${reg.added ? ` + 불량내역 ${reg.added}건 자동 등록` : ''}`)
      router.refresh()
    })
  }

  // 자체점검 여부·종류 = plan_type 우선 (일반관리 자체점검 대응 — W-20). null 레거시는 inspection_type 폴백
  const scope = sheetScope(planType, inspectionType)
  // EX-4(소방계획서_19, 125): 외관점검표는 12개월 연간 서식 — 한 점검 건에 달을 나눠 기록한다.
  // 0 = 점검일 기준(기본·레거시 저장분), 1~12 = 그 달의 실적. 외관 건에서만 선택기를 띄운다.
  // 월은 provider가 단일 원천 — 같은 페이지의 음성 입력 카드도 같은 달에 저장해야 한다(독립 검증 2회차).
  const isExterior = planType === 'monthly' || planType === 'event'
  const { month, setMonth } = useExteriorMonth()

  // ── Realtime (S5) — 트리(회차별 작성·조회)와 같은 훅. 편집 중이면 배너, 아니면 RSC 갱신 ──
  const selRef = useRef<Sheet | null>(null)
  selRef.current = sel
  const dirtyRef = useRef(false)
  dirtyRef.current = (() => {
    for (const k of new Set([...Object.keys(local), ...Object.keys(base)]))
      if (local[k] !== base[k]) return true
    return false
  })()
  const reinitRef = useRef(false)   // [최신 불러오기] — dirty여도 1회 강제 재초기화
  useSheetResponsesRealtime([inspectionId], () => {
    if (selRef.current && dirtyRef.current) { setStale(true); return }
    setStale(false)
    router.refresh()
  })
  // router.refresh()로 responses prop이 새로 오면, 편집 중이 아닐 때만 열린 편집기 값을 재초기화
  useEffect(() => {
    if (!selRef.current) return
    if (dirtyRef.current && !reinitRef.current) return
    reinitRef.current = false
    const init: Record<string, Result> = {}
    for (const it of items) { const r = responses[it.item_code]; if (r) init[it.item_code] = r.result }
    setLocal(init); setBase(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responses])

  function open(sheet: Sheet, forMonth = month) {
    setError(''); setSel(sheet)
    startTransition(async () => {
      const { items: all } = await loadSheetItemsAction(sheet.id)
      const visible = all.filter(i => isItemInScope(i, scope))
      setItems(visible)
      // EX-4: 외관은 월별로 응답이 갈리므로 그 달치만 가져온다(일반 점검표는 종전대로 prop 사용)
      const src = isExterior
        ? (await loadExteriorMonthResponsesAction(inspectionId, forMonth)).responses
        : responses
      const init: Record<string, Result> = {}
      for (const it of visible) { const r = src[it.item_code]; if (r) init[it.item_code] = r.result }
      setLocal(init); setBase(init)
    })
  }
  /** EX-4: 월 전환 — 저장 안 한 편집이 있으면 확인 후 그 달 값으로 다시 채운다 */
  function changeMonth(next: number) {
    if (dirtyRef.current && !window.confirm('저장하지 않은 입력이 있습니다. 다른 달로 바꾸면 사라집니다. 계속할까요?')) return
    setMonth(next)
    if (sel) open(sel, next)
  }
  function setAll(result: Result) { setLocal(Object.fromEntries(items.map(i => [i.item_code, result]))) }
  function closeEditor() {
    setSel(null); setItems([])
    // 편집 중 미뤄둔 원격 변경이 있으면 목록으로 나가면서 반영
    if (stale) { setStale(false); router.refresh() }
  }
  function save() {
    setError('')
    const rows = items.filter(i => local[i.item_code]).map(i => ({ item_code: i.item_code, result: local[i.item_code] }))
    startTransition(async () => {
      // EX-4: 외관은 선택한 달에 저장(0=점검일 기준) — 일반 점검표는 month 인자 없이 종전 동작
      const res = await saveSheetResponsesAction(inspectionId, rows, isExterior ? month : 0)
      if (res.error) { setError(res.error); return }
      setSel(null); setItems([]); setStale(false); router.refresh()
    })
  }

  // 그룹핑
  const groups = items.reduce<Record<string, Item[]>>((acc, i) => { (acc[i.group] ??= []).push(i); return acc }, {})

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardCheck className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">점검표 입력</h2>
        <span className="text-xs text-[#b0acd6] ml-auto">{scopeLabel(scope)}</span>
      </div>

      {/* EX-4(소방계획서_19, 125): 외관점검표는 12개월 연간 서식 — 같은 점검 건에 달을 나눠 기록한다.
          기록한 달은 연간 누적본 한 장에 모두 인쇄된다(표지 12행 + 섹션 표 12열). */}
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

      {!sel && canManage && xCount > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
          <AlertTriangle className="size-3.5 text-red-500 shrink-0" />
          <span className="text-xs text-red-700">불량(X) {xCount}건 — 표준 문구로 불량내역에 등록</span>
          <button onClick={registerDefects} disabled={isPending}
            className="ml-auto h-7 px-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-medium disabled:opacity-50">
            불량 등록
          </button>
        </div>
      )}
      {!sel && notice && <p className="text-xs text-green-600 mb-2">{notice}</p>}
      {!sel && error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {/* §9-4 A안: 빠른 결과 입력 — 대부분 양호·불량 소수 패턴 (모바일 현장 입력 대응) */}
      {!sel && canManage && (
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

      {!sel ? (
        <>
          <p className="text-[11px] text-[#b0acd6] mb-2">설비를 선택해 항목별 ○(정상)/X(불량)/／(해당없음)을 입력합니다.</p>
          <div className="grid grid-cols-2 gap-1.5">
            {sheets.map(s => {
              // 진행률은 sheet_id 조인 집계 — 분모까지 있어 '18/24'로 보여줄 수 있다
              const p = progress[s.id]
              const done = p?.responded ?? 0
              return (
                <button key={s.id} onClick={() => canManage && open(s)} disabled={!canManage || isPending}
                  className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-[#e0ddf5] text-xs text-[#090c1d] hover:bg-[#f5f4ff] hover:border-[#c3bdf5] transition-colors text-left disabled:opacity-60">
                  {done > 0 && <CircleCheck className={`size-3.5 shrink-0 ${p && done >= p.total ? 'text-green-500' : 'text-amber-400'}`} />}
                  <span className="truncate">{s.sheet_name}</span>
                  {done > 0 && (
                    <span className={`ml-auto text-[10px] shrink-0 ${p && done >= p.total ? 'text-green-600' : 'text-amber-600'}`}>
                      {p ? `${done}/${p.total}` : done}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={closeEditor} className="text-xs text-[#7b68ee] hover:underline">← 설비 목록</button>
            <span className="text-sm font-semibold text-[#090c1d]">{sel.sheet_name}</span>
            {canManage && <button onClick={() => setAll('O')} className="ml-auto h-7 px-2.5 rounded-lg bg-[#f5f4ff] text-[#7b68ee] text-xs font-medium hover:bg-[#ebe9ff]">전체 정상 ○</button>}
          </div>
          {/* S5-5: dirty 중 원격 저장 감지 — 자동 덮어쓰기 금지, 사용자가 선택 */}
          {stale && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mb-2">
              <span className="text-xs text-amber-700 flex-1">
                다른 곳에서 이 점검표가 저장되었습니다 — 입력 중이라 자동 갱신을 멈췄습니다.
              </span>
              <button onClick={() => { reinitRef.current = true; setStale(false); router.refresh() }}
                className="text-xs text-[#7b68ee] font-medium hover:underline shrink-0">
                최신 불러오기
              </button>
            </div>
          )}
          <SheetItemEditor
            items={items} loading={isPending} value={local}
            onResult={(code, r) => setLocal(s => ({ ...s, [code]: r }))}
            onRegisterX={registerInlineX}
            canEdit={canManage} busy={isPending} error={error} notice={notice}
            onSave={save} onCancel={closeEditor} />
        </div>
      )}
    </div>
  )
}
