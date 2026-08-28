'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2, Save } from 'lucide-react'

/** 미저장 이동 확인 — 확인창에 [저장하고 이동]을 제공하기 위한 공통 배선.
 *
 *  이동을 막는 쪽(PlanTabView 서식 트리·CustomerTabs 탭·1.4 건물 전환)은 지금 어떤 서식이 떠 있는지,
 *  그 서식의 저장이 무엇인지 모른다. 서식은 서버에서 렌더돼 ReactNode 프롭으로 꽂히므로 프롭 배선도 닿지 않는다.
 *  그래서 미저장 서식이 스스로 자기 save()를 window 이벤트 채널에 등록하고, 이동 가드는 수집해서 await 한다.
 *  등록은 미저장(dirty)일 때만 — 저장할 게 없는 서식은 응답하지 않으므로 [저장하고 이동]도 뜨지 않는다. */

const COLLECT_EVENT = 'erp:plan-save-collect'

/** 저장 처리기 — 반환 true = 저장 성공(이동 진행), false = 실패(이동 중단, 화면 오류 메시지 유지) */
export type PlanSaveHandler = () => Promise<boolean>

/** 미저장 서식이 자기 저장 함수를 등록한다 (대부분의 서식은 useUnsavedWarning(dirty, save)로 간접 호출) */
export function usePlanSaveHandler(handler: PlanSaveHandler, enabled: boolean) {
  // 렌더마다 최신 클로저로 갱신 — 등록/해제를 반복하지 않으면서도 오래된 state로 저장하지 않게 한다
  const ref = useRef(handler)
  useEffect(() => { ref.current = handler })
  useEffect(() => {
    if (!enabled) return
    const onCollect = (e: Event) => {
      (e as CustomEvent<{ handlers: PlanSaveHandler[] }>).detail.handlers.push(() => ref.current())
    }
    window.addEventListener(COLLECT_EVENT, onCollect)
    return () => window.removeEventListener(COLLECT_EVENT, onCollect)
  }, [enabled])
}

/** 지금 미저장 상태로 떠 있는 서식들의 저장 처리기 수집 */
export function collectPlanSaveHandlers(): PlanSaveHandler[] {
  const handlers: PlanSaveHandler[] = []
  window.dispatchEvent(new CustomEvent(COLLECT_EVENT, { detail: { handlers } }))
  return handlers
}

/** 이동 가드 — request(target)로 확인창을 띄우고, [저장하고 이동]/[저장하지 않고 이동]에 따라 onProceed 호출.
 *  반환 dialog를 호출부 JSX에 그대로 꽂으면 된다. */
export function useUnsavedNavGuard<T>({ onProceed, message, saveLabel = '저장하고 이동', discardLabel = '저장하지 않고 이동' }: {
  onProceed: (target: T) => void
  message: string
  saveLabel?: string
  discardLabel?: string
}) {
  // target을 객체로 감싸는 이유: 0·''처럼 falsy한 이동 대상(건물 인덱스 0)도 '대기 중'으로 구분해야 한다
  const [pending, setPending] = useState<{ target: T } | null>(null)
  const [canSave, setCanSave] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /** 미저장일 때 호출 — 확인창을 띄운다 (미저장이 아닌 경우의 즉시 이동은 호출부 판단) */
  function request(target: T) {
    setError('')
    setSaving(false)
    setCanSave(collectPlanSaveHandlers().length > 0)
    setPending({ target })
  }

  function close() { setPending(null); setSaving(false); setError('') }

  function proceed() {
    if (!pending) return
    const { target } = pending
    close()
    onProceed(target)
  }

  async function saveAndProceed() {
    if (!pending) return
    const handlers = collectPlanSaveHandlers()
    if (handlers.length === 0) { proceed(); return }   // 그 사이 저장돼 남은 게 없다면 그냥 이동
    setSaving(true)
    setError('')
    try {
      const results = await Promise.all(handlers.map(h => h()))
      if (results.some(ok => !ok)) {
        setError('저장하지 못했습니다 — 확인창을 닫고 화면의 오류 메시지를 확인해주세요.')
        return
      }
    } catch {
      setError('저장 중 오류가 발생했습니다 — 잠시 후 다시 시도해주세요.')
      return
    } finally {
      setSaving(false)
    }
    proceed()
  }

  const dialog: ReactNode = pending && (
    // data-unsaved-dialog: 확인창 버튼의 '저장' 글자가 서식 화면의 미저장 감지 휴리스틱에 걸리지 않도록 하는 표식
    <div data-unsaved-dialog className="fixed inset-0 bg-black/25 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-surface rounded-2xl shadow-xl border border-line w-full max-w-sm">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-line">
          <AlertTriangle className="size-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-ink">저장하지 않은 변경이 있습니다</h2>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs text-ink-sub leading-relaxed">{message}</p>
          {error && <p className="mt-2 text-[11px] text-red-600 leading-relaxed">{error}</p>}
        </div>
        <div className="flex flex-col gap-2 px-6 py-4 border-t border-line">
          {canSave && (
            <button
              onClick={() => { void saveAndProceed() }}
              disabled={saving}
              data-testid="unsaved-nav-save"
              className="h-10 rounded-lg bg-brand hover:bg-brand-strong text-white text-sm font-medium transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {saveLabel}
            </button>
          )}
          <button
            onClick={proceed}
            disabled={saving}
            data-testid="unsaved-nav-discard"
            className="h-9 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper transition-colors disabled:opacity-50"
          >
            {discardLabel}
          </button>
          <button
            onClick={close}
            disabled={saving}
            data-testid="unsaved-nav-cancel"
            className="h-9 rounded-lg text-xs text-ink-faint hover:text-ink-sub transition-colors disabled:opacity-50"
          >
            취소 (이 화면에 머무르기)
          </button>
        </div>
      </div>
    </div>
  )

  return { request, dialog }
}
