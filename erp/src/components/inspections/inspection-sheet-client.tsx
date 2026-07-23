'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, Check, Loader2, CircleCheck, AlertTriangle, Zap, Search } from 'lucide-react'
import {
  loadSheetItemsAction, saveSheetResponsesAction, createDefectsFromXAction,
  bulkAllGoodAction, searchQuickItemsAction,
} from '@/app/(dashboard)/inspections/sheet-actions'

type Sheet = { id: string; sheet_code: string; sheet_name: string }
type Item = { item_code: string; item_name: string; comprehensive_only: boolean; group: string }
type Result = 'O' | 'X' | 'N'

/** 점검표 입력 (P34-2) — 설비 선택 → 항목별 ○/X/／. 작동점검이면 종합전용(●) 항목 숨김. */
export function InspectionSheetClient({ inspectionId, inspectionType, sheets, responses, respondedCounts, xCount, canManage }: {
  inspectionId: string
  inspectionType: string
  sheets: Sheet[]
  responses: Record<string, { result: Result; memo: string | null }>
  respondedCounts: Record<string, number>  // sheet_code prefix(설비번호) → 응답 수
  xCount: number
  canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [sel, setSel] = useState<Sheet | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [local, setLocal] = useState<Record<string, Result>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // §9-4 A안: 빠른 결과 입력 — 전체 양호 + 불량 검색 태깅
  const [quickQ, setQuickQ] = useState('')
  const [quickResults, setQuickResults] = useState<Array<{ item_code: string; item_name: string; sheet_name: string; current: Result | null }>>([])
  const [picked, setPicked] = useState<{ item_code: string; item_name: string; sheet_name: string } | null>(null)
  const [quickMemo, setQuickMemo] = useState('')
  const quickDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  // R13-d: 시트 X 클릭 시 행 아래 인라인 메모+[등록]
  const [inlineX, setInlineX] = useState<string | null>(null)
  const [inlineMemo, setInlineMemo] = useState('')

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
      const res = await bulkAllGoodAction(inspectionId)
      if (res.error) { setError(res.error); return }
      setNotice(`✅ 설비 시트 ${res.sheetCount}개 · ${res.filled}개 항목을 ○로 채웠습니다${(res.kept ?? 0) > 0 ? ` (기존 입력 ${res.kept}건 유지)` : ''} — 불량은 아래 검색으로 태깅하세요.`)
      router.refresh()
    })
  }

  function saveQuickDefect() {
    if (!picked) return
    setError(''); setNotice('')
    startTransition(async () => {
      const res = await saveSheetResponsesAction(inspectionId, [{ item_code: picked.item_code, result: 'X', memo: quickMemo }])
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
  function registerInlineX(itemCode: string) {
    setError(''); setNotice('')
    startTransition(async () => {
      const res = await saveSheetResponsesAction(inspectionId, [{ item_code: itemCode, result: 'X', memo: inlineMemo }])
      if (res.error) { setError(res.error); return }
      const reg = await createDefectsFromXAction(inspectionId)
      setNotice(`✅ ${itemCode} 불량(✕) 저장${reg.added ? ` + 불량내역 ${reg.added}건 자동 등록` : ''}`)
      setInlineX(null); setInlineMemo(''); router.refresh()
    })
  }

  const isOperational = inspectionType === '작동'

  function open(sheet: Sheet) {
    setError(''); setSel(sheet)
    startTransition(async () => {
      const { items: all } = await loadSheetItemsAction(sheet.id)
      const visible = isOperational ? all.filter(i => !i.comprehensive_only) : all
      setItems(visible)
      const init: Record<string, Result> = {}
      for (const it of visible) { const r = responses[it.item_code]; if (r) init[it.item_code] = r.result }
      setLocal(init)
    })
  }
  function setAll(result: Result) { setLocal(Object.fromEntries(items.map(i => [i.item_code, result]))) }
  function save() {
    setError('')
    const rows = items.filter(i => local[i.item_code]).map(i => ({ item_code: i.item_code, result: local[i.item_code] }))
    startTransition(async () => {
      const res = await saveSheetResponsesAction(inspectionId, rows)
      if (res.error) { setError(res.error); return }
      setSel(null); setItems([]); router.refresh()
    })
  }

  // 그룹핑
  const groups = items.reduce<Record<string, Item[]>>((acc, i) => { (acc[i.group] ??= []).push(i); return acc }, {})

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardCheck className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">점검표 입력</h2>
        <span className="text-xs text-[#b0acd6] ml-auto">
          {inspectionType === '일반관리' ? '외관점검 (별지 6호)' : isOperational ? '작동점검 (○항목)' : '종합점검 (전체)'}
        </span>
      </div>

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
              // 응답수 키: STD-05 → '5' / EXT-05 → 'X5' / MU-01 → 'MU' (item_code 접두와 일치)
              const num = s.sheet_code.startsWith('EXT-')
                ? `X${parseInt(s.sheet_code.slice(4), 10)}`
                : s.sheet_code.startsWith('MU-')
                  ? 'MU'
                  : s.sheet_code.replace('STD-', '').replace(/^0/, '')
              const done = respondedCounts[num] ?? 0
              return (
                <button key={s.id} onClick={() => canManage && open(s)} disabled={!canManage || isPending}
                  className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-[#e0ddf5] text-xs text-[#090c1d] hover:bg-[#f5f4ff] hover:border-[#c3bdf5] transition-colors text-left disabled:opacity-60">
                  {done > 0 && <CircleCheck className="size-3.5 text-green-500 shrink-0" />}
                  <span className="truncate">{s.sheet_name}</span>
                  {done > 0 && <span className="ml-auto text-[10px] text-green-600 shrink-0">{done}</span>}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => { setSel(null); setItems([]) }} className="text-xs text-[#7b68ee] hover:underline">← 설비 목록</button>
            <span className="text-sm font-semibold text-[#090c1d]">{sel.sheet_name}</span>
            {canManage && <button onClick={() => setAll('O')} className="ml-auto h-7 px-2.5 rounded-lg bg-[#f5f4ff] text-[#7b68ee] text-xs font-medium hover:bg-[#ebe9ff]">전체 정상 ○</button>}
          </div>
          {isPending && items.length === 0 ? (
            <div className="py-6 text-center text-[#514b81] text-sm flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> 항목 로드 중…</div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto pr-1 space-y-2">
              {Object.entries(groups).map(([g, its]) => (
                <div key={g}>
                  <p className="text-[11px] font-semibold text-[#7b68ee] sticky top-0 bg-white py-0.5">{g}</p>
                  {its.map(it => (
                    <div key={it.item_code} className="border-b border-[#f8f9fa]">
                      <div className="flex items-center gap-2 py-1">
                        <span className="text-[10px] text-[#b0acd6] w-14 shrink-0">{it.item_code}</span>
                        <span className="text-xs text-[#090c1d] flex-1 min-w-0">{it.item_name}</span>
                        <div className="flex gap-0.5 shrink-0">
                          {(['O', 'X', 'N'] as Result[]).map(r => (
                            <button key={r} onClick={() => {
                              if (!canManage) return
                              setLocal(s => ({ ...s, [it.item_code]: r }))
                              // R13-d: X 선택 시 그 자리 인라인 등록 노출, 그 외엔 닫기
                              if (r === 'X') { setInlineX(it.item_code); setInlineMemo('') }
                              else if (inlineX === it.item_code) setInlineX(null)
                            }}
                              className={`w-7 h-7 rounded text-xs font-bold transition-colors ${local[it.item_code] === r
                                ? (r === 'O' ? 'bg-green-500 text-white' : r === 'X' ? 'bg-red-500 text-white' : 'bg-gray-400 text-white')
                                : 'bg-[#f5f4ff] text-[#b0acd6] hover:bg-[#ebe9ff]'}`}>
                              {r === 'O' ? '○' : r === 'X' ? '✕' : '／'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* R13-d: X 인라인 메모+[등록] — 상단 [불량 등록] 왕복 없이 그 자리에서 */}
                      {inlineX === it.item_code && (
                        <div className="flex items-center gap-2 pb-1.5 pl-14">
                          <input value={inlineMemo} onChange={e => setInlineMemo(e.target.value)}
                            placeholder="불량 메모 (선택)" className="h-7 flex-1 min-w-40 rounded border border-red-200 bg-white px-2 text-[11px] outline-none focus:border-red-400" />
                          <button onClick={() => registerInlineX(it.item_code)} disabled={isPending}
                            className="h-7 px-2.5 rounded bg-red-500 hover:bg-red-600 text-white text-[11px] font-medium disabled:opacity-50">
                            {isPending ? <Loader2 className="size-3 animate-spin" /> : '등록'}
                          </button>
                          <button onClick={() => setInlineX(null)} className="h-7 px-2 rounded border border-[#c8c4d0] text-[11px] text-[#514b81]">닫기</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          {canManage && (
            <div className="flex gap-2 mt-3">
              <button onClick={() => { setSel(null); setItems([]) }} disabled={isPending} className="flex-1 h-8 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] disabled:opacity-50">취소</button>
              <button onClick={save} disabled={isPending} className="flex-1 h-8 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium flex items-center justify-center disabled:opacity-50">
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <><Check className="size-3.5 mr-1" /> 저장</>}
              </button>
            </div>
          )}
          <p className="text-[11px] text-[#b0acd6] mt-2">저장 후 설비 목록 상단의 [불량 등록] 버튼으로 X(불량) 항목을 불량내역에 일괄 등록할 수 있습니다.</p>
        </div>
      )}
    </div>
  )
}
