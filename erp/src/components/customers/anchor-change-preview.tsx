'use client'

import { AlertTriangle, ArrowRight, Loader2, X } from 'lucide-react'
import type { AnchorPreview } from '@/app/(dashboard)/customers/actions'

const mo = (m: number) => `${m}월`
const kind = (planType: string | null) =>
  planType?.startsWith('special_') ? (planType.endsWith('종합') ? '종합점검' : '작동점검')
  : planType === 'monthly' ? '정기점검' : (planType ?? '—')

/** 저장 **전** "이렇게 바뀝니다" 미리보기.
 *
 *  왜 필요한가: 사용승인일을 고치면 법정 점검 달이 통째로 옮겨가는데, 종전에는 **저장하고 나서야**
 *  알 수 있었다. 재건축처럼 사용승인일이 바뀌는 경우 최초점검 기한(60일)까지 함께 열려서,
 *  모르고 지나가면 법정 미이행이 된다.
 *
 *  ⚠ 여기 뜨는 값은 전부 서버의 `planReconcile` 결과다 — **실행이 쓰는 그 함수**다.
 *    화면이 따로 계산하면 "보여준 것과 다른 일이 벌어진다". */
export function AnchorChangePreview({
  before, after, confirmedItems = [], isPending, onConfirm, onCancel,
}: {
  before: AnchorPreview
  after: AnchorPreview
  /** 기준일이 바뀌어도 자동으로 안 바뀌는 확정 일정 — 있으면 여기서 **함께** 묻는다.
   *  종전엔 저장 → 확정팝업으로 두 번 멈췄다. 결정은 한 번이면 된다. */
  confirmedItems?: Array<{ id: string; year: number; month: number; sequence_num: number; plan_type: string | null; scheduled_date: string | null }>
  isPending?: boolean
  onConfirm: (decision?: 'unconfirm' | 'keep') => void
  onCancel: () => void
}) {
  const monthsOf = (p: AnchorPreview) =>
    p.months.map(m => `${m.planType.endsWith('종합') ? '종합' : '작동'} ${mo(m.month)}`).join(' · ') || '—'
  const changed = monthsOf(before) !== monthsOf(after)
  const nothing = after.creates.length + after.promotes.length + after.demotes.length + after.removes.length === 0

  return (
    <div className="fixed inset-0 bg-black/25 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-surface rounded-2xl shadow-xl border border-line w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-semibold text-ink">저장하면 이렇게 바뀝니다</h2>
          <button onClick={onCancel} className="text-ink-sub hover:text-ink"><X className="size-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* 법정 시기 — 가장 먼저 봐야 하는 것 */}
          <div>
            <p className="text-[11px] text-ink-meta mb-1">법정 점검 시기</p>
            <div className="flex items-center gap-2 text-sm">
              <span className={changed ? 'text-ink-sub line-through' : 'text-ink font-medium'}>{monthsOf(before)}</span>
              {changed && <><ArrowRight className="size-3.5 text-ink-faint" /><span className="text-ink font-semibold">{monthsOf(after)}</span></>}
            </div>
            <p className="text-[11px] text-ink-meta mt-1">
              기산점 {after.anchorSource} {after.anchorDate ?? '(없음)'}
              {after.divergent && <span className="text-orange-600"> · ⚠ 점검계획일과 달이 다릅니다</span>}
            </p>
          </div>

          {/* 최초점검 — 놓치면 과태료라 눈에 띄게 */}
          {after.initialWindow && (
            <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 px-3 py-2">
              <p className="text-xs text-orange-700 dark:text-orange-400 flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span><b>최초점검</b> 기한 <b>{after.initialWindow.to}</b> — 사용승인일부터 60일 이내에 종합점검을 실시해야 합니다</span>
              </p>
            </div>
          )}

          {/* 계획 변화 — op 종류별 */}
          <div>
            <p className="text-[11px] text-ink-meta mb-1.5">계획 변화</p>
            {nothing ? (
              <p className="text-xs text-ink-sub">바뀌는 계획 항목이 없습니다.</p>
            ) : (
              <ul className="rounded-lg bg-brand-tint divide-y divide-brand-line-soft text-xs">
                {after.creates.map((o, i) => (
                  <li key={`c${i}`} className="px-3 py-1.5 text-emerald-700 dark:text-emerald-400">
                    + {o.year}-{String(o.month).padStart(2, '0')} {kind(o.planType)} <span className="text-ink-meta">(신규)</span>
                  </li>
                ))}
                {after.promotes.map((o, i) => (
                  <li key={`p${i}`} className="px-3 py-1.5 text-ink">
                    ↻ {o.year}-{String(o.month).padStart(2, '0')} {kind(o.from)} → <b>{kind(o.planType)}</b>
                  </li>
                ))}
                {after.demotes.map((o, i) => (
                  <li key={`d${i}`} className="px-3 py-1.5 text-ink-sub">
                    ↻ {o.year}-{String(o.month).padStart(2, '0')} {kind(o.from)} → 정기점검
                  </li>
                ))}
                {after.removes.map((o, i) => (
                  <li key={`r${i}`} className="px-3 py-1.5 text-red-600 dark:text-red-400">
                    − {o.year}-{String(o.month).padStart(2, '0')} {kind(o.from)} <span className="text-ink-meta">(삭제)</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 불가침 — 이미 수행한 점검은 안 건드린다는 걸 명시한다 */}
          {after.keptStarted.length > 0 && (
            <p className="text-[11px] text-ink-meta">
              이미 시작·완료된 점검 {after.keptStarted.length}건은 <b>그대로 둡니다</b>
              {' '}({after.keptStarted.map(k => `${k.year}-${String(k.month).padStart(2, '0')} ${kind(k.planType)}`).join(', ')}) —
              수행한 점검의 종류를 나중에 바꾸면 법정 서식이 사실과 달라집니다.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 px-6 py-4 border-t border-line">
          {confirmedItems.length > 0 ? (
            <>
              <p className="text-[11px] text-ink-sub mb-1">
                ⚠ <b>이미 확정된 일정 {confirmedItems.length}건</b>은 기준일을 바꿔도 자동으로 안 옮겨집니다
                {' '}({confirmedItems.map(i => `${i.year}-${String(i.month).padStart(2, '0')}`).join(', ')}).
              </p>
              <button onClick={() => onConfirm('unconfirm')} disabled={isPending}
                className="h-10 rounded-lg bg-brand hover:bg-brand-strong text-white text-sm font-medium flex items-center justify-center disabled:opacity-50">
                {isPending ? <Loader2 className="size-4 animate-spin" /> : `확정해지 후 저장 (${confirmedItems.length}건 포함)`}
              </button>
              <button onClick={() => onConfirm('keep')} disabled={isPending}
                className="h-10 rounded-lg border border-line text-sm text-ink-sub hover:bg-paper disabled:opacity-50">
                확정 유지하고 저장 — 미확정만 재계산
              </button>
            </>
          ) : (
            <button onClick={() => onConfirm()} disabled={isPending}
              className="h-10 rounded-lg bg-brand hover:bg-brand-strong text-white text-sm font-medium flex items-center justify-center disabled:opacity-50">
              {isPending ? <Loader2 className="size-4 animate-spin" /> : '이대로 저장'}
            </button>
          )}
          <button onClick={onCancel} disabled={isPending}
            className="h-9 rounded-lg text-xs text-ink-meta hover:text-ink-sub disabled:opacity-50">
            취소 (변경하지 않음)
          </button>
        </div>
      </div>
    </div>
  )
}

/** 상시 배지 — 고객 상세에 늘 보인다. 별지 9호 표기와 같은 성격이다(늘 보이니 잘못을 눈치챈다).
 *  순수 계산이라 서버 왕복이 없다. */
export function LegalScheduleBadge({ months, anchorSource, anchorDate, divergent, initialDueDate }: {
  months: Array<{ seq: number; month: number; planType: string }>
  anchorSource: string
  anchorDate: string | null
  divergent: boolean
  /** 최초점검 기한 — 지났거나 없으면 null */
  initialDueDate?: string | null
}) {
  if (!anchorDate) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" data-testid="legal-schedule-badge">
      <span className="text-ink-sub">
        법정 시기{' '}
        <b className="text-ink">
          {months.map(m => `${m.planType.endsWith('종합') ? '종합' : '작동'} ${mo(m.month)}`).join(' · ')}
        </b>
      </span>
      <span className="text-ink-meta">기산점 {anchorSource} {anchorDate}</span>
      {divergent && <span className="text-orange-600">⚠ 점검계획일과 달이 다름</span>}
      {initialDueDate && (
        <span className="text-orange-700 dark:text-orange-400 font-medium">
          🔴 최초점검 기한 {initialDueDate}
        </span>
      )}
    </div>
  )
}
