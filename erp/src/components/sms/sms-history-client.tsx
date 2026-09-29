'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { Loader2, AlertTriangle, RefreshCw, Search, CalendarDays } from 'lucide-react'
import { listSmsHistoryAction } from '@/app/(dashboard)/inspections/sms-actions'
import { InspectionSmsModal, type SmsModalSource } from '@/components/sms/inspection-sms-modal'
import { hangulMatch } from '@/lib/hangul'
import { todayKst, addDays } from '@/lib/sms-recipients'

/** 문자 발송 이력 (2026-09-29 — 종전 「문자 발송」 화면을 이력 전용으로 축소)
 *
 *  **보내는 일은 달력에서 한다.** 이 화면의 일은 하나다 — "제대로 갔나"를 확인하는 것(Q-15).
 *  종전 화면은 승인 배너·필터 7종·지역 묶음·일괄 이동·방문 취소·임의 발송을 한곳에 모아
 *  무엇을 하는 화면인지 읽기 어려웠다. 발송 출발점은 달력 문자 패널(calendar-sms-panel)로 갔다.
 *
 *  남긴 출구는 [다시 보내기] 하나 — 실패를 **본 자리에서** 고칠 수 없으면 이력은 구경거리다.
 */

type Status = 'all' | 'sent' | 'failed' | 'no_phone' | 'stuck'
type Row = {
  key: string; customerId: string; customerName: string; visitDate: string
  recipients: Array<{ name: string | null; role: string | null; phoneMasked: string; status: string }>
  status: Exclude<Status, 'all'>; unverified: boolean
  lastAt: string; attempts: number; reason: string | null
  isAdhoc: boolean; senderName: string | null; canResend: boolean
}
type Data = {
  rows: Row[]
  counts: Record<Status, number>
  truncated: boolean
  range: { sentFrom: string | null; sentTo: string | null; visitFrom: string | null; visitTo: string | null }
  today: string
}

const STATUS_LABEL: Record<Exclude<Status, 'all'>, string> = {
  sent: '발송됨', failed: '실패', no_phone: '번호없음',
  // 발송 직전 claim 행이 결과 기록에 실패해 굳은 상태 — **돈이 나갔을 수 있다**
  stuck: '확인필요',
}
const STATUS_TOOLTIP: Record<Exclude<Status, 'all'>, string> = {
  sent: '보냈습니다.',
  failed: '보내지 못했습니다. 사유는 오른쪽에 있습니다.',
  no_phone: '보낼 번호가 없어 발송되지 않았습니다 — 고객관리에서 연락처를 채워주세요.',
  stuck: '발송을 시작했는데 결과가 기록되지 않았습니다. 실제로 나갔을 수 있으니 확인 전에는 다시 보내지 마세요.',
}
const STATUS_CLASS: Record<Exclude<Status, 'all'>, string> = {
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-600 border-red-200',
  no_phone: 'bg-amber-50 text-amber-700 border-amber-200',
  stuck: 'bg-orange-100 text-orange-800 border-orange-300 font-semibold',
}
const btn = 'h-8 px-3 rounded-lg border border-brand-line text-xs text-ink-sub hover:bg-brand-tint transition-colors disabled:opacity-40'
const chip = (on: boolean) => `h-8 px-3 rounded-lg border text-xs transition-colors ${
  on ? 'border-brand bg-brand-tint text-brand font-semibold' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`
const sel = 'h-8 px-2 rounded-lg border border-brand-line text-xs text-ink-sub bg-surface'

export function SmsHistoryClient({ canSend, initialFrom, initialTo, initialStatus }: {
  canSend: boolean
  /** 발송 모달의 [발송 결과 전체 보기]가 실어 보내는 **방문일** 범위 (S8-10).
   *  초기값일 뿐 잠금이 아니다 — [해제]하면 최근 30일 발송분으로 돌아간다. */
  initialFrom?: string
  initialTo?: string
  initialStatus?: Status
}) {
  const today = todayKst()
  const [visitFrom, setVisitFrom] = useState(initialFrom ?? '')
  const [visitTo, setVisitTo] = useState(initialTo ?? '')
  // 기본은 **전체** — 이력 화면이 자기 기록을 가리면 안 된다(종전 기본 '발송 제외'는 할 일 목록의 것이었다)
  const [status, setStatus] = useState<Status>(initialStatus ?? 'all')
  const [sentFrom, setSentFrom] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [q, setQ] = useState('')

  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState<SmsModalSource | null>(null)
  const [isPending, startTransition] = useTransition()

  function reload() {
    setErr('')
    startTransition(async () => {
      // 상태는 서버에 넘기지 않는다 — 칩의 건수(전체·실패…)가 같은 조회에서 나와야 서로 맞는다
      const res = await listSmsHistoryAction({ sentFrom, sentTo, visitFrom, visitTo, status: 'all' })
      if ('error' in res && res.error) { setErr(res.error); return }
      setData(res as unknown as Data)
    })
  }
  const boot = useRef(false)
  useEffect(() => {
    if (boot.current) return
    boot.current = true
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 기간을 바꾸면 바로 조회한다 — 값과 목록이 다른 말을 하지 않게. 날짜 타이핑은 잠깐 묶는다
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const t = setTimeout(() => reload(), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentFrom, sentTo, visitFrom, visitTo])

  const all = data?.rows ?? []
  const qq = q.trim()
  const rows = all
    .filter(r => status === 'all' || r.status === status)
    .filter(r => !qq || hangulMatch(r.customerName, qq))
  const byVisit = !!(visitFrom || visitTo)
  const needAction = (data?.counts.failed ?? 0) + (data?.counts.no_phone ?? 0) + (data?.counts.stuck ?? 0)

  function openResend(r: Row) {
    setModal(r.isAdhoc
      ? { kind: 'adhoc', customerId: r.customerId, customerName: r.customerName, visitDate: r.visitDate, title: `다시 보내기 — ${r.customerName}` }
      // 계획이 있는 방문 — 목록은 서버가 만든 그날 전체, 체크는 이 고객만
      : { kind: 'range', from: r.visitDate, to: r.visitDate, title: `다시 보내기 — ${r.customerName}`, preselectCustomerIds: [r.customerId] })
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-3">
      {/* 보내는 곳 안내 — 이 화면에 발송 버튼이 없는 이유를 말해 준다 */}
      <div className="rounded-2xl border border-brand-line-soft bg-surface px-4 py-3 flex items-center gap-3 flex-wrap">
        <p className="text-xs text-ink-sub flex-1 min-w-[14rem]">
          문자는 <b className="text-ink">점검 달력</b>에서 보냅니다. 여기서는 보낸 결과를 확인하고, 실패한 건만 다시 보냅니다.
        </p>
        {canSend && (
          /* 전체 이동(<a>) — 달력은 `?sms=1`을 서버에서 읽는다 */
          <a href="/inspections/calendar?sms=1" data-testid="sms-go-calendar"
            className="h-8 px-3 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-strong transition-colors inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5" /> 달력에서 문자 보내기
          </a>
        )}
      </div>

      {needAction > 0 && (
        <div data-testid="sms-history-alert" className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2">
          <AlertTriangle className="size-3.5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-form-xs text-red-700">
            확인이 필요한 건 <b>{needAction}건</b>
            {' — '}실패 {data!.counts.failed} · 번호없음 {data!.counts.no_phone} · 확인필요 {data!.counts.stuck}
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-brand-line-soft bg-surface px-4 py-3 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap" data-testid="history-status">
          {(['all', 'sent', 'failed', 'no_phone', 'stuck'] as const).map(s => (
            <button key={s} data-testid={`history-status-${s}`} data-active={status === s ? '1' : '0'}
              className={chip(status === s)} onClick={() => setStatus(s)}
              title={s === 'all' ? undefined : STATUS_TOOLTIP[s]}>
              {s === 'all' ? '전체' : STATUS_LABEL[s]} {data ? data.counts[s] : ''}
            </button>
          ))}
          <span className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="고객명 검색 (초성 가능)"
              data-testid="history-search"
              className="h-8 w-56 pl-8 pr-2 text-xs border border-brand-line rounded-lg outline-none focus:border-brand transition" />
          </span>
          <button onClick={reload} disabled={isPending} className="p-1.5 rounded hover:bg-brand-tint text-ink-soft" title="새로고침">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap text-form-xs text-ink-sub">
          {byVisit ? (
            <span data-testid="history-visit-lock" className="flex items-center gap-1.5">
              <span className="px-2 py-1 rounded-lg bg-brand-tint border border-brand-line text-brand">
                방문일 {visitFrom === visitTo || !visitTo ? visitFrom : `${visitFrom} ~ ${visitTo}`} 건만 보는 중
              </span>
              <button className={btn} data-testid="history-visit-clear"
                onClick={() => { setVisitFrom(''); setVisitTo('') }}>해제</button>
            </span>
          ) : (
            <>
              <span>보낸 날</span>
              <input type="date" value={sentFrom} max={today} onChange={e => setSentFrom(e.target.value)} className={sel} />
              <span>~</span>
              <input type="date" value={sentTo} max={today} onChange={e => setSentTo(e.target.value)} className={sel} />
              <button className={chip(!sentFrom && !sentTo)} data-testid="history-period-default"
                onClick={() => { setSentFrom(''); setSentTo('') }}>최근 30일</button>
              <button className={btn} onClick={() => { setSentFrom(today); setSentTo(today) }}>오늘</button>
              <button className={btn} onClick={() => { setSentFrom(addDays(today, -7)); setSentTo(today) }}>최근 7일</button>
            </>
          )}
        </div>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
      {data?.truncated && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-form-xs text-amber-800">
          이력이 많아 일부만 불러왔습니다 — 기간을 좁혀 주세요.
        </div>
      )}

      <div className="rounded-2xl border border-brand-line-soft bg-surface overflow-hidden">
        <div className="px-4 py-2 border-b border-brand-line-soft text-form-xs text-ink-soft">
          {rows.length}건{qq || status !== 'all' ? ` (전체 ${all.length}건 중)` : ''}
        </div>
        {!data && !err && (
          <p className="py-10 flex items-center justify-center gap-2 text-xs text-ink-sub">
            <Loader2 className="size-4 animate-spin" /> 발송 이력을 불러오는 중…
          </p>
        )}
        {data && rows.length === 0 && (
          <p className="py-10 text-center text-xs text-ink-soft">
            {all.length === 0 ? '이 기간에 보낸 문자가 없습니다.' : '조건에 맞는 건이 없습니다.'}
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className={`w-full min-w-[760px] text-xs transition-opacity ${isPending ? 'opacity-50' : ''}`}>
              <thead>
                <tr className="text-form-2xs text-ink-faint bg-paper">
                  <th className="pl-4 py-1.5 text-left font-medium">보낸 때</th>
                  <th className="py-1.5 text-left font-medium">고객</th>
                  <th className="py-1.5 text-left font-medium">방문일</th>
                  <th className="py-1.5 text-left font-medium">받는 사람</th>
                  <th className="py-1.5 text-left font-medium">상태</th>
                  <th className="py-1.5 text-left font-medium">사유</th>
                  <th className="py-1.5 text-left font-medium">보낸 사람</th>
                  <th className="py-1.5 pr-4" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key} data-testid="sms-row" className="border-t border-brand-line-soft hover:bg-paper align-top">
                    <td className="pl-4 py-1.5 text-ink-sub tabular-nums whitespace-nowrap">
                      {fmt(r.lastAt)}
                      {r.attempts > r.recipients.length && r.recipients.length > 0 && (
                        <span className="ml-1 text-form-2xs text-ink-faint" title="같은 방문으로 여러 번 시도했습니다">{r.attempts}회 시도</span>
                      )}
                    </td>
                    <td className="py-1.5 text-ink">
                      {r.customerName}
                      {r.isAdhoc && <span data-testid="badge-adhoc" className="ml-1 px-1 py-0.5 rounded bg-brand-tint text-form-2xs text-brand border border-brand-line">임의</span>}
                    </td>
                    <td className="py-1.5 text-ink-sub tabular-nums whitespace-nowrap">{r.visitDate}</td>
                    <td className="py-1.5 text-ink-sub">
                      {r.recipients.length === 0 ? <span className="text-ink-faint">없음</span>
                        : r.recipients.map((p, i) => (
                          <span key={i} className="block whitespace-nowrap">
                            {p.name ?? p.role ?? '수신자'} <span className="text-ink-faint">{p.phoneMasked}</span>
                            {p.status === 'failed' && <span className="ml-1 text-red-500">실패</span>}
                          </span>
                        ))}
                    </td>
                    <td className="py-1.5" data-testid="row-status" data-status={r.status}>
                      <span title={STATUS_TOOLTIP[r.status]}
                        className={`inline-block px-1.5 py-0.5 rounded border text-form-2xs ${STATUS_CLASS[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {/* 접수 확인이 안 된 건 — 실패로 두면 이미 나간 문자를 다시 보내게 되어 발송됨으로 묶는다(S5-0c) */}
                      {r.status === 'sent' && r.unverified && (
                        <span className="ml-1 text-form-2xs text-amber-600" title="공급자 응답을 못 읽어 접수 확인이 안 됐습니다. 실제로는 나갔을 수 있습니다.">확인불가</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-form-2xs text-ink-soft max-w-[18rem]">{r.reason ?? ''}</td>
                    <td className="py-1.5 text-ink-soft whitespace-nowrap">{r.senderName ?? '-'}</td>
                    <td className="py-1.5 pr-4 text-right">
                      {canSend && r.canResend && (
                        <button data-testid="row-resend" onClick={() => openResend(r)}
                          title="이 고객에게 이 방문일로 다시 보냅니다"
                          className="h-6 px-2 rounded-lg border border-brand-line text-form-2xs text-brand hover:bg-brand-tint transition-colors whitespace-nowrap">
                          다시 보내기
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <InspectionSmsModal source={modal} onClose={() => setModal(null)} onSent={reload} />
      )}
    </div>
  )
}
