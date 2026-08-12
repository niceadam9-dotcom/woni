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
  const running = useRef(false)
  /** 실행 중에 들어온 변경 — 끝나면 한 번 더 돈다(마지막 입력이 유실되지 않게) */
  const queued = useRef(false)
  const paused = useRef(false)
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save })

  const clearTimer = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null }
  }

  const run = useCallback(async (force = false) => {
    if (!force && paused.current) { queued.current = true; return }
    if (running.current) { queued.current = true; return }
    running.current = true
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
      running.current = false
    }
  }, [])

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
  const hasPending = useCallback(() => timer.current !== null || queued.current || running.current, [])

  useEffect(() => () => clearTimer(), [])

  return { status, error, schedule, flush, retry, pause, resume, hasPending }
}
