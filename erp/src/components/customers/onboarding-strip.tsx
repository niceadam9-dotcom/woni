'use client'

import { Check, ArrowRight } from 'lucide-react'
import { useCustomerTabs } from '@/components/customers/customer-tabs'
import {
  sequentialSteps, sequentialNext,
  type OnboardingStep, type OnboardingTab, type OnboardingState,
} from '@/lib/onboarding-steps'

/** 신규등록 진행 띠 — 기본정보 → 건물·시설 → 관계인 → 소방계획서 (2026-09-15 사용자 확정)
 *
 *  등록 직후(`?onboarding=1`)에만 뜬다. **차단하지 않는다** — 탭은 그대로 다 눌린다.
 *  실측상 기존 고객 96.7%가 건물 미완이라 상시 잠금은 못 할 일이고, 사용자 결정도 「신규등록
 *  흐름만 순서대로」였다. 이 띠는 길만 가리킨다.
 *
 *  ⭐ 차례 모드(`sequence`가 있을 때 — 등록 폼의 [상세정보 입력]·점검달력에서 시작한 등록, 2026-10-06 사용자 요청):
 *    첫 미완으로 건너뛰지 않고 **지금 보는 탭의 다음 칸**으로 간다. 마지막 칸에서는
 *    [완료 · 달력으로]가 등록을 시작한 그 달력·사이드바로 돌려보낸다. 판정은 lib/onboarding-steps.
 *
 *  🚨 **`<Link>`나 `router.push`로 탭을 옮기지 않는다.** 탭 셸은 자기 state로 활성 탭을 들고
 *    있어서 URL만 바꾸면 화면이 안 따라온다(`customer-tabs.tsx:47` 주석이 같은 함정을 적어 뒀다).
 *    반드시 셸의 `goTab`을 부른다 — 미저장 확인창도 그 경로에만 걸려 있다.
 *    (완료 링크는 탭 이동이 아니라 **페이지를 떠나는** 것이라 <a>다 — 셸의 링크 가로채기가 미저장을 묻는다.)
 */
export function OnboardingStrip({ steps, next, complete, sequence }: {
  steps: OnboardingStep[]
  hint: string
  next: OnboardingTab
  complete: boolean
  /** 차례 모드 — 등록을 마치고 돌아갈 주소(`doneHref`)·그 버튼 글자(`doneLabel`)와 판정 재료 */
  sequence?: {
    doneHref: string
    /** 생략하면 「완료 · 달력으로」 — 고객 목록에서 시작한 등록은 「완료」(상세 기본정보로) */
    doneLabel?: string
    state: OnboardingState
    buildings: readonly { is_active?: boolean | null; purpose?: string | null; total_area?: number | null }[]
  }
}) {
  const tabs = useCustomerTabs()
  // 차례 모드면 단계·다음을 **지금 보는 탭** 기준으로 다시 잡는다
  const active = tabs?.activeTab
  const shownSteps = sequence ? sequentialSteps(active, sequence.state) : steps
  const seqNext = sequence ? sequentialNext(active, sequence.state) : null
  const curStep = shownSteps.find(s => s.current)
  const labelOf = (k: OnboardingTab | null) => shownSteps.find(s => s.key === k)?.label ?? ''

  return (
    <div
      data-testid="onboarding-strip"
      data-mode={sequence ? 'sequence' : 'first-gap'}
      className="max-w-3xl flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-brand-line-soft bg-brand-tint px-4 py-2"
    >
      {/* 제목(「고객 등록 완료 — …」)·안내 문구·[안내 닫기]는 2026-10-06 사용자 요청으로 폐지
          (「안내닫기, 안내 만들필요없어」) — 단계 칩과 [다음]·[완료]만 한 줄로 남긴다. */}
      {/* 단계 표시 — 라벨은 탭 라벨과 **글자까지 같다**(같은 것으로 읽히게).
          차례 모드에선 단계 칩을 눌러 그 칸으로 바로 갈 수 있다(되돌아가 고치기). */}
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {shownSteps.map((s, i) => {
          const cls = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-form-2xs font-medium ${
            s.current ? 'bg-brand text-white'
              : s.done ? 'bg-surface text-ink-sub border border-brand-line-soft'
                : 'bg-surface text-ink-meta border border-line'
          }`
          const body = <>{s.done && !s.current && <Check className="size-3 text-green-600" />}{i + 1}. {s.label}</>
          return (
            <li key={s.key} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-ink-meta/50 text-form-2xs">›</span>}
              {sequence && s.key !== 'info' && !s.current ? (
                <button type="button" onClick={() => tabs?.goTab(s.key)}
                  data-testid={`onboarding-step-${s.key}`} data-state={s.done ? 'done' : 'todo'}
                  className={`${cls} hover:border-brand`}>
                  {body}
                </button>
              ) : (
                <span data-testid={`onboarding-step-${s.key}`}
                  data-state={s.current ? 'current' : s.done ? 'done' : 'todo'} className={cls}>
                  {body}
                </span>
              )}
            </li>
          )
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        {sequence ? (
          seqNext ? (
            /* 지금 칸이 비었으면 「건너뛰고」를 앞에 붙인다 — 막지는 않는다(나중에 탭에서 채운다) */
            <button
              type="button" onClick={() => tabs?.goTab(seqNext)} data-testid="onboarding-next"
              className="inline-flex items-center gap-1 h-form-8 rounded-lg bg-brand px-3 text-form-xs font-medium text-white hover:opacity-90"
            >
              {curStep ? `${curStep.done ? '' : '건너뛰고 '}다음: ${labelOf(seqNext)}` : `${labelOf(seqNext)}(으)로`}
              <ArrowRight className="size-3" />
            </button>
          ) : (
            /* ⚠ Link가 아니라 <a>(전체 이동)다 — 소방계획서 탭은 처음 열릴 때 서버 액션을 왕복하는데, 그 사이
               Link(soft)로 떠나면 응답이 이동을 덮어 **관계인 탭으로 되돌아앉았다**(2026-10-06 실화면 프로브:
               탭 전환 직후 클릭 → 이동 실패, 5초 뒤 클릭 → 성공). 상세 머리의 [회차] <a>와 같은 이유.
               미저장 확인은 탭 셸의 캡처 단계 링크 가로채기가 <a>에도 그대로 건다. */
            <a href={sequence.doneHref} data-testid="onboarding-done"
              className="inline-flex items-center gap-1 h-form-8 rounded-lg bg-brand px-3 text-form-xs font-medium text-white hover:opacity-90">
              <Check className="size-3" /> {sequence.doneLabel ?? '완료 · 달력으로'}
            </a>
          )
        ) : (
          /* 「다음」은 늘 **첫 미완**으로 간다 — 이미 채운 칸을 다시 보여주지 않는다 */
          <button
            type="button" onClick={() => tabs?.goTab(next)} data-testid="onboarding-next"
            className="inline-flex items-center gap-1 h-form-8 rounded-lg border border-brand-line bg-surface px-2.5 text-form-xs font-medium text-brand hover:bg-brand-tint"
          >
            {complete ? '소방계획서로' : `${steps.find(s => s.key === next)?.label ?? ''}(으)로`}
            <ArrowRight className="size-3" />
          </button>
        )}
      </div>
    </div>
  )
}
