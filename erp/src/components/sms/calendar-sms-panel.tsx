'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import Link from 'next/link'
import { X, Loader2, AlertTriangle, MessageSquare, CalendarDays, Search, ChevronRight } from 'lucide-react'
import { listPendingNoticesAction, listSmsCustomerOptionsAction } from '@/app/(dashboard)/inspections/sms-actions'
import { CustomerFilterSearch } from '@/components/ui/customer-filter-search'
import { todayKst, dDayLabel } from '@/lib/sms-recipients'
import type { SmsModalSource } from '@/components/sms/inspection-sms-modal'

/** 달력 문자 패널 — 문자 보내기의 **유일한 출발점** (2026-09-29 사용자 확정)
 *
 *  구역은 둘뿐이다:
 *   ① 자동 준비 — 시점 규칙으로 시스템이 계산해 둔 「보낼 안내」. 사람이 확인하고 눌러야 나간다.
 *      무인 발송(크론)은 만들지 않았다 — 문자는 취소가 안 되고 돈이 나간다(소방계획서_24 Q-4·Q-12).
 *   ② 직접 보내기 — 날짜를 고르거나(그날 방문 전체), 고객을 고른다(계획에 없는 방문).
 *
 *  이 패널은 **대상을 고르기만** 한다. 수신자·문구·중복 확인은 전부 발송 모달(서버)이 한다 —
 *  여기서 번호를 계산하면 달력이 무엇을 로드했는지에 따라 목록이 갈린다(Q-14).
 */

type Notice = {
  leadDays: number; visitDate: string; label: string
  unsentCount: number; messageCount: number
  blockedCount: number; blocked: Array<{ customerName: string; reason: string }>
}
type Data = { notices: Notice[]; overdueCount: number; rules: number[]; canEditRules: boolean }

const btn = 'h-8 px-3 rounded-lg border border-brand-line text-xs text-ink-sub hover:bg-brand-tint transition-colors disabled:opacity-40'
const btnPri = 'h-8 px-3 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-strong transition-colors disabled:opacity-40'

export function CalendarSmsPanel({ onClose, onOpenModal, reloadKey }: {
  onClose: () => void
  /** 발송 모달을 연다 — 모달은 달력이 그린다(패널 위에 뜬다) */
  onOpenModal: (source: SmsModalSource) => void
  /** 값이 바뀌면 다시 센다 — 방금 보낸 건이 「자동 준비」에 남아 있으면 재발송을 권하는 셈이다 */
  reloadKey: number
}) {
  const today = todayKst()
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [isPending, startTransition] = useTransition()

  const [pickDate, setPickDate] = useState('')
  const [custOpen, setCustOpen] = useState(false)
  const [custQuery, setCustQuery] = useState('')
  const [custOptions, setCustOptions] = useState<Array<{ id: string; name: string; sub?: string }>>([])

  function load() {
    setErr('')
    startTransition(async () => {
      const res = await listPendingNoticesAction()
      if ('error' in res && res.error) { setErr(res.error); return }
      setData(res as Data)
    })
  }
  const lastKey = useRef<number | null>(null)
  useEffect(() => {
    if (lastKey.current === reloadKey) return   // StrictMode 이중 호출 방어
    lastKey.current = reloadKey
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  function openCustomerPicker() {
    setCustOpen(true)
    if (custOptions.length > 0) return          // 한 번만 가져온다
    startTransition(async () => {
      const res = await listSmsCustomerOptionsAction()
      setCustOptions(res.customers ?? [])
    })
  }
  const custPick = custOptions.find(c => c.name === custQuery) ?? null

  const notices = data?.notices ?? []
  const autoOff = !!data && data.rules.length === 0
  const blockedTotal = notices.reduce((n, x) => n + x.blockedCount, 0)
  const blockedNames = [...new Set(notices.flatMap(n => n.blocked).map(b => `${b.customerName}(${b.reason})`))]
  const md = (d: string) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`

  return (
    <>
      <div className="fixed inset-0 bg-black/20 dark:bg-black/60 z-40" onClick={onClose} />
      <div data-testid="cal-sms-panel"
        className="fixed top-0 right-0 bottom-0 w-[400px] max-w-full bg-surface shadow-2xl z-50 flex flex-col">
        <div className="px-5 py-4 border-b border-brand-line-soft shrink-0 flex items-center justify-between">
          <p className="flex items-center gap-2 font-semibold text-ink">
            <MessageSquare className="size-4 text-brand" /> 문자 보내기
            {isPending && <Loader2 className="size-3.5 animate-spin text-ink-faint" />}
          </p>
          <button onClick={onClose} title="닫기" aria-label="닫기" data-testid="cal-sms-panel-close"
            className="size-9 shrink-0 flex items-center justify-center rounded-lg border border-line bg-surface text-ink hover:bg-paper hover:border-brand-line transition-colors">
            <X className="size-5" strokeWidth={2.75} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ① 자동 준비 */}
          <section className="px-5 py-4 border-b border-brand-line-soft">
            <p className="text-xs font-semibold text-ink">자동 준비</p>
            <p className="text-form-2xs text-ink-soft mt-0.5">
              방문이 가까운 고객을 미리 골라 두었습니다. <b>확인하고 눌러야</b> 나갑니다.
            </p>

            {err && (
              <p data-testid="cal-sms-panel-error"
                className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-form-xs text-red-700">{err}</p>
            )}
            {!data && !err && (
              <p className="mt-3 flex items-center gap-2 text-xs text-ink-sub">
                <Loader2 className="size-3.5 animate-spin" /> 보낼 안내를 계산하는 중…
              </p>
            )}

            {/* 사전 안내 시점 「사용 안 함」 — 빈 목록을 「보낼 안내 없음 ✓」로 읽히게 두지 않는다.
                할 일이 없는 것과 기능을 꺼 둔 것은 다른 상태다 */}
            {autoOff && (
              <p data-testid="sms-auto-off"
                className="mt-2 rounded-lg bg-paper border border-line px-3 py-2 text-form-xs text-ink-sub">
                자동 준비를 <b>사용하지 않습니다.</b> 아래 「직접 보내기」로 보냅니다.
                {data!.canEditRules && (
                  <> <Link href="/settings/message-templates" className="text-brand hover:underline">다시 켜기</Link></>
                )}
              </p>
            )}

            <div className="mt-2">
              {notices.map(n => (
                <div key={n.leadDays} data-testid="sms-notice"
                  className="flex items-center gap-2 py-2 border-t border-brand-line-soft first:border-0">
                  <span className={`size-1.5 rounded-full shrink-0 ${n.unsentCount > 0 ? 'bg-brand' : 'bg-brand-line'}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-ink">{n.label}</span>
                    <span className="block text-form-xs text-ink-sub">
                      {/* 단위는 **건**(고객+방문일) — 뱃지·위젯과 같은 단위다 */}
                      {n.unsentCount > 0
                        ? <>미발송 <b>{n.unsentCount}건</b> · <b>{n.messageCount}통</b></>
                        : n.blockedCount > 0 ? '보낼 수 있는 곳이 없습니다' : '보낼 안내 없음 ✓'}
                    </span>
                  </span>
                  {n.unsentCount > 0 && (
                    <button data-testid="sms-approve" className={btnPri}
                      onClick={() => onOpenModal({ kind: 'range', from: n.visitDate, to: n.visitDate, title: `${n.label} — 사전 안내` })}>
                      확인·발송
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* 못 보내는 것도 할 일이다 — 빼면 전원 번호없음인 날이 초록불이 된다 */}
            {blockedTotal > 0 && (
              <p data-testid="sms-blocked" className="mt-2 flex items-start gap-1.5 text-form-xs text-amber-700">
                <AlertTriangle className="size-3.5 text-amber-500 shrink-0 mt-px" />
                <span>
                  보낼 수 없는 건 <b>{blockedTotal}건</b> — {blockedNames.slice(0, 3).join(', ')}
                  {blockedNames.length > 3 && ' 외'}. 그대로 두면 연락 없이 방문하게 됩니다.
                </span>
              </p>
            )}
            {(data?.overdueCount ?? 0) > 0 && (
              <p data-testid="sms-overdue" className="mt-2 flex items-start gap-1.5 text-form-xs text-amber-700">
                <AlertTriangle className="size-3.5 text-amber-500 shrink-0 mt-px" />
                <span>안내 못 하고 지난 방문 <b>{data!.overdueCount}건</b>. 지난 날짜에는 문자를 보낼 수 없습니다.</span>
              </p>
            )}

            {data && !autoOff && (
              <p className="mt-3 flex items-center gap-1.5 text-form-2xs text-ink-soft">
                안내 시점: {[...data.rules].sort((a, b) => a - b).map(dDayLabel).join(' · ')}
                {data.canEditRules && (
                  <Link href="/settings/message-templates" className="text-brand hover:underline">시점 바꾸기</Link>
                )}
              </p>
            )}
          </section>

          {/* ② 직접 보내기 */}
          <section className="px-5 py-4 border-b border-brand-line-soft">
            <p className="text-xs font-semibold text-ink">직접 보내기</p>

            <div className="mt-2 rounded-xl border border-brand-line-soft p-3">
              <p className="flex items-center gap-1.5 text-form-xs font-medium text-ink">
                <CalendarDays className="size-3.5 text-brand" /> 날짜 골라 보내기
              </p>
              <p className="text-form-2xs text-ink-soft mt-0.5">그날 방문하는 고객 전체가 목록으로 뜹니다. 보낼 곳만 남기고 보냅니다.</p>
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <input type="date" value={pickDate} min={today} onChange={e => setPickDate(e.target.value)}
                  data-testid="cal-sms-date"
                  className="h-8 px-2 rounded-lg border border-brand-line text-xs text-ink-sub bg-surface" />
                <button data-testid="cal-sms-date-open" className={btnPri}
                  disabled={!pickDate || pickDate < today}
                  onClick={() => onOpenModal({ kind: 'range', from: pickDate, to: pickDate, title: `${md(pickDate)} 방문 — 사전 안내` })}>
                  대상 보기
                </button>
              </div>
              <p className="text-form-2xs text-ink-soft mt-1.5">달력에서 날짜를 눌러도 같은 버튼이 있습니다 — 거기서는 고객을 골라 보낼 수 있습니다.</p>
            </div>

            <div className="mt-2 rounded-xl border border-brand-line-soft p-3">
              <p className="flex items-center gap-1.5 text-form-xs font-medium text-ink">
                <Search className="size-3.5 text-brand" /> 고객 골라 보내기
              </p>
              <p className="text-form-2xs text-ink-soft mt-0.5">재방문·보수·상담처럼 계획에 없는 방문. <b>점검 회차로 잡히지 않습니다.</b></p>
              {!custOpen ? (
                <button data-testid="sms-adhoc-toolbar" className={`${btn} mt-2`} onClick={openCustomerPicker}>
                  고객 검색
                </button>
              ) : (
                <div data-testid="sms-adhoc-picker" className="mt-2 space-y-1.5">
                  <CustomerFilterSearch
                    customers={custOptions}
                    value={custQuery}
                    onChange={setCustQuery}
                    testId="sms-adhoc-customer"
                    widthClass="w-full"
                  />
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 text-form-2xs text-ink-soft">
                      {custPick ? `${custPick.name} 선택됨`
                        : custOptions.length === 0 ? '고객 목록을 불러오는 중…'
                        : `전체 고객 ${custOptions.length}곳에서 고릅니다 (초성 가능)`}
                    </span>
                    {custPick && (
                      <button className={btnPri} data-testid="sms-adhoc-open"
                        onClick={() => onOpenModal({ kind: 'adhoc', customerId: custPick.id, customerName: custPick.name })}>
                        문자 보내기
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="px-5 py-3">
            <Link href="/inspections/sms" data-testid="cal-sms-history-link"
              className="flex items-center gap-1 text-xs text-brand hover:underline">
              발송 이력 보기 <ChevronRight className="size-3.5" />
            </Link>
            <p className="text-form-2xs text-ink-soft mt-0.5">누구에게 언제 갔는지, 실패한 건이 있는지 확인합니다.</p>
          </section>
        </div>
      </div>
    </>
  )
}
