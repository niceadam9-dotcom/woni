'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, ArrowRight, Sparkles, X, ChevronUp, ChevronDown } from 'lucide-react'
import { useCustomerTabs } from '@/components/customers/customer-tabs'

/** 고객 온보딩 진행 배너 (소방계획서_7 H-25 / §4-D 국면 1)
 *  등록 성공 → ?tab=plan&onboarding=1 진입 시에만 표시. 필수 최소만 강제된 뒤
 *  ① 기본정보(빠른 입력 준비율) ② 관계인(대표) ③ 설비 대장(설치 √·제원)
 *  ④ 지도·사진(자산) 4단계를 "권장·나중에"로 안내한다. 강제 아님 — 미완성 큐(H-26)가
 *  대시보드에서 계속 리마인드하므로 [나중에]=배너 접기, 완료=배너 닫기(쿼리 제거).
 *
 *  각 항목 [입력하러 →]는 소방계획서 탭 내부 서식(설비 대장=1.4)/카드(지도·사진)로 이동하고,
 *  관계인은 탭 셸을 통해 관계인 탭으로 이동한다. 저침습 — 데이터·서버 액션 무변경. */

export type OnboardingStep = {
  key: 'basic' | 'contacts' | 'facilities' | 'assets'
  label: string
  detail: string          // 진행 상태 요약 (예: "8/23 준비", "설치 5종 · 제원 2종")
  done: boolean
  /** 소방계획서 탭 내부 이동 대상 — 'form:1.4'=서식 딥링크, 'asset'=지도·사진 카드 스크롤, 'tab:contacts'=관계인 탭 */
  action: 'form:1.1' | 'form:1.4' | 'asset' | 'tab:contacts' | 'tab:info'
}

export function PlanOnboardingBanner({
  steps,
  onGoForm,
}: {
  steps: OnboardingStep[]
  onGoForm: (formKey: string) => void   // PlanTabView.select 위임 (서식 전체 모드 전환 포함)
}) {
  const router = useRouter()
  const tabsShell = useCustomerTabs()
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const doneCount = steps.filter(s => s.done).length
  const total = steps.length
  const allDone = doneCount >= total

  function close() {
    // 쿼리(?onboarding=1) 제거로 새로고침 후에도 배너가 사라지고, 즉시 숨김도 반영. 데이터 무변경.
    const url = new URL(window.location.href)
    url.searchParams.delete('onboarding')
    window.history.replaceState(null, '', url.toString())
    setDismissed(true)
  }

  if (dismissed) return null

  function goStep(step: OnboardingStep) {
    if (step.action === 'form:1.1' || step.action === 'form:1.4') {
      onGoForm(step.action.slice(5))
      return
    }
    if (step.action === 'asset') {
      // 지도·사진은 서식 전체 트리의 'assets' 노드로 이관 (2026-08-05) — 모드 전환 포함 위임
      onGoForm('assets')
      return
    }
    if (step.action === 'tab:contacts' || step.action === 'tab:info') {
      const t = step.action.slice(4)
      if (tabsShell) tabsShell.goTab(t)
      else router.push(`${window.location.pathname}?tab=${t}`)
    }
  }

  return (
    <div className="rounded-xl border border-[#c3bdf5] bg-gradient-to-br from-[#f5f4ff] to-white p-4 shadow-[rgba(18,43,165,0.06)_0px_1px_2px]">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-[#7b68ee] shrink-0" />
        <p className="text-sm font-semibold text-[#090c1d]">
          {allDone ? '온보딩 완료 🎉' : '고객 등록 완료 — 이어서 입력하면 문서를 바로 생성할 수 있어요'}
        </p>
        <span className="text-[11px] font-medium text-[#7b68ee] ml-1">{doneCount}/{total}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] text-[#514b81] hover:bg-[#eceafd] transition-colors"
            title={collapsed ? '펼치기' : '나중에 — 접기 (미완성 큐에서 계속 안내됩니다)'}
          >
            {collapsed ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
            {collapsed ? '펼치기' : '나중에'}
          </button>
          <button
            type="button"
            onClick={close}
            className="inline-flex items-center justify-center size-7 rounded-lg text-[#b0acd6] hover:text-[#514b81] hover:bg-[#eceafd] transition-colors"
            title="온보딩 배너 닫기"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 max-w-40 rounded-full bg-[#eceafd] overflow-hidden">
              <div className="h-full rounded-full bg-[#7b68ee] transition-all" style={{ width: `${total > 0 ? Math.round((doneCount / total) * 100) : 0}%` }} />
            </div>
            {!allDone && <span className="text-[10px] text-[#b0acd6]">필수 정보는 등록됨 — 아래는 권장 (나중에 입력해도 됩니다)</span>}
          </div>

          <ol className="mt-3 space-y-1.5">
            {steps.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/70 transition-colors">
                {s.done
                  ? <CheckCircle2 className="size-4 text-green-500 shrink-0" />
                  : <Circle className="size-4 text-[#c8c4d0] shrink-0" />}
                <span className="text-[11px] font-medium text-[#847ba8] w-4 shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-medium ${s.done ? 'text-[#514b81]' : 'text-[#090c1d]'}`}>{s.label}</p>
                  <p className="text-[10px] text-[#b0acd6] truncate">{s.detail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => goStep(s)}
                  className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-medium shrink-0 transition-colors ${
                    s.done
                      ? 'text-[#7b68ee] hover:bg-[#eceafd]'
                      : 'bg-[#7b68ee] text-white hover:bg-[#6647f0]'
                  }`}
                >
                  {s.done ? '확인' : '입력하러'} <ArrowRight className="size-3" />
                </button>
              </li>
            ))}
          </ol>

          {allDone && (
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-green-700">모든 권장 항목이 입력됐습니다.</p>
              <button
                type="button"
                onClick={close}
                className="inline-flex items-center gap-1 h-7 px-3 rounded-lg bg-green-500 hover:bg-green-600 text-white text-[11px] font-medium transition-colors"
              >
                온보딩 완료 · 배너 닫기
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
