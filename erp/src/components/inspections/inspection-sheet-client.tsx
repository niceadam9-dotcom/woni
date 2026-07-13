'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, Check, Loader2, CircleCheck } from 'lucide-react'
import { loadSheetItemsAction, saveSheetResponsesAction } from '@/app/(dashboard)/inspections/sheet-actions'

type Sheet = { id: string; sheet_code: string; sheet_name: string }
type Item = { item_code: string; item_name: string; comprehensive_only: boolean; group: string }
type Result = 'O' | 'X' | 'N'

/** 점검표 입력 (P34-2) — 설비 선택 → 항목별 ○/X/／. 작동점검이면 종합전용(●) 항목 숨김. */
export function InspectionSheetClient({ inspectionId, inspectionType, sheets, responses, respondedCounts, canManage }: {
  inspectionId: string
  inspectionType: string
  sheets: Sheet[]
  responses: Record<string, { result: Result; memo: string | null }>
  respondedCounts: Record<string, number>  // sheet_code prefix(설비번호) → 응답 수
  canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [sel, setSel] = useState<Sheet | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [local, setLocal] = useState<Record<string, Result>>({})
  const [error, setError] = useState('')

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
        <span className="text-xs text-[#b0acd6] ml-auto">{isOperational ? '작동점검 (○항목)' : '종합점검 (전체)'}</span>
      </div>

      {!sel ? (
        <>
          <p className="text-[11px] text-[#b0acd6] mb-2">설비를 선택해 항목별 ○(정상)/X(불량)/／(해당없음)을 입력합니다.</p>
          <div className="grid grid-cols-2 gap-1.5">
            {sheets.map(s => {
              const num = s.sheet_code.replace('STD-', '').replace(/^0/, '')
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
                    <div key={it.item_code} className="flex items-center gap-2 py-1 border-b border-[#f8f9fa]">
                      <span className="text-[10px] text-[#b0acd6] w-14 shrink-0">{it.item_code}</span>
                      <span className="text-xs text-[#090c1d] flex-1 min-w-0">{it.item_name}</span>
                      <div className="flex gap-0.5 shrink-0">
                        {(['O', 'X', 'N'] as Result[]).map(r => (
                          <button key={r} onClick={() => canManage && setLocal(s => ({ ...s, [it.item_code]: r }))}
                            className={`w-7 h-7 rounded text-xs font-bold transition-colors ${local[it.item_code] === r
                              ? (r === 'O' ? 'bg-green-500 text-white' : r === 'X' ? 'bg-red-500 text-white' : 'bg-gray-400 text-white')
                              : 'bg-[#f5f4ff] text-[#b0acd6] hover:bg-[#ebe9ff]'}`}>
                            {r === 'O' ? '○' : r === 'X' ? '✕' : '／'}
                          </button>
                        ))}
                      </div>
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
          <p className="text-[11px] text-[#b0acd6] mt-2">X(불량) 항목은 아래 불량내역에 별도 등록하세요. (자동 연동은 다음 단계)</p>
        </div>
      )}
    </div>
  )
}
