'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { buildSheetOutline } from '@/lib/sheet-outline'

/** 점검표 항목 입력부 — 점검 상세(inspection-sheet-client)와 회차별 작성·조회 트리(plan-annex-sheet-tree) 공용.
 *
 *  같은 입력 UI를 화면마다 새로 만들면 빠른입력·불량 자동등록 같은 개선이 한쪽에만 적용된다
 *  (annex-compose-panel.tsx의 '화면 1개(이중 구현 금지)' 규약과 같은 이유). 여기가 단일 원천이다.
 *
 *  화면이 소유하는 것 / 이 컴포넌트가 소유하는 것의 경계:
 *  - 헤더(뒤로가기·시트명·전체 정상 ○)는 화면마다 의미가 달라(목록 복귀 vs 접기) 호출부가 갖는다.
 *  - X 인라인 메모·등록 상태는 순수 UI라 여기서 갖는다 — 양쪽 호출부의 배선이 0줄이 된다.
 *
 *  grouping(소방계획서_23 S7-1): 'flat'(기본) = 종전 렌더 그대로 — 기존 호출부 무변경.
 *  'outline' = 3층(중분류 sticky + 대괄호 소제목 run + 항목) — 시트 단위 드로어 전용. */

export type SheetResult = 'O' | 'X' | 'N'
export type SheetItem = {
  item_code: string; item_name: string; comprehensive_only: boolean; group: string
  /** 3층 축(소방계획서_23 134) — 미적용 DB에서는 없다(옵셔널). outline 분기가 폴백 처리 */
  group_code?: string | null
  group_name?: string | null
  subgroup_name?: string | null
}

/** 고를 수 있는 값은 **○·✕ 둘뿐**이다 (2026-08-13 확정 유지 — 개별 ／ 버튼 없음, 23 Q-19).
 *  ⚠ 의미 전환(소방계획서_22 Q-1·Q-5 → 23 Q-19, 2026-08-14): **미선택 = 미점검(공란)** 이다.
 *  종전에는 '고르지 않은 항목이 곧 해당없음(／)'이었으나, 22 Q-1이 ／를 전부 인쇄하기로 확정하면서
 *  ／(점검했고 해당없음)와 공란(아직 안 봄)이 서로 다른 인쇄 결과가 됐다.
 *  ／는 그룹 일괄 버튼([／ 모두 · 머더]·[／ 이 그룹]·[／ 전체 · 시트])으로만 기록한다 —
 *  일괄은 빈 칸만 채우고(Q-21, ○/✕ 절대 보존) 재클릭 시 그 범위의 ／만 해제하는 토글이다.
 *  이미 고른 ○/✕를 다시 누르면 미점검(공란)으로 되돌아간다(유일한 개별 해제 경로). */
const RESULTS: SheetResult[] = ['O', 'X']
const mark = (r: SheetResult) => (r === 'O' ? '○' : r === 'X' ? '✕' : '／')
const activeCls = (r: SheetResult) =>
  r === 'O' ? 'bg-green-500 text-white' : r === 'X' ? 'bg-red-500 text-white' : 'bg-gray-400 text-white'

type RowCtx = {
  value: Record<string, SheetResult>
  canEdit: boolean
  busy: boolean
  inlineX: string | null
  inlineMemo: string
  setInlineX: (v: string | null) => void
  setInlineMemo: (v: string) => void
  onResult: (itemCode: string, result: SheetResult | null) => void
  onRegisterX: (itemCode: string, memo: string) => void
}

/** 항목 1행 — flat·outline 공용(S7-1 ItemRow). 마크업은 종전 flat 렌더와 동일해야 한다 */
function ItemRow({ it, ctx }: { it: SheetItem; ctx: RowCtx }) {
  const { value, canEdit, busy, inlineX, inlineMemo, setInlineX, setInlineMemo, onResult, onRegisterX } = ctx
  return (
    <div className="border-b border-[#f8f9fa]">
      {/* S4-8: O/X는 현장에서 장갑 낀 손으로 누르는 버튼이다 — 28px는 오탭이 잦아 40px로 키우고
          행 간격도 넓혔다. 메모 입력은 좁은 화면에서 넘치지 않게 아래 줄로 흐르게 한다. */}
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-[10px] text-[#b0acd6] w-14 shrink-0">{it.item_code}</span>
        <span className="text-xs text-[#090c1d] flex-1 min-w-0">{it.item_name}</span>
        <div className="flex items-center gap-1 shrink-0">
          {/* ／(해당없음)는 그룹 일괄로만 기록된다(Q-19) — 기록된 항목엔 진회색 ／ 표식.
              미선택은 미점검(공란) — 표식 없음(인쇄 시 결과란이 비어 나간다) */}
          {value[it.item_code] === 'N' && (
            <span className="text-[13px] font-bold text-gray-500 mr-0.5 select-none" data-na-mark
              title="해당없음(／) — 그룹 일괄 버튼으로 기록됨. 해제도 같은 일괄 버튼을 다시 누르세요">／</span>
          )}
          {RESULTS.map(r => {
            const on = value[it.item_code] === r
            return (
              <button key={r} onClick={() => {
                if (!canEdit) return
                // 같은 값을 다시 누르면 해제 → 미점검(공란)으로 되돌린다 (Q-19 — 종전 '해당없음' 아님)
                if (on) {
                  onResult(it.item_code, null)
                  if (inlineX === it.item_code) setInlineX(null)
                  return
                }
                onResult(it.item_code, r)
                if (r === 'X') { setInlineX(it.item_code); setInlineMemo('') }
                else if (inlineX === it.item_code) setInlineX(null)
              }}
                aria-label={`${it.item_code} ${r}`}
                title={on ? '다시 누르면 미점검(공란)으로' : undefined}
                className={`w-10 h-10 rounded-lg text-sm font-bold transition-colors ${on
                  ? activeCls(r)
                  : 'bg-[#f5f4ff] text-[#b0acd6] hover:bg-[#ebe9ff]'}`}>
                {mark(r)}
              </button>
            )
          })}
        </div>
      </div>
      {inlineX === it.item_code && (
        <div className="flex items-center gap-2 pb-1.5 pl-14 flex-wrap">
          <input value={inlineMemo} onChange={e => setInlineMemo(e.target.value)}
            // ESC 우선순위(23 S7-8) — 드로어보다 인라인 폼이 먼저 소비한다. 안 그러면 메모 입력 중
            // ESC 한 번에 드로어째 닫혀 입력이 날아간다(드로어는 패널 onKeyDown이라 전파 차단이 닿는다)
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setInlineX(null) } }}
            placeholder="불량 메모 (선택)" className="h-9 flex-1 basis-40 min-w-0 rounded border border-red-200 bg-white px-2 text-[11px] outline-none focus:border-red-400" />
          <button onClick={() => { onRegisterX(it.item_code, inlineMemo); setInlineX(null); setInlineMemo('') }} disabled={busy}
            className="h-9 px-3 rounded bg-red-500 hover:bg-red-600 text-white text-[11px] font-medium disabled:opacity-50">
            {busy ? <Loader2 className="size-3 animate-spin" /> : '등록'}
          </button>
          <button onClick={() => setInlineX(null)} className="h-9 px-3 rounded border border-[#c8c4d0] text-[11px] text-[#514b81]">닫기</button>
        </div>
      )}
    </div>
  )
}

export function SheetItemEditor({
  items, loading, value, onResult, onRegisterX, canEdit, busy, error, notice,
  onSave, onCancel, maxHeight = 'max-h-[420px]', showFooterHint = true, saveLabel = '저장',
  hideSave = false, hideCancel = false, cancelLabel = '취소', grouping = 'flat', scrollBoxRef,
}: {
  items: SheetItem[]                                   // 범위 필터(작동=종합전용 제외)가 이미 적용된 표시 대상
  loading: boolean
  value: Record<string, SheetResult>
  /** result=null = 선택 해제 → 미점검(공란)으로 되돌림 (Q-19) */
  onResult: (itemCode: string, result: SheetResult | null) => void
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
  /** 자동저장 + master-detail 화면 — 돌아갈 곳이 없어 [취소]를 숨긴다 (hideSave와 대칭) */
  hideCancel?: boolean
  cancelLabel?: string
  /** 'outline' = 3층 렌더(중분류 sticky + 소제목 run + [○·／ 모두] 일괄) — 드로어 전용 (23 S7-1) */
  grouping?: 'flat' | 'outline'
  /** outline 스크롤 박스 ref — 목차(sheet-group-toc)의 점프·스파이가 이 박스를 쓴다 */
  scrollBoxRef?: React.RefObject<HTMLDivElement | null>
}) {
  // R13-d: X 선택 시 그 자리에서 메모+[등록] — 상단 [불량 등록] 왕복 없이
  const [inlineX, setInlineX] = useState<string | null>(null)
  const [inlineMemo, setInlineMemo] = useState('')
  const ctx: RowCtx = { value, canEdit, busy, inlineX, inlineMemo, setInlineX, setInlineMemo, onResult, onRegisterX }

  /** 일괄 채움 정책(23 Q-21) — 빈 칸만 채우고 ○/✕ 절대 보존. 재클릭은 그 범위의 값만 해제하는 토글 */
  function bulkNA(codes: string[]) {
    if (!canEdit) return
    const empty = codes.filter(c => !value[c])
    if (empty.length > 0) { for (const c of empty) onResult(c, 'N'); return }
    for (const c of codes) if (value[c] === 'N') onResult(c, null)   // 전부 채워져 있으면 해제 — N만
  }
  function bulkO(codes: string[]) {
    if (!canEdit) return
    const empty = codes.filter(c => !value[c])
    if (empty.length > 0) { for (const c of empty) onResult(c, 'O'); return }
    for (const c of codes) if (value[c] === 'O') onResult(c, null)
  }

  const bulkBtnCls = 'h-6 px-2 rounded text-[10px] font-medium shrink-0 bg-white/80 border border-[#d0ccf5] text-[#514b81] hover:bg-[#ebe9ff] disabled:opacity-40'

  const body = loading && items.length === 0 ? (
    <div className="py-6 text-center text-[#514b81] text-sm flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> 항목 로드 중…</div>
  ) : grouping === 'flat' ? (
    <div className={`${maxHeight} overflow-y-auto pr-1 space-y-2`}>
      {Object.entries(items.reduce<Record<string, SheetItem[]>>((acc, i) => { (acc[i.group] ??= []).push(i); return acc }, {})).map(([g, its]) => (
        <div key={g}>
          <p className="text-[11px] font-semibold text-[#7b68ee] sticky top-0 bg-white py-0.5">{g}</p>
          {its.map(it => <ItemRow key={it.item_code} it={it} ctx={ctx} />)}
        </div>
      ))}
    </div>
  ) : (
    // ── outline(3층) — 중분류 sticky 헤더(높이 고정 h-[22px], 폰트 흔들림에 소제목 top이 깨지지 않게)
    //    + 소제목 run sticky top-[22px] + 항목. run은 연속 구간만(sheet-outline.ts — order_num 보존) ──
    <div ref={scrollBoxRef} className={`${maxHeight} overflow-y-auto pr-1`}>
      {buildSheetOutline(items).map(g => (
        <div key={g.code} data-outline-group={g.code}>
          <div className="sticky top-0 z-[2] h-[22px] flex items-center gap-1.5 bg-[#f5f4ff] rounded px-1.5">
            <span className="text-[11px] font-bold text-[#7b68ee] shrink-0">[{g.code}]</span>
            {g.name !== g.code && <span className="text-[11px] font-semibold text-[#514b81] truncate flex-1 min-w-0">{g.name}</span>}
            {/* Q-17 — 일괄 대상은 이 중분류뿐임을 라벨에 명시. 시트 전체 일괄은 드로어 헤더 [／ 전체]가 담당 */}
            {canEdit && (
              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => bulkO(g.items.map(i => i.item_code))} data-bulk-o={g.code}
                  title="이 중분류의 미입력 항목만 ○로 채움 — 입력된 값은 보존(재클릭 시 ○만 해제)"
                  className={bulkBtnCls} disabled={busy}>○ 모두 · {g.code}</button>
                <button onClick={() => bulkNA(g.items.map(i => i.item_code))} data-bulk-na={g.code}
                  title="이 중분류의 미입력 항목만 ／(해당없음)로 채움 — 입력된 값은 보존(재클릭 시 ／만 해제)"
                  className={bulkBtnCls} disabled={busy}>／ 모두 · {g.code}</button>
              </span>
            )}
          </div>
          {g.runs.map((run, ri) => (
            <div key={ri}>
              {run.subgroup ? (
                <div className="sticky top-[22px] z-[1] flex items-center gap-1.5 bg-white border-l-2 border-[#c3bdf5] pl-2 py-0.5"
                  data-subgroup={run.subgroup}>
                  <span className="text-[11px] font-semibold text-[#514b81]">[{run.subgroup}]</span>
                  {/* Q-19 T-2 — 대괄호 그룹 단위 ／. 1-B 하나가 별지4호 1쪽 체크박스 4개로 쪼개져
                      중분류 단위만으로는 '주거용만 설치'를 표현할 수 없다 */}
                  {canEdit && (
                    <button onClick={() => bulkNA(run.items.map(i => i.item_code))} data-bulk-na-sub={run.subgroup}
                      title="이 소제목 그룹의 미입력 항목만 ／(해당없음)로 채움 — 재클릭 시 ／만 해제"
                      className={`${bulkBtnCls} ml-auto`} disabled={busy}>／ 이 그룹</button>
                  )}
                </div>
              ) : ri > 0 ? <div className="border-t border-[#f0eefb] mt-0.5" /> : null}
              <div className={run.subgroup ? 'pl-2 border-l-2 border-[#f0eefb]' : ''}>
                {run.items.map(it => <ItemRow key={it.item_code} it={it} ctx={ctx} />)}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )

  return (
    <>
      {body}
      {notice && <p className="text-xs text-green-600 mt-2">{notice}</p>}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {/* 둘 다 숨기면 푸터 블록 자체를 렌더하지 않는다 — 전용 입력 페이지(28)는 좌 목록이 상시
          보이는 master-detail이라 '취소/닫기'가 갈 곳이 없고, 자동저장이라 [저장]도 없다. */}
      {canEdit && !(hideSave && hideCancel) && (
        <div className="flex gap-2 mt-3">
          {!hideCancel && (
            <button onClick={onCancel} disabled={busy} className="flex-1 h-9 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] disabled:opacity-50">{cancelLabel}</button>
          )}
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
