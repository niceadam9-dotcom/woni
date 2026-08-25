'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** 입력 멈춤 후 자동 저장 (소방계획서_20 S4-1).
 *
 *  왜 훅으로 빼는가: 저장 타이밍(디바운스·중복 실행 방지·일시 중지)은 어느 입력 화면에서나 같고,
 *  화면마다 다시 만들면 "저장 중에 또 눌렀을 때" 같은 경계 처리가 한쪽에만 들어간다.
 *
 *  `save`는 호출 시점의 최신 상태를 읽어 저장하는 콜백이다(payload를 큐에 담지 않는다) —
 *  디바운스 대기 중 값이 더 바뀌어도 마지막 상태 하나만 저장되면 되기 때문. */

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'paused'

export function useDebouncedAutosave(
  save: () => Promise<{ error?: string }>,
  { delayMs = 1000 }: { delayMs?: number } = {},
) {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const timer = useRef<number | null>(null)
  /** 진행 중인 저장 — `flush()`가 **이것을 기다린다**. 종전엔 boolean이라 기다릴 대상이 없었다 */
  const inflight = useRef<Promise<void> | null>(null)
  /** 실행 중에 들어온 변경 — 끝나면 한 번 더 돈다(마지막 입력이 유실되지 않게) */
  const queued = useRef(false)
  const paused = useRef(false)
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save })

  const clearTimer = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null }
  }

  /** run이 자기 자신을 이어 호출하기 위한 우회(useCallback은 자기 참조가 안 된다).
   *  ⚠ 대입은 **렌더 중이 아니라 이펙트에서** 한다 — 렌더 중 ref 쓰기는 react-hooks/refs 위반이다.
   *  run은 마운트 뒤(타이머·이벤트 핸들러)에만 호출되므로 첫 렌더의 no-op이 관측되지 않는다. */
  const runRef = useRef<(force?: boolean) => Promise<void>>(async () => {})

  const run = useCallback((force = false): Promise<void> => {
    if (!force && paused.current) { queued.current = true; return Promise.resolve() }
    // 🔴 이미 돌고 있으면 **그 저장이 끝날 때까지 기다린다**(2026-08-25).
    //    종전에는 `if (running.current) { queued.current = true; return }`으로 **즉시 반환**했다.
    //    force도 이 검사를 우회하지 못해서, 호출부는 `await flush()`가 끝났으니 대기 중인 입력이
    //    전부 나갔다고 믿었지만 실제로는 큐만 남고 저장은 그 뒤에 일어났다. 그 후속 저장이
    //    delta를 다시 계산해 호출부의 명시 저장을 덮어썼다 — ✕ 인라인 등록의 memo가 null로
    //    사라지던 경로가 이것이다(use-sheet-autosave의 rows에는 memo 필드가 없다).
    //    실측: test-mu-sheet가 `{"result":"X","memo":null}`로 붉었다(수리 전 대조군).
    if (inflight.current) {
      queued.current = true
      const wait = inflight.current
      // force(=flush)는 큐가 남아 있으면 그것까지 소진하고 돌아온다 — "먼저 흘려보낸다"는 계약의 실체
      return force ? wait.then(() => (queued.current ? runRef.current(true) : undefined)) : wait
    }
    const p = (async () => {
      try {
        // 실행 중 들어온 변경은 큐에 쌓였다가 이 루프에서 이어 저장된다(재귀 대신 반복)
        do {
          queued.current = false
          setStatus('saving'); setError(null)
          try {
            const res = await saveRef.current()
            if (res.error) { setStatus('error'); setError(res.error); break }
            setStatus('saved')
          } catch {
            setStatus('error'); setError('저장에 실패했습니다 — [다시 시도]를 눌러주세요.')
            break
          }
        } while (queued.current && (force || !paused.current))
      } finally {
        inflight.current = null
      }
    })()
    // IIFE 본문은 첫 await까지만 동기 실행되므로 이 대입이 finally보다 항상 먼저다
    inflight.current = p
    return p
  }, [])
  useEffect(() => { runRef.current = run }, [run])

  /** 입력이 있었음을 알린다 — delayMs 동안 추가 입력이 없으면 저장 */
  const schedule = useCallback(() => {
    clearTimer()
    if (paused.current) { queued.current = true; setStatus('paused'); return }
    setStatus('saving')
    timer.current = window.setTimeout(() => { timer.current = null; void run() }, delayMs)
  }, [delayMs, run])

  /** 지금 즉시 저장 (이탈·수동 저장) — 일시 중지 상태여도 강제 실행 */
  const flush = useCallback(async () => {
    clearTimer()
    await run(true)
  }, [run])

  /** 실패 후 사용자가 누르는 재시도 */
  const retry = useCallback(async () => { await flush() }, [flush])

  const pause = useCallback(() => { paused.current = true; clearTimer(); setStatus(s => (s === 'saving' ? 'paused' : s)) }, [])
  const resume = useCallback(() => {
    paused.current = false
    if (queued.current) { queued.current = false; void run() }
    else setStatus(s => (s === 'paused' ? 'idle' : s))
  }, [run])

  /** 대기 중인 변경이 남아 있는지 — 이탈 확인창 판단용 */
  // ⚠ `running`(boolean)은 2026-08-25 리팩터에서 `inflight`(Promise)로 바뀌었는데 여기만 옛 이름이
  //    남아 tsc TS2304로 빌드가 막혀 있었다. 진행 중 판정은 '대기 중인 프로미스가 있는가'다
  const hasPending = useCallback(() => timer.current !== null || queued.current || inflight.current !== null, [])

  useEffect(() => () => clearTimer(), [])

  return { status, error, schedule, flush, retry, pause, resume, hasPending }
}
