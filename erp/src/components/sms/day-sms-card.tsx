'use client'

import { useEffect, useState } from 'react'
import { Loader2, MessageSquare, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { getDaySmsSummaryAction } from '@/app/(dashboard)/inspections/sms-actions'

/** 달력 날짜 패널 맨 위 「이 날 문자」 카드 (2026-09-29 사용자 요청)
 *
 *  「날짜를 선택하여 클릭 후 메시지를 보낼지를 선택할 수 있도록」 — 날짜를 누르면 **보낼지 말지부터**
 *  보인다. 종전엔 [사전안내 문자]가 [전체 완료]·[날짜 이동]과 같은 줄·같은 크기로 섞여 있었고,
 *  몇 곳에 보낼 수 있는지·이미 보냈는지는 눌러 봐야 알았다.
 *
 *  ⛔ 확인 창을 띄우지 않는다. 날짜 클릭은 대부분 일정 확인이다 — 매번 "보낼까요?"를 닫게 하면
 *    카드가 아니라 방해물이다. 보내지 않으려면 **아무것도 안 누르면 된다**.
 *  ⛔ 이 카드는 대상을 정하지 않는다. 발송 창의 목록은 여전히 서버가 만든 그날 전체이고(Q-14),
 *    여기서 넘기는 것은 「미리 체크할 고객」뿐이다.
 */

type Summary = {
  date: string; total: number; sentCount: number
  unsentCustomerIds: string[]; messageCount: number
  blocked: Array<{ customerName: string; reason: string }>
}

const btnOutline = 'text-form-xs font-medium text-brand border border-brand-line rounded-lg px-2.5 py-1 hover:bg-surface transition-colors inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-40'

export function DaySmsCard({ date, reloadKey, selectMode, canSelect, onSend, onToggleSelect }: {
  date: string
  /** 값이 바뀌면 다시 센다 — 방금 보낸 곳이 「아직 안 보냄」에 남아 있으면 재발송을 권하는 셈이다 */
  reloadKey: number
  selectMode: boolean
  /** 골라 보낼 만큼 방문 행이 있는가(2곳 이상) */
  canSelect: boolean
  /** 아직 안 보낸 곳만 체크된 채 발송 창을 연다 */
  onSend: (unsentCustomerIds: string[]) => void
  onToggleSelect: () => void
}) {
  const [data, setData] = useState<Summary | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    setData(null); setErr('')
    getDaySmsSummaryAction(date)
      .then(res => {
        if (!alive) return
        if ('error' in res && res.error) { setErr(res.error); return }
        setData(res as Summary)
      })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [date, reloadKey])

  const unsent = data?.unsentCustomerIds.length ?? 0
  // 보낼 수 있는 방문이 하나도 없고 막힌 곳도 없으면 말할 것이 없다 — 빈 날짜에 카드를 세우지 않는다
  if (data && data.total === 0) return null

  return (
    <div data-testid="day-sms-card" data-state={err ? 'error' : !data ? 'loading' : unsent > 0 ? 'unsent' : 'done'}
      className="mt-2 rounded-xl border border-brand-line-soft bg-brand-tint px-3 py-2.5">
      {!data && !err && (
        <p className="flex items-center gap-1.5 text-form-xs text-ink-sub">
          <Loader2 className="size-3.5 animate-spin" /> 이 날 보낼 문자를 확인하는 중…
        </p>
      )}
      {err && (
        <p className="flex items-start gap-1.5 text-form-xs text-red-700">
          <AlertTriangle className="size-3.5 shrink-0 mt-px" /> 문자 대상을 확인하지 못했습니다 — {err}
        </p>
      )}
      {data && (
        <>
          <p className="flex items-center gap-1.5 text-xs text-ink">
            {unsent > 0
              ? <MessageSquare className="size-3.5 text-brand shrink-0" />
              : <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />}
            <span data-testid="day-sms-card-text">
              이 날 방문 <b>{data.total}곳</b>
              {unsent > 0
                ? <> · 아직 안 보냄 <b className="text-brand">{unsent}곳</b></>
                : data.sentCount > 0
                  ? <> · 보낼 수 있는 {data.sentCount}곳 모두 보냄 ✓</>
                  : <> · 보낼 수 있는 곳이 없습니다</>}
            </span>
          </p>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {/* ⚠ 채우지 않는다 — 이 패널에서 채움 버튼은 [이 날짜로 고객 등록] 하나뿐이어야 뜻이 산다
                (test-provisional-anchor ⑤). 카드 바탕이 이미 이 버튼을 띄워 준다. */}
            {unsent > 0 && (
              <button data-testid="calendar-sms-day" className={`${btnOutline} bg-surface`}
                disabled={selectMode}
                onClick={() => onSend(data.unsentCustomerIds)}
                title="아직 안 보낸 곳만 체크된 채 발송 창이 열립니다 — 거기서 확인하고 보냅니다">
                <MessageSquare className="size-3" /> {unsent}곳에 보내기
              </button>
            )}
            {canSelect && (
              <button data-testid="day-sms-toggle" onClick={onToggleSelect}
                className={selectMode
                  ? 'text-form-xs font-medium border border-brand bg-brand text-white rounded-lg px-2.5 py-1 inline-flex items-center gap-1 whitespace-nowrap'
                  : btnOutline}
                title="이 날짜에 방문하는 고객 중 골라서 문자를 보냅니다">
                {selectMode ? '선택 취소' : '골라서 보내기'}
              </button>
            )}
            {unsent === 0 && data.sentCount > 0 && (
              /* 전체 이동(<a>) — 이력 화면은 방문일 범위를 서버에서 읽는다 */
              <a data-testid="day-sms-history" href={`/inspections/sms?from=${date}&to=${date}&status=all`}
                className="text-form-xs text-brand hover:underline">발송 이력 보기</a>
            )}
          </div>
          {data.blocked.length > 0 && (
            <p data-testid="day-sms-blocked" className="mt-1.5 flex items-start gap-1 text-form-2xs text-amber-700">
              <AlertTriangle className="size-3 shrink-0 mt-px" />
              <span>
                보낼 수 없음 <b>{data.blocked.length}곳</b> — {data.blocked.slice(0, 2).map(b => `${b.customerName}(${b.reason})`).join(', ')}
                {data.blocked.length > 2 && ` 외 ${data.blocked.length - 2}곳`}
              </span>
            </p>
          )}
        </>
      )}
    </div>
  )
}
