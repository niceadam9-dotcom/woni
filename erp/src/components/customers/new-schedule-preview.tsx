'use client'

import { CalendarCheck, AlertTriangle } from 'lucide-react'
import type { NewSchedulePreview } from '@/app/(dashboard)/customers/actions'
import { ymdWithWeekday, weekdayKo } from '@/lib/kst-date'

/** 고객 **등록 화면**의 법정 일정 미리보기 (2026-09-14 사용자 요청 — 「알고 입력할 수 있게」).
 *
 *  이 화면이 생긴 이유: 등록 폼은 점검일자를 **필수로 받으면서** "이 날짜의 월·일 기준으로
 *  일정이 확정됩니다"라고 안내했는데, 사용승인일도 필수라 신규 고객은 `manual=false`로 태어나
 *  **항상 사용승인일이 이긴다**. 입력한 날짜는 한 칸도 안 쓰이는데 화면은 그 사실을 말하지 않았다.
 *  실측(스테이징): 법정 축 고객 162명 중 158명이 입력값과 다른 날짜로 일정이 서 있었다.
 *
 *  ⭐ **요일을 반드시 함께 찍는다.** 법정 예정일은 토·일·공휴일이면 영업일로 밀리는데, 그러면
 *     "사용승인일이 26일인데 왜 28일인가"라는 질문이 돌아온다(실제로 지평리56에서 그랬다).
 *     밀린 경우엔 원래 날짜와 그 요일까지 적어 **이유가 화면에서 끝나게** 한다. */
const kindLabel = (planType: string) =>
  planType.endsWith('종합') ? '종합점검' : planType.endsWith('작동') ? '작동점검' : planType

export function NewSchedulePreviewBox({ preview, loading, anchorManual, onToggleManual, canOverride }: {
  preview: NewSchedulePreview | null
  loading: boolean
  anchorManual: boolean
  onToggleManual: (v: boolean) => void
  /** 법정 축을 벗어나는 예외를 켤 수 있는가 (2026-09-14 사용자 결정: 전 직원 허용) */
  canOverride: boolean
}) {
  if (loading) {
    return (
      <div data-testid="new-schedule-preview" className="mt-2 rounded-lg border border-line bg-paper px-3 py-2 text-form-xs text-ink-meta">
        법정 점검 일정을 계산하는 중…
      </div>
    )
  }
  // 아직 아무 날짜도 안 쳤을 때도 **자리를 잡는다** — 상자가 나중에 튀어나오면 못 보고 지나친다.
  // 기산점이 없다 = 사용승인일·점검일자 둘 다 비었다.
  if (!preview || !preview.anchorDate) {
    return (
      <div data-testid="new-schedule-preview" className="mt-2 rounded-lg border border-line bg-paper px-3 py-2 text-form-xs text-ink-meta">
        사용승인일 또는 점검일자를 입력하면 법정 점검 일정이 여기 표시됩니다.
      </div>
    )
  }

  const ignored = preview.ignoredAnchorDate
  const pastStart = preview.pastAnchorStart
  const tone = (ignored || pastStart) ? 'border-amber-300 bg-amber-50' : 'border-brand-line-soft bg-brand-tint'

  return (
    <div data-testid="new-schedule-preview" className={`mt-2 rounded-lg border px-3 py-2.5 ${tone}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <CalendarCheck className="size-3.5 text-brand shrink-0" />
        <span className="text-form-xs font-semibold text-ink">이 고객의 법정 점검 일정</span>
      </div>

      {/* 기산점 — 어느 날짜가 실제로 쓰이는지, 그리고 그 출처 */}
      <p className="text-form-xs text-ink-sub">
        기산점 <b className="text-ink">{preview.anchorSource} {ymdWithWeekday(preview.anchorDate)}</b>
        {preview.anchorIsApproval && (
          <span className="text-ink-meta"> · 시행규칙 [별표 3] — 이 날이 속하는 달에 종합점검</span>
        )}
      </p>

      {/* 예정일 — 요일 병기 + 밀린 이유 */}
      <ul className="mt-1.5 space-y-0.5" data-testid="new-schedule-rows">
        {preview.rows.map(r => (
          <li key={`${r.year}-${r.month}-${r.planType}`} className="text-form-xs text-ink">
            <span className="text-ink-meta">{r.year}</span>{' '}
            <b>{kindLabel(r.planType)}</b>{' '}
            <b className="text-brand">{ymdWithWeekday(r.date)}</b>
            {r.shiftedFrom && (
              <span className="text-ink-meta">
                {' '}← {r.shiftedFrom.slice(5)}이 {weekdayKo(r.shiftedFrom)}요일이라 영업일로 옮김
              </span>
            )}
          </li>
        ))}
      </ul>

      {preview.initialDue && (
        <p className="mt-1.5 text-form-xs text-orange-700 font-medium">
          🔴 최초점검 기한 {ymdWithWeekday(preview.initialDue)} — 사용승인일부터 60일 이내에 종합점검
        </p>
      )}

      {/* 과거·오늘 점검일자 = 점검 사실 — 등록 즉시 그 날짜로 1차가 시작된다(2026-09-20 사용자 확정).
          이때는 「안 쓰입니다」 고지가 거짓이 되므로 서버가 ignored를 비워 보낸다(배타). */}
      {pastStart && (
        <p className="mt-2 pt-2 border-t border-amber-200 text-form-xs text-amber-900 flex items-start gap-1.5">
          <AlertTriangle className="size-3.5 shrink-0 mt-px" />
          <span data-testid="past-anchor-start-notice">
            점검일자 <b>{ymdWithWeekday(pastStart)}</b>는 지난(또는 오늘) 날짜입니다 —
            등록과 동시에 <b>이 날짜 그대로</b> 1차 점검이 시작되어 점검업무·점검달력에 실립니다.
          </span>
        </p>
      )}

      {/* 입력값이 안 쓰이면 그 사실을 말한다 — 이게 이 상자의 핵심이다.
          ⚠ 체크를 켜면 `ignored`가 null이 되므로, **켜진 상태에서도 이 칸을 남겨야** 해제할 수 있다.
            (처음엔 `ignored &&`로만 감싸 두었다가 체크하는 순간 스위치가 사라져 되돌릴 수 없었다)
          ⚠ 과거 날짜(pastStart)에서도 남긴다 — 1차는 어차피 입력값으로 시작하지만, 이 체크는
            **차기 회차의 기산 축**(사용승인일 vs 점검일자)을 정한다. pastStart가 ignored를 비우므로
            여기서 빼면 과거 날짜를 넣는 순간 예외 스위치가 사라진다(E2E 예외저장이 실제로 죽었다). */}
      {(ignored || anchorManual || (pastStart && preview.anchorIsApproval)) && (
        <div className="mt-2 pt-2 border-t border-amber-200">
          {ignored && (
            <p className="text-form-xs text-amber-900 flex items-start gap-1.5">
              <AlertTriangle className="size-3.5 shrink-0 mt-px" />
              <span data-testid="anchor-ignored-notice">
                입력하신 점검일자 <b>{ymdWithWeekday(ignored)}</b>은 일정에 쓰이지 않습니다 —
                법정 기산점은 사용승인일이기 때문입니다.
              </span>
            </p>
          )}
          {canOverride && (
            <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={anchorManual}
                onChange={e => onToggleManual(e.target.checked)}
                data-testid="anchor-manual-toggle"
                className="accent-brand"
              />
              <span className="text-form-xs text-ink">
                그래도 <b>내가 입력한 점검일자</b>로 잡겠습니다
                <span className="text-ink-meta"> (법정 시기를 벗어날 수 있습니다)</span>
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  )
}
