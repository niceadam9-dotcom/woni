'use client'

/** 고객 「청구」 탭 — 청구·세금계산서 이력 + 관계인 청구 이력 링크 (불량 → 매출 3단계, 2026-10-02)
 *  탭이 열릴 때 한 번 액션으로 읽는다(lazy — 고객 상세 서버 물결에 얹지 않는다). 청구 관리 권한(manager+)에서만 그린다. */
import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { Receipt, Loader2 } from 'lucide-react'
import { getCustomerBillingHistoryAction, type CustomerBillRow } from '@/app/(dashboard)/customers/billing-history-actions'
import {
  createBillingShareLinkAction, listCustomerBillingLinksAction, revokeShareLinkAction, type ShareLinkRow,
} from '@/app/(dashboard)/inspections/share-link-actions'

const won = (n: number) => `${Math.round(Number(n)).toLocaleString('ko-KR')}원`

export function CustomerBillsPanel({ customerId }: { customerId: string }) {
  const [bills, setBills] = useState<CustomerBillRow[] | null>(null)
  const [unpaid, setUnpaid] = useState(0)
  const [links, setLinks] = useState<ShareLinkRow[]>([])
  const [newLink, setNewLink] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [nowMs] = useState(() => Date.now())
  /** 청구 관리 권한(manager+)이 없으면 패널 전체를 숨긴다 — 탭은 전 직원이 연다 */
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([getCustomerBillingHistoryAction(customerId), listCustomerBillingLinksAction(customerId)]).then(([h, l]) => {
      if (!alive) return
      if (h.forbidden) { setForbidden(true); return }
      if (h.error) setMsg(`⚠ ${h.error}`); else { setBills(h.bills); setUnpaid(h.unpaid) }
      if (!l.error) setLinks(l.links)
    })
    return () => { alive = false }
  }, [customerId])

  const refreshLinks = async () => { const l = await listCustomerBillingLinksAction(customerId); if (!l.error) setLinks(l.links) }

  if (forbidden) return null
  return (
    <div className="rounded-xl border border-brand-line-soft bg-surface p-5 space-y-3" data-testid="customer-bills-panel">
      <div className="flex items-center gap-2">
        <Receipt className="size-4 text-brand" />
        <h2 className="text-form-base-title font-semibold text-ink">청구·세금계산서 이력</h2>
        {bills && <span className="ml-auto text-form-sm text-ink-sub" data-testid="customer-bills-unpaid">미입금 합계 <b>{won(unpaid)}</b></span>}
      </div>
      {msg && <p className="text-form-sm text-ink-sub" role="status">{msg}</p>}
      {!bills && !msg && <p className="flex items-center gap-1 text-form-sm text-ink-meta"><Loader2 className="size-3.5 animate-spin" /> 불러오는 중…</p>}
      {bills && bills.length === 0 && <p className="text-form-sm text-ink-meta">청구 내역이 없습니다.</p>}
      {bills && bills.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-form-sm" data-testid="customer-bills-table">
            <thead><tr className="border-b text-ink-sub">
              <th className="px-2 py-1.5 text-left">청구월</th><th className="px-2 py-1.5 text-left">유형</th><th className="px-2 py-1.5 text-right">금액</th>
              <th className="px-2 py-1.5 text-left">입금</th><th className="px-2 py-1.5 text-left">세금계산서</th><th className="px-2 py-1.5 text-left">연결</th>
            </tr></thead>
            <tbody>
              {bills.map(b => {
                const paid = Number(b.paid_amount) >= Number(b.total_amount)
                return (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="px-2 py-1.5">{b.billing_month}</td>
                    <td className="px-2 py-1.5">{b.bill_type}{b.fee_type ? <span className="text-ink-meta"> · {b.fee_type}</span> : null}</td>
                    <td className="px-2 py-1.5 text-right">{won(b.total_amount)}</td>
                    <td className="px-2 py-1.5">{paid ? <span className="text-green-700">입금 {b.paid_at ?? ''}</span> : Number(b.paid_amount) > 0 ? `일부 ${won(b.paid_amount)}` : <span className="text-amber-700">미입금</span>}</td>
                    <td className="px-2 py-1.5">{b.invoice ? `${b.invoice.status}${b.invoice.issue_date ? ` ${b.invoice.issue_date}` : ''}${b.invoice.approval_num ? ` · ${b.invoice.approval_num}` : ''}` : <span className="text-ink-meta">미발행</span>}</td>
                    <td className="px-2 py-1.5 text-ink-meta">{b.order_id ? '보수공사 수주' : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-1 text-form-2xs text-ink-meta">최근 36건 · 입금 처리·세금계산서 발행은 <Link href="/billing/status" className="underline">정산현황</Link>에서.</p>
        </div>
      )}

      <div className="border-t border-brand-line-soft pt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-form-sm font-semibold text-ink-sub">관계인 청구 이력 링크</span>
          <button disabled={pending} data-testid="billing-link-create"
            onClick={() => start(async () => {
              setMsg(null)
              const r = await createBillingShareLinkAction(customerId)
              if (r.error) { setMsg(`⚠ ${r.error}`); return }
              setNewLink(r.url ?? null)
              await refreshLinks()
            })}
            className="inline-flex h-8 items-center rounded-lg border border-brand-line px-3 text-form-sm text-brand hover:bg-brand-tint disabled:opacity-50">
            링크 만들기
          </button>
          <span className="text-form-2xs text-ink-meta">로그인 없이 청구·입금·세금계산서 상태를 봅니다(90일, 철회 가능). 계좌·사업자 상세는 보이지 않습니다.</span>
        </div>
        {newLink && (
          <div className="flex flex-wrap items-center gap-1.5">
            <input readOnly value={newLink} onFocus={e => e.currentTarget.select()} data-testid="billing-link-url"
              className="h-8 min-w-[20rem] flex-1 rounded border border-brand-line px-2 font-mono text-form-2xs" />
            <button onClick={() => { void navigator.clipboard?.writeText(newLink); setMsg('✅ 링크를 복사했습니다') }} className="h-8 rounded-lg bg-brand px-3 text-form-sm text-white">복사</button>
          </div>
        )}
        {links.length > 0 && (
          <ul className="space-y-1 text-form-sm" data-testid="billing-link-list">
            {links.map(l => {
              const dead = !!l.revoked_at || new Date(l.expires_at).getTime() < nowMs
              return (
                <li key={l.id} className={`flex flex-wrap items-center gap-2 ${dead ? 'text-ink-meta line-through' : ''}`}>
                  <span>만든 날 {l.created_at.slice(0, 10)} · ~{l.expires_at.slice(0, 10)}</span>
                  <span>열람 {l.views}회{l.last_viewed_at ? ` (마지막 ${l.last_viewed_at.slice(0, 16).replace('T', ' ')})` : ''}</span>
                  {l.revoked_at && <span>철회됨</span>}
                  {!dead && (
                    <button onClick={() => { if (confirm('이 청구 이력 링크를 철회할까요?')) start(async () => { await revokeShareLinkAction(l.id); await refreshLinks() }) }}
                      className="rounded border border-red-200 px-1.5 text-red-600 no-underline hover:bg-red-50" data-testid="billing-link-revoke">철회</button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
