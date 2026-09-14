'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PlayCircle } from 'lucide-react'
import { confirmPlanItemStageOneAction } from '@/app/(dashboard)/inspections/plan-date-actions'
import { todayKst } from '@/lib/kst-date'

/** 「시작 대기」 — 예정일이 임박했지만 **아직 시작되지 않은 계획 항목**을 점검업무 화면에 세운다.
 *
 *  왜 목록에 섞지 않고 별도 칸인가:
 *   · 아래 표는 `inspections`(= 시작된 점검)이고 여기는 `inspection_plan_items`(= 아직 계획)다.
 *     섞으면 페이지 수·건수(count)가 두 모집단을 합친 값이 되어 페이징이 어긋난다.
 *   · 더 중요한 건 **뜻이 다르다**는 것이다. 계획 행은 「할 수 있다」이고 점검 행은 「하는 중」이다.
 *     같은 표에 두면 진행단계·상태 열이 계획 행에선 전부 빈칸이 되어 「고장난 점검」처럼 보인다.
 *
 *  🚨 **DB 상태를 미리 바꾸지 않는다.** 이 칸은 표시일 뿐이고, 계획 항목은 [시작]을 누를 때까지
 *     `status='confirmed'`·`inspection_id=null` 그대로다. 종전 검토에서 「고객등록 즉시 점검업무 등록」을
 *     택하지 않은 이유가 이것이다 — 즉시 등록은 계획 5,205건을 `completed`로 뒤집고(진척을 못 봄)
 *     점검일자를 등록일로 박아 별지 9호에 잘못된 날짜를 인쇄한다.
 *
 *  [시작]은 고객 상세의 [작성 시작]과 **같은 액션**을 부른다(`confirmPlanItemStageOneAction`) —
 *  날짜 규칙을 두 벌로 두면 어느 문에서 들어왔느냐로 점검일이 갈린다. 오늘이 점검일로 기록된다. */
export type PendingPlanRow = {
  planItemId: string
  customerId: string
  customerName: string
  scheduledDate: string
  /** 예정일까지 남은 일수 — 음수면 경과 */
  dday: number
  badgeLabel: string
  badgeClass: string
  employeeLabel: string | null
}

export function PendingPlanStartList({ rows, total, windowDays, canStart, searchQuery, mainListEmpty }: {
  rows: PendingPlanRow[]
  /** 상한과 무관한 **실제 전체 건수**. 머리글은 이 값을 말한다 —
   *  표시된 행 수를 건수로 적으면 상한에 걸린 순간 화면이 조용히 거짓말을 한다. */
  total: number
  /** 며칠 전부터 세우는가 — 화면에 그대로 적는다(규칙이 안 보이면 사용자는 왜 떴는지 모른다) */
  windowDays: number
  canStart: boolean
  /** 고객명 검색어. **비어 있으면 아무것도 세우지 않는다**(2026-09-14 사용자 결정). */
  searchQuery: string
  /** 아래 점검 업무 목록이 이 검색어로 0건인가 — 「찾는 게 왜 없는지」를 여기서 답한다.
   *  이 화면의 원래 신고가 정확히 그것이었다(지평리56이 점검업무에 없다). */
  mainListEmpty: boolean
}) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  // 🚨 **검색 전에는 아무것도 세우지 않는다**(2026-09-14 사용자 결정).
  //    종전에는 「시작 대기 295건」 요약 줄을 늘 띄웠는데, 그 숫자가 내 담당도 아니고 오늘 할 일도
  //    아닌 전사 누적치라 **읽는 사람을 혼동시켰다**("내가 295건을 해야 하나?"). 검색이라는
  //    질문이 있을 때만 답한다 — 묻지 않았는데 숫자를 들이밀지 않는다.
  if (!searchQuery.trim() || rows.length === 0) return null

  function start(row: PendingPlanRow) {
    setErr('')
    setPendingId(row.planItemId)
    startTransition(async () => {
      // 오늘 = 점검일. 고객 상세 [작성 시작]과 같은 인자 규약이다.
      const res = await confirmPlanItemStageOneAction(row.planItemId, todayKst())
      setPendingId(null)
      if (res.error) { setErr(res.error); return }
      router.refresh()
    })
  }

  // 경과 건수는 **표시된 행** 기준이다 — 전체(total)에서 몇 건이 경과인지는 여기서 알 수 없으므로
  // 상한에 걸렸을 때는 「표시분 기준」임을 라벨에 드러낸다(모르는 것을 아는 척하지 않는다).
  const capped = total > rows.length
  const overdue = rows.filter(r => r.dday < 0).length

  return (
    <div
      data-testid="pending-plan-start"
      className="bg-surface rounded-xl border border-amber-300 overflow-hidden"
    >
      <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
        <div className="flex items-center gap-2 flex-wrap">
          <PlayCircle className="size-4 text-amber-700" />
          <span className="text-sm font-semibold text-amber-900">
            「{searchQuery}」 시작 대기 {total}건
          </span>
          {capped && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
              급한 {rows.length}건만 표시
            </span>
          )}
          {overdue > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
              예정일 경과 {overdue}건{capped ? '(표시분)' : ''}
            </span>
          )}
        </div>
        {/* 「왜 아래에 없는가」에 답한다 — 이 화면의 원래 신고가 그것이었다 */}
        <p className="text-xs text-amber-800 mt-1">
          {mainListEmpty
            ? <>아래 점검 업무 목록에 <b>없는 이유</b>: 계획은 있으나 <b>아직 시작 전</b>입니다. </>
            : <>아래 목록에 없는 <b>시작 전</b> 계획이 더 있습니다. </>}
          예정일 <b>{windowDays}일 전</b>부터 집계하며 지난 건은 계속 남습니다 —
          [시작]을 누르면 <b>오늘이 점검일</b>로 기록되고 점검 업무로 등록됩니다.
        </p>
      </div>

      {err && (
        <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-b border-red-200">{err}</div>
      )}

      <table className="w-full text-sm">
        <tbody className="divide-y divide-line">
          {rows.map(row => {
            const busy = isPending && pendingId === row.planItemId
            return (
              <tr key={row.planItemId} className="hover:bg-paper transition-colors">
                <td className="px-4 py-3">
                  <span className="font-medium text-ink">{row.customerName}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${row.badgeClass}`}>
                    {row.badgeLabel}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">
                  <span className="text-ink-strong">{row.scheduledDate}</span>
                  <span className={`ml-1.5 font-semibold ${row.dday < 0 ? 'text-red-500' : 'text-amber-700'}`}>
                    {row.dday < 0 ? `경과 ${-row.dday}일` : row.dday === 0 ? '오늘' : `D-${row.dday}`}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-ink">
                  {row.employeeLabel ?? <span className="text-red-500">미배정</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {canStart && (
                    <button
                      type="button"
                      onClick={() => start(row)}
                      disabled={isPending}
                      data-testid="pending-plan-start-btn"
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition"
                    >
                      {busy && <Loader2 className="size-3.5 animate-spin" />}
                      시작
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
