'use client'

import { AlertTriangle, ArrowRight, Loader2, X } from 'lucide-react'
import type { AnchorPreview } from '@/app/(dashboard)/customers/actions'

const mo = (m: number) => `${m}월`

/** 법정 시기 문자열 — 모달 표시와 **변화 판정**이 같은 값을 봐야 한다(사본을 두면 갈린다) */
export const monthsKey = (p: AnchorPreview) =>
  p.months.map(m => `${m.planType.endsWith('종합') ? '종합' : '작동'} ${mo(m.month)}`).join(' · ') || '—'

/** 이 변경이 **알릴 만한가** — 아니면 조용히 저장한다 (2026-09-14 사용자 결정).
 *
 *  왜 관문이 필요한가: 종전에는 기산점 필드(사용승인일·점검일자·점검종류)를 건드리기만 하면
 *  무조건 모달이 떴다. 그래서 계획이 **한 건도 안 바뀌는** 입력 — 예컨대 사용승인일의 연도만
 *  정정(월·일이 같으면 `plannedDateFor` 결과가 같다) — 에도 「저장하면 이렇게 바뀝니다」가 뜨고,
 *  본문엔 「바뀌는 계획 항목이 없습니다」라고 적혀 있었다. 알릴 것이 없는데 띄운 것이다.
 *  정상 입력을 매번 막아 세우면 사람은 곧 내용을 안 읽고 누르게 되고, **정작 바뀔 때의 경고까지
 *  같이 죽는다.** 경고는 드물어야 읽힌다.
 *
 *  ⚠ **최초점검 기한은 예외로 남긴다.** 계획 항목이 하나도 안 바뀌어도 사용승인일+60일 창이
 *    새로 열렸다면 알린다 — 놓치면 법정 미이행인데 그 사실은 「계획 변화」 목록에 안 나타난다.
 *    단 **아직 열려 있는**(기한이 오늘 이후) 창만 센다. 지난 창까지 세면 옛 사용승인일을
 *    정정할 때마다 다시 떠서 관문이 무의미해진다(실측: 2001년 승인일도 창을 들고 온다).
 */
export function anchorPreviewWorthShowing(
  before: AnchorPreview, after: AnchorPreview, todayISO: string,
): boolean {
  const ops = after.creates.length + after.promotes.length + after.demotes.length + after.removes.length
  if (ops > 0) return true
  if (monthsKey(before) !== monthsKey(after)) return true
  const w = after.initialWindow
  if (w && w.to >= todayISO && w.to !== before.initialWindow?.to) return true
  return false
}

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
  before, after, isPending, onConfirm, onCancel,
}: {
  before: AnchorPreview
  after: AnchorPreview
  isPending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const monthsOf = monthsKey
  const changed = monthsOf(before) !== monthsOf(after)
  const nothing = after.creates.length + after.promotes.length + after.demotes.length + after.removes.length === 0

  return (
    <div className="fixed inset-0 bg-black/25 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-surface rounded-2xl shadow-xl border border-line w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-form-lg-title font-semibold text-ink">저장하면 이렇게 바뀝니다</h2>
          <button onClick={onCancel} className="text-ink-sub hover:text-ink"><X className="size-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* 법정 시기 — 가장 먼저 봐야 하는 것 */}
          <div>
            <p className="text-form-xs text-ink-meta mb-1">법정 점검 시기</p>
            <div className="flex items-center gap-2 text-form-base">
              <span className={changed ? 'text-ink-sub line-through' : 'text-ink font-medium'}>{monthsOf(before)}</span>
              {changed && <><ArrowRight className="size-3.5 text-ink-faint" /><span className="text-ink font-semibold">{monthsOf(after)}</span></>}
            </div>
            <p className="text-form-xs text-ink-meta mt-1">
              기산점 {after.anchorSource} {after.anchorDate ?? '(없음)'}
              {after.divergent && <span className="text-orange-600"> · ⚠ 점검일자와 달이 다릅니다</span>}
            </p>
          </div>

          {/* 최초점검 — 놓치면 과태료라 눈에 띄게 */}
          {after.initialWindow && (
            <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 px-3 py-2">
              <p className="text-form-sm text-orange-700 dark:text-orange-400 flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span><b>최초점검</b> 기한 <b>{after.initialWindow.to}</b> — 사용승인일부터 60일 이내에 종합점검을 실시해야 합니다</span>
              </p>
            </div>
          )}

          {/* 계획 변화 — op 종류별 */}
          <div>
            <p className="text-form-xs text-ink-meta mb-1.5">계획 변화</p>
            {nothing ? (
              <p className="text-form-sm text-ink-sub">바뀌는 계획 항목이 없습니다.</p>
            ) : (
              <ul className="rounded-lg bg-brand-tint divide-y divide-brand-line-soft text-form-sm">
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
            <p className="text-form-xs text-ink-meta">
              이미 시작·완료된 점검 {after.keptStarted.length}건은 <b>그대로 둡니다</b>
              {' '}({after.keptStarted.map(k => `${k.year}-${String(k.month).padStart(2, '0')} ${kind(k.planType)}`).join(', ')}) —
              수행한 점검의 종류를 나중에 바꾸면 법정 서식이 사실과 달라집니다.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 px-6 py-4 border-t border-line">
          {/* 확정해지/유지 선택(B안)은 2026-09-12 폐지 — 미시작 전건이 기준일을 자동 동행한다 */}
          <button onClick={() => onConfirm()} disabled={isPending}
            className="h-form-10 rounded-lg bg-brand hover:bg-brand-strong text-white text-form-base font-medium flex items-center justify-center disabled:opacity-50">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : '이대로 저장'}
          </button>
          <button onClick={onCancel} disabled={isPending}
            className="h-form-9 rounded-lg text-form-sm text-ink-meta hover:text-ink-sub disabled:opacity-50">
            취소 (변경하지 않음)
          </button>
        </div>
      </div>
    </div>
  )
}

/** 상시 배지 — 고객 상세에 늘 보인다. 별지 9호 표기와 같은 성격이다(늘 보이니 잘못을 눈치챈다).
 *  순수 계산이라 서버 왕복이 없다. */
export function LegalScheduleBadge({ months, anchorSource, anchorDate, divergent, initialDueDate, provisional }: {
  months: Array<{ seq: number; month: number; planType: string }>
  anchorSource: string
  anchorDate: string | null
  divergent: boolean
  /** 최초점검 기한 — 지났거나 없으면 null */
  initialDueDate?: string | null
  /** 기산점이 **잠정인가** — 사용승인일이 없어 점검일자가 대신 들어앉은 상태(`isProvisionalAnchor`).
   *  🚨 사람이 일부러 고른 예외(`plan_anchor_manual=true`)와 **다른 상황**인데 종전엔 둘 다
   *    「기산점 점검일자」로만 보여 구별이 안 됐다 — 그래서 「사용승인일을 아직 못 받은 고객」을
   *    찾을 방법이 이 제품에 없었다(실측 56명·활성의 18%). */
  provisional?: boolean
}) {
  if (!anchorDate) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-form-xs" data-testid="legal-schedule-badge">
      <span className="text-ink-sub">
        법정 시기{' '}
        <b className="text-ink">
          {months.map(m => `${m.planType.endsWith('종합') ? '종합' : '작동'} ${mo(m.month)}`).join(' · ')}
        </b>
      </span>
      <span className="text-ink-meta">기산점 {anchorSource} {anchorDate}</span>
      {/* 잠정이면 **법정 시기라는 말 자체가 아직 참이 아니다** — 그 사실을 같은 줄에서 말한다.
          일정은 이미 생성돼 굴러가고 있으므로 경고가 아니라 「아직 안 받았다」는 표시다. */}
      {provisional && (
        <span data-testid="anchor-provisional" className="text-amber-700 font-medium"
              title="사용승인일이 없어 점검일자로 잠정 배치된 상태입니다. 사용승인일을 넣으면 법정 자리로 자동 재배치됩니다.">
          ⚠ 잠정 — 사용승인일 미입력
        </span>
      )}
      {divergent && <span className="text-orange-600">⚠ 점검일자와 달이 다름</span>}
      {initialDueDate && (
        <span className="text-orange-700 dark:text-orange-400 font-medium">
          🔴 최초점검 기한 {initialDueDate}
        </span>
      )}
    </div>
  )
}
