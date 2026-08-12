'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

/** 점검표 항목 입력부 — 점검 상세(inspection-sheet-client)와 회차별 작성·조회 트리(plan-annex-sheet-tree) 공용.
 *
 *  같은 입력 UI를 화면마다 새로 만들면 빠른입력·불량 자동등록 같은 개선이 한쪽에만 적용된다
 *  (annex-compose-panel.tsx의 '화면 1개(이중 구현 금지)' 규약과 같은 이유). 여기가 단일 원천이다.
 *
 *  화면이 소유하는 것 / 이 컴포넌트가 소유하는 것의 경계:
 *  - 헤더(뒤로가기·시트명·전체 정상 ○)는 화면마다 의미가 달라(목록 복귀 vs 접기) 호출부가 갖는다.
 *  - X 인라인 메모·등록 상태는 순수 UI라 여기서 갖는다 — 양쪽 호출부의 배선이 0줄이 된다. */

export type SheetResult = 'O' | 'X' | 'N'
export type SheetItem = { item_code: string; item_name: string; comprehensive_only: boolean; group: string }

const RESULTS: SheetResult[] = ['O', 'X', 'N']
const mark = (r: SheetResult) => (r === 'O' ? '○' : r === 'X' ? '✕' : '／')
const activeCls = (r: SheetResult) =>
  r === 'O' ? 'bg-green-500 text-white' : r === 'X' ? 'bg-red-500 text-white' : 'bg-gray-400 text-white'

export function SheetItemEditor({
  items, loading, value, onResult, onRegisterX, canEdit, busy, error, notice,
  onSave, onCancel, maxHeight = 'max-h-[420px]', showFooterHint = true, saveLabel = '저장',
  hideSave = false, cancelLabel = '취소',
}: {
  items: SheetItem[]                                   // 범위 필터(작동=종합전용 제외)가 이미 적용된 표시 대상
  loading: boolean
  value: Record<string, SheetResult>
  onResult: (itemCode: string, result: SheetResult) => void
  onRegisterX: (itemCode: string, memo: string) => void
  canEdit: boolean
  busy: boolean
  error?: string
  /** 인라인 불량 등록 등 편집기 안에서 끝나는 동작의 결과 — 호출부 알림줄은 시트를 닫아야 보여서 여기서도 띄운다 */
  notice?: string
  onSave: () => void
  onCancel: () => void
  maxHeight?: string
  showFooterHint?: boolean
  saveLabel?: string
  /** 자동 저장 화면에서 저장 버튼을 감춘다 (소방계획서_20 S4-6) — 점검 상세는 기본값(false)로 종전 유지 */
  hideSave?: boolean
  cancelLabel?: string
}) {
  // R13-d: X 선택 시 그 자리에서 메모+[등록] — 상단 [불량 등록] 왕복 없이
  const [inlineX, setInlineX] = useState<string | null>(null)
  const [inlineMemo, setInlineMemo] = useState('')

  const groups = items.reduce<Record<string, SheetItem[]>>((acc, i) => { (acc[i.group] ??= []).push(i); return acc }, {})

  return (
    <>
      {loading && items.length === 0 ? (
        <div className="py-6 text-center text-[#514b81] text-sm flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> 항목 로드 중…</div>
      ) : (
        <div className={`${maxHeight} overflow-y-auto pr-1 space-y-2`}>
          {Object.entries(groups).map(([g, its]) => (
            <div key={g}>
              <p className="text-[11px] font-semibold text-[#7b68ee] sticky top-0 bg-white py-0.5">{g}</p>
              {its.map(it => (
                <div key={it.item_code} className="border-b border-[#f8f9fa]">
                  {/* S4-8: O/X/N은 현장에서 장갑 낀 손으로 누르는 버튼이다 — 28px는 오탭이 잦아 40px로 키우고
                      행 간격도 넓혔다. 메모 입력은 좁은 화면에서 넘치지 않게 아래 줄로 흐르게 한다. */}
                  <div className="flex items-center gap-2 py-1.5">
                    <span className="text-[10px] text-[#b0acd6] w-14 shrink-0">{it.item_code}</span>
                    <span className="text-xs text-[#090c1d] flex-1 min-w-0">{it.item_name}</span>
                    <div className="flex gap-1 shrink-0">
                      {RESULTS.map(r => (
                        <button key={r} onClick={() => {
                          if (!canEdit) return
                          onResult(it.item_code, r)
                          if (r === 'X') { setInlineX(it.item_code); setInlineMemo('') }
                          else if (inlineX === it.item_code) setInlineX(null)
                        }}
                          aria-label={`${it.item_code} ${r}`}
                          className={`w-10 h-10 rounded-lg text-sm font-bold transition-colors ${value[it.item_code] === r
                            ? activeCls(r)
                            : 'bg-[#f5f4ff] text-[#b0acd6] hover:bg-[#ebe9ff]'}`}>
                          {mark(r)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {inlineX === it.item_code && (
                    <div className="flex items-center gap-2 pb-1.5 pl-14 flex-wrap">
                      <input value={inlineMemo} onChange={e => setInlineMemo(e.target.value)}
                        placeholder="불량 메모 (선택)" className="h-9 flex-1 basis-40 min-w-0 rounded border border-red-200 bg-white px-2 text-[11px] outline-none focus:border-red-400" />
                      <button onClick={() => { onRegisterX(it.item_code, inlineMemo); setInlineX(null); setInlineMemo('') }} disabled={busy}
                        className="h-9 px-3 rounded bg-red-500 hover:bg-red-600 text-white text-[11px] font-medium disabled:opacity-50">
                        {busy ? <Loader2 className="size-3 animate-spin" /> : '등록'}
                      </button>
                      <button onClick={() => setInlineX(null)} className="h-9 px-3 rounded border border-[#c8c4d0] text-[11px] text-[#514b81]">닫기</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {notice && <p className="text-xs text-green-600 mt-2">{notice}</p>}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {canEdit && (
        <div className="flex gap-2 mt-3">
          <button onClick={onCancel} disabled={busy} className="flex-1 h-9 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] disabled:opacity-50">{cancelLabel}</button>
          {!hideSave && (
            <button onClick={onSave} disabled={busy} className="flex-1 h-9 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium flex items-center justify-center disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <><Check className="size-3.5 mr-1" /> {saveLabel}</>}
            </button>
          )}
        </div>
      )}
      {showFooterHint && (
        <p className="text-[11px] text-[#b0acd6] mt-2">저장 후 설비 목록 상단의 [불량 등록] 버튼으로 X(불량) 항목을 불량내역에 일괄 등록할 수 있습니다.</p>
      )}
    </>
  )
}
