'use client'

import { useRouter, usePathname } from 'next/navigation'
import { Check, ArrowRight, X } from 'lucide-react'
import { useCustomerTabs } from '@/components/customers/customer-tabs'
import type { OnboardingStep, OnboardingTab } from '@/lib/onboarding-steps'

/** 신규등록 진행 띠 — 기본정보 → 건물·시설 → 관계인 → 소방계획서 (2026-09-15 사용자 확정)
 *
 *  등록 직후(`?onboarding=1`)에만 뜬다. **차단하지 않는다** — 탭은 그대로 다 눌린다.
 *  실측상 기존 고객 96.7%가 건물 미완이라 상시 잠금은 못 할 일이고, 사용자 결정도 「신규등록
 *  흐름만 순서대로」였다. 이 띠는 길만 가리킨다.
 *
 *  🚨 **`<Link>`나 `router.push`로 탭을 옮기지 않는다.** 탭 셸은 자기 state로 활성 탭을 들고
 *    있어서 URL만 바꾸면 화면이 안 따라온다(`customer-tabs.tsx:47` 주석이 같은 함정을 적어 뒀다).
 *    반드시 셸의 `goTab`을 부른다 — 미저장 확인창도 그 경로에만 걸려 있다.
 */
export function OnboardingStrip({ steps, hint, next, complete }: {
  steps: OnboardingStep[]
  hint: string
  next: OnboardingTab
  complete: boolean
}) {
  const tabs = useCustomerTabs()
  const router = useRouter()
  const pathname = usePathname()

  /** 띠를 닫는다 — `onboarding`만 떼고 지금 보던 탭은 그대로 둔다(보던 화면을 뺏지 않는다) */
  function dismiss() {
    const sp = new URLSearchParams(window.location.search)
    sp.delete('onboarding')
    sp.delete('created')
    router.replace(`${pathname}${sp.size ? `?${sp}` : ''}`, { scroll: false })
  }

  return (
    <div
      data-testid="onboarding-strip"
      className="max-w-3xl rounded-lg border border-brand-line-soft bg-brand-tint px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-form-sm font-semibold text-ink">
          고객 등록 완료 — {complete ? '이어서 소방계획서를 작성하세요' : '순서대로 이어서 입력하세요'}
        </p>
        <button
          type="button" onClick={dismiss} data-testid="onboarding-dismiss"
          className="shrink-0 inline-flex items-center gap-1 text-form-2xs text-ink-meta hover:text-ink"
        >
          <X className="size-3" /> 안내 닫기
        </button>
      </div>

      {/* 단계 표시 — 라벨은 탭 라벨과 글자까지 같다(같은 것으로 읽히게) */}
      <ol className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-ink-meta/50 text-form-2xs">›</span>}
            <span
              data-testid={`onboarding-step-${s.key}`}
              data-state={s.current ? 'current' : s.done ? 'done' : 'todo'}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-form-2xs font-medium ${
                s.current ? 'bg-brand text-white'
                  : s.done ? 'bg-surface text-ink-sub border border-brand-line-soft'
                    : 'bg-surface text-ink-meta border border-line'
              }`}
            >
              {s.done && !s.current && <Check className="size-3 text-green-600" />}
              {i + 1}. {s.label}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-form-xs text-ink-sub" data-testid="onboarding-hint">{hint}</span>
        {/* 「다음」은 늘 **첫 미완**으로 간다 — 이미 채운 칸을 다시 보여주지 않는다 */}
        <button
          type="button" onClick={() => tabs?.goTab(next)} data-testid="onboarding-next"
          className="inline-flex items-center gap-1 h-form-8 rounded-lg border border-brand-line bg-surface px-2.5 text-form-xs font-medium text-brand hover:bg-brand-tint"
        >
          {complete ? '소방계획서로' : `${steps.find(s => s.key === next)?.label ?? ''}(으)로`}
          <ArrowRight className="size-3" />
        </button>
      </div>
    </div>
  )
}
