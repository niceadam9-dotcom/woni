'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDebouncedAutosave } from '@/hooks/use-debounced-autosave'
import { saveSheetResponsesAction } from '@/app/(dashboard)/inspections/sheet-actions'
import type { SheetResult } from '@/lib/sheet-overview'

/** 점검표 자동 저장 — **저장 규칙의 단일 원천** (소방계획서_28 S1).
 *
 *  `useDebouncedAutosave`는 타이밍 원시함수(디바운스·중복 실행 방지·일시 중지)고,
 *  이 훅은 그 위의 **점검표 도메인 규칙**이다: delta 계산 · 해제(clearCodes) · baseline 승격.
 *  그 규칙이 곧 "저장이란 무엇인가"라서, 화면마다 다시 쓰면 화면마다 저장이 달라진다 —
 *  실제로 드로어·트리·1.4가 각자 다른 규칙을 갖게 됐던 것이 이 훅을 만든 이유다.
 *
 *  ⚠ 계약 3가지 (전부 실측으로 밟은 지뢰다. 소비처에서 어기지 말 것)
 *   ① `✕`는 schedule() 대상이 아니다 — 인라인 메모 + [등록]으로 완결되는 별도 흐름이라
 *      미리 저장하면 이중 쓰기 + Realtime 에코가 2회 온다.
 *   ② `month`는 **호출 시점의 값을 ref로 읽는다** — 외관 월 전환 시 flush가 반드시 옛 달로
 *      끝나야 한다. state를 클로저로 잡으면 3월에 찍은 입력이 7월 행으로 저장된다.
 *   ③ 원격 변경(stale)이 감지되면 `pause()`, 해소되면 `resume()` — 내 디바운스가 남의 최신
 *      값을 덮지 않게. (트리 S4-5에서 확립)
 */
export function useSheetAutosave<T extends { item_code: string }>(opts: {
  inspectionId: string
  /** 외관(EX-4) 월 축. 일반 점검표는 0 — 호출 시점 값을 읽으므로 state를 그대로 넘겨도 된다 */
  month?: number
  /** 저장 성공 직후 — 좌 목록·요약을 서버 재조회 없이 로컬 갱신하는 자리 */
  onSaved?: () => void
}) {
  const { inspectionId, month = 0, onSaved } = opts

  const [items, setItems] = useState<T[]>([])
  const [draft, setDraft] = useState<Record<string, SheetResult>>({})
  const [baseline, setBaseline] = useState<Record<string, SheetResult>>({})

  // 저장 콜백은 "호출 시점의 최신 상태"를 읽어야 한다(payload를 큐에 담지 않는 설계) → 전부 ref로 미러
  const itemsRef = useRef(items)
  const draftRef = useRef(draft)
  const baselineRef = useRef(baseline)
  const monthRef = useRef(month)      // ⚠ 계약 ②
  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    itemsRef.current = items; draftRef.current = draft
    baselineRef.current = baseline; monthRef.current = month; onSavedRef.current = onSaved
  })

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
    const res = await saveSheetResponsesAction(inspectionId, rows, monthRef.current, clearCodes)
    if (res.error) return res
    // 저장분만 기준값으로 승격 — 저장 도중 바뀐 항목은 dirty로 남아 다음 저장에 실린다
    setBaseline(prev => {
      const next = { ...prev }
      for (const r of rows) next[r.item_code] = r.result
      for (const c of clearCodes) delete next[c]
      return next
    })
    onSavedRef.current?.()
    return {}
  })

  /** 시트를 새로 열거나 월을 바꿨을 때 — 항목·응답을 갈아끼우고 baseline을 그 값으로 리셋한다.
   *  baseline을 같이 안 바꾸면 옛 시트의 delta가 새 시트로 새서 엉뚱한 코드가 저장된다. */
  const resetSheet = useCallback((nextItems: T[], responses: Record<string, SheetResult>) => {
    setItems(nextItems)
    setDraft(responses)
    setBaseline(responses)
  }, [])

  /** 항목 하나의 결과를 바꾼다. null이면 해제. ⚠ 계약 ① — 'X'는 저장을 예약하지 않는다 */
  const setResult = useCallback((itemCode: string, result: SheetResult | null) => {
    setDraft(prev => {
      const next = { ...prev }
      if (result === null) delete next[itemCode]
      else next[itemCode] = result
      return next
    })
    if (result !== 'X') autosave.schedule()
  }, [autosave])

  /** 대장 힌트·일괄 ／ 처럼 draft를 통째로 바꾸는 경로 — 바꾼 뒤 스스로 예약한다 */
  const patchDraft = useCallback((fn: (prev: Record<string, SheetResult>) => Record<string, SheetResult>) => {
    setDraft(fn)
    autosave.schedule()
  }, [autosave])

  const dirty = itemsRef.current.some(i => draft[i.item_code] !== baseline[i.item_code])

  return {
    items, setItems, draft, baseline, setBaseline,
    resetSheet, setResult, patchDraft, dirty,
    status: autosave.status, error: autosave.error,
    schedule: autosave.schedule, flush: autosave.flush, retry: autosave.retry,
    pause: autosave.pause, resume: autosave.resume, hasPending: autosave.hasPending,
  }
}
