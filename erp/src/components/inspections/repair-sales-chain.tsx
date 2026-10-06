'use client'

/** ⑤ 보수 칸 — 불량 → 견적 → 수주(계약) → 청구 사슬 (비교진단 「불량 → 매출 해결방안」 1단계, 2026-10-02)
 *
 *  DefectGrid(⑤⑥ 공용 표, E2E 4벌이 고정)는 건드리지 않고 그 아래 한 블록으로 선다. 불량 행과의 연결은
 *  견적 줄의 `defect_ids`로 읽어 「어느 불량이 어느 견적에 있나」를 여기서 그린다.
 *  데이터는 칸이 열릴 때 한 번 액션으로 받는다(lazy) — 상세 페이지의 서버 물결에 얹지 않는다(105·106회차 원칙).
 *  권한: 견적은 전 직원(quote_create = canManage와 같은 축), 수주·청구는 page.tsx가 `can()`으로 계산해 넘긴 플래그. */

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { FileText, Loader2, Plus, X } from 'lucide-react'
import {
  getRepairSalesAction, createDefectQuoteAction, markQuoteSentAction, approveQuoteAction, cancelQuoteAction,
  convertQuoteToOrderAction, setRepairOrderStatusAction, createRepairBillAction, generateQuotePdfAction,
  type RepairSalesState, type RepairQuote, type RepairOrder,
} from '@/app/(dashboard)/inspections/repair-sales-actions'
import type { GridDefect } from '@/components/inspections/defect-grid'
import { DateInput } from '@/components/ui/date-input'
import { todayKst } from '@/lib/kst-date'

export type SalesPerms = { order: boolean; bill: boolean }

const QUOTE_STYLE: Record<string, string> = {
  작성중: 'bg-gray-100 text-gray-600',
  발송: 'bg-blue-100 text-blue-700',
  승인: 'bg-indigo-100 text-indigo-700',
  수주: 'bg-emerald-100 text-emerald-700',
  취소: 'bg-red-100 text-red-600',
  만료: 'bg-yellow-100 text-yellow-700',
}
const ORDER_STYLE: Record<string, string> = {
  수주: 'bg-emerald-100 text-emerald-700',
  진행중: 'bg-blue-100 text-blue-700',
  완료: 'bg-brand-tint text-brand',
  취소: 'bg-red-100 text-red-600',
}
/** 「미발송」 판정에서 빼는 견적 — 취소·만료는 그 불량을 다시 견적해야 한다 */
const DEAD = new Set(['취소', '만료'])

const won = (n: number) => `${Math.round(Number(n)).toLocaleString('ko-KR')}원`
const addDays = (iso: string, d: number) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10) }

export function RepairSalesChain({ inspectionId, defects, canManage, perms, contractFileName, onChanged, hideComposer = false, reloadKey = 0 }: {
  inspectionId: string
  defects: GridDefect[]
  /** 견적 만들기·발송 표시·PDF — 회차 편집 권한(전 직원)과 같은 축 */
  canManage: boolean
  perms: SalesPerms
  /** ⑤ 칸에 올린 계약서 파일명 — 수주 전환 때 「계약서 있음/없음」을 말해 준다 */
  contractFileName: string | null
  /** 상태가 바뀐 뒤 부모에게(10호 미리보기 등 갱신 축) */
  onChanged?: () => void
  /** 보수 견적 페이지에서 쓸 때 — 페이지가 자체 작성 폼을 가지므로 이 블록의 「견적 만들기」를 숨긴다 */
  hideComposer?: boolean
  /** 부모가 견적을 새로 만들었을 때 이 값을 올리면 다시 읽는다 */
  reloadKey?: number
}) {
  const [state, setState] = useState<RepairSalesState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState<null | 'quote' | { approve: string } | { order: string }>(null)

  const apply = useCallback((r: Awaited<ReturnType<typeof getRepairSalesAction>>) => {
    if (r.error) setLoadError(r.error)
    else { setLoadError(null); setState({ quotes: r.quotes, orders: r.orders, bills: r.bills, deliveries: r.deliveries }) }
  }, [])
  const reload = useCallback(async () => apply(await getRepairSalesAction(inspectionId)), [inspectionId, apply])
  // 마운트 1회 적재 — setState는 액션 응답 콜백 안에서만(react-hooks/set-state-in-effect). 언마운트 뒤 응답은 버린다.
  useEffect(() => {
    let alive = true
    getRepairSalesAction(inspectionId).then(r => { if (alive) apply(r) })
    return () => { alive = false }
  }, [inspectionId, apply, reloadKey])

  const run = (fn: () => Promise<{ error?: string } & Record<string, unknown>>, okMsg: string) => {
    setMsg(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) { setMsg(`⚠ ${r.error}`); return }
      setMsg(`✅ ${okMsg}`)
      setOpen(null)
      await reload()
      onChanged?.()
    })
  }

  /** 불량 → 살아 있는 견적(취소·만료 제외) */
  const quoteOfDefect = useMemo(() => {
    const m = new Map<string, RepairQuote>()
    for (const q of state?.quotes ?? []) {
      if (DEAD.has(q.status)) continue
      for (const it of q.items ?? []) for (const id of it.defect_ids ?? []) if (!m.has(id)) m.set(id, q)
    }
    return m
  }, [state])
  const unquoted = useMemo(() => defects.filter(d => !quoteOfDefect.has(d.id)), [defects, quoteOfDefect])
  const billOfOrder = useMemo(() => new Map((state?.bills ?? []).map(b => [b.order_id, b])), [state])

  const btn = 'inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-brand-line text-form-xs text-brand hover:bg-brand-tint disabled:opacity-50'
  const btnGhost = 'inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-brand-line-soft text-form-xs text-ink-sub hover:bg-brand-tint disabled:opacity-50'

  return (
    <div className="border-t border-brand-line-soft pt-2 space-y-2" data-testid="repair-sales-chain">
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        <span className="text-form-xs font-semibold text-ink-sub">보수 견적·수주·청구</span>
        {state && defects.length > 0 && (
          <span data-testid="unquoted-strip"
            className={`text-form-2xs px-1.5 py-0.5 rounded-full ${unquoted.length ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-brand-tint text-brand'}`}>
            {unquoted.length ? `견적 미발송 불량 ${unquoted.length}건` : '모든 불량에 견적 있음'}
          </span>
        )}
        {canManage && defects.length > 0 && !hideComposer && (
          <button onClick={() => setOpen(open === 'quote' ? null : 'quote')} disabled={isPending} className={btn} data-testid="quote-create-open">
            <Plus className="size-3" /> 견적 만들기
          </button>
        )}
        {isPending && <Loader2 className="size-3 animate-spin text-ink-meta" />}
      </div>
      {msg && <p className="px-1 text-form-2xs text-ink-sub" role="status" data-testid="repair-sales-msg">{msg}</p>}
      {loadError && <p className="px-1 text-form-2xs text-red-600">{loadError}</p>}
      {!state && !loadError && <p className="px-1 text-form-2xs text-ink-meta">견적·수주를 불러오는 중…</p>}

      {open === 'quote' && (
        <QuoteComposer defects={defects} unquotedIds={new Set(unquoted.map(d => d.id))} disabled={isPending}
          onCancel={() => setOpen(null)}
          onSubmit={(lines, validUntil) => run(
            () => createDefectQuoteAction({ inspectionId, lines, validUntil }), '견적을 만들었습니다 — PDF를 만들어 보내거나, 승인·수주로 이어 가세요')} />
      )}

      {state && state.quotes.length > 0 && (
        <ul className="space-y-1.5 px-1" data-testid="repair-quote-list">
          {state.quotes.map(q => {
            const names = (q.items ?? []).map(it => it.description).slice(0, 3).join(' · ') + ((q.items?.length ?? 0) > 3 ? ` 외 ${q.items.length - 3}` : '')
            const order = state.orders.find(o => o.quote_id === q.id && o.status !== '취소')
            return (
              <li key={q.id} className="rounded-lg border border-brand-line-soft px-2 py-1.5 text-form-xs" data-testid={`repair-quote-${q.quote_number}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-form-2xs">{q.quote_number}</span>
                  <span className={`text-form-2xs px-1.5 py-0.5 rounded-full ${QUOTE_STYLE[q.status] ?? 'bg-gray-100 text-gray-500'}`} data-testid="quote-status">{q.status}</span>
                  <span className="text-ink">{won(q.total_amount)}</span>
                  <span className="text-ink-meta">(불량 {q.items?.length ?? 0}건: {names})</span>
                  {q.valid_until && <span className="text-ink-meta">유효 {q.valid_until}</span>}
                  {q.approved_at && <span className="text-ink-meta">승인 {q.approved_by_name}({q.approval_channel}) {q.approved_at.slice(0, 10)}</span>}
                </div>
                {canManage && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <button onClick={() => run(async () => {
                      const r = await generateQuotePdfAction({ quoteId: q.id })
                      if (r.url) window.open(r.url, '_blank', 'noopener')
                      return r
                    }, q.pdf_path ? '견적 PDF를 열었습니다' : '견적 PDF를 만들었습니다')} disabled={isPending} className={btnGhost} data-testid="quote-pdf">
                      <FileText className="size-3" /> {q.pdf_path ? '견적 PDF' : '견적 PDF 생성'}
                    </button>
                    {q.status === '작성중' && (
                      <button onClick={() => run(() => markQuoteSentAction(q.id), '발송으로 표시했습니다')} disabled={isPending} className={btnGhost} data-testid="quote-mark-sent" title="메일 외 수단(직접·우편·카톡)으로 이미 전달했을 때">직접 전달함 표시</button>
                    )}
                    {perms.order && ['작성중', '발송'].includes(q.status) && (
                      <button onClick={() => setOpen(typeof open === 'object' && open && 'approve' in open && open.approve === q.id ? null : { approve: q.id })}
                        disabled={isPending} className={btnGhost} data-testid="quote-approve-open">승인 기록</button>
                    )}
                    {perms.order && ['발송', '승인'].includes(q.status) && !order && (
                      <button onClick={() => setOpen(typeof open === 'object' && open && 'order' in open && open.order === q.id ? null : { order: q.id })}
                        disabled={isPending} className={btn} data-testid="quote-to-order-open">수주로 전환</button>
                    )}
                    {perms.order && !['수주', '취소'].includes(q.status) && (
                      <button onClick={() => { if (confirm(`${q.quote_number} 견적을 취소할까요?`)) run(() => cancelQuoteAction(q.id), '견적을 취소했습니다') }}
                        disabled={isPending} className="inline-flex items-center h-7 px-2 rounded-lg border border-red-200 text-form-xs text-red-600 hover:bg-red-50 disabled:opacity-50" data-testid="quote-cancel">취소</button>
                    )}
                  </div>
                )}
                {typeof open === 'object' && open && 'approve' in open && open.approve === q.id && (
                  <ApproveForm disabled={isPending} onCancel={() => setOpen(null)}
                    onSubmit={(name, channel) => run(() => approveQuoteAction({ quoteId: q.id, approvedByName: name, channel }), '관계인 승인을 기록했습니다')} />
                )}
                {typeof open === 'object' && open && 'order' in open && open.order === q.id && (
                  <OrderForm disabled={isPending} contractFileName={contractFileName} onCancel={() => setOpen(null)}
                    onSubmit={(contractor) => run(() => convertQuoteToOrderAction({ quoteId: q.id, contractor }), '수주(공사 계약)로 전환했습니다')} />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {state && state.orders.length > 0 && (
        <ul className="space-y-1.5 px-1" data-testid="repair-order-list">
          {state.orders.map(o => {
            const bill = billOfOrder.get(o.id)
            return (
              <li key={o.id} className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-2 py-1.5 text-form-xs" data-testid={`repair-order-${o.order_number}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-form-2xs">{o.order_number}</span>
                  <span className={`text-form-2xs px-1.5 py-0.5 rounded-full ${ORDER_STYLE[o.status] ?? 'bg-gray-100 text-gray-500'}`} data-testid="order-status">{o.status}</span>
                  <span className="text-ink">{won(o.total_amount)}</span>
                  <span className="text-ink-meta">{o.contractor_name ? `시공 ${o.contractor_name}` : '자사 시공'}</span>
                  <span className="text-ink-meta">{o.contract_file_path ? '계약서 첨부됨' : '계약서 없음'}</span>
                  {o.completed_at && <span className="text-ink-meta">완료 {o.completed_at}</span>}
                  {bill && <span className="text-form-2xs px-1.5 py-0.5 rounded-full bg-brand-tint text-brand" data-testid="order-bill">청구 {bill.billing_month} {won(bill.total_amount)}{Number(bill.paid_amount) >= Number(bill.total_amount) ? ' · 입금' : ''}</span>}
                </div>
                {perms.order && o.status !== '취소' && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {o.status === '수주' && <button onClick={() => run(() => setRepairOrderStatusAction({ orderId: o.id, status: '진행중' }), '진행중으로 바꿨습니다')} disabled={isPending} className={btnGhost} data-testid="order-start">진행중</button>}
                    {['수주', '진행중'].includes(o.status) && <button onClick={() => run(() => setRepairOrderStatusAction({ orderId: o.id, status: '완료' }), '공사 완료로 기록했습니다 — 청구를 만들 수 있습니다')} disabled={isPending} className={btn} data-testid="order-complete">공사 완료</button>}
                    {o.status === '완료' && perms.bill && !bill && (
                      <button onClick={() => run(() => createRepairBillAction({ orderId: o.id }), '청구를 만들었습니다 — 정산현황에서 입금을 기록하세요')} disabled={isPending} className={btn} data-testid="order-bill-create">청구 만들기</button>
                    )}
                    {!bill && (
                      <button onClick={() => { if (confirm(`${o.order_number} 수주를 취소할까요? 견적은 「승인」 상태로 돌아가지 않습니다.`)) run(() => setRepairOrderStatusAction({ orderId: o.id, status: '취소' }), '수주를 취소했습니다') }}
                        disabled={isPending} className="inline-flex items-center h-7 px-2 rounded-lg border border-red-200 text-form-xs text-red-600 hover:bg-red-50 disabled:opacity-50" data-testid="order-cancel">취소</button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {state && quoteOfDefect.size > 0 && (
        <details className="px-1 text-form-2xs text-ink-meta">
          <summary className="cursor-pointer">불량별 견적 보기</summary>
          <ul className="mt-1 space-y-0.5" data-testid="defect-quote-map">
            {defects.map(d => {
              const q = quoteOfDefect.get(d.id)
              return <li key={d.id}>{d.defect_name} — {q ? <span className="font-mono">{q.quote_number} <span className={`px-1 rounded ${QUOTE_STYLE[q.status] ?? ''}`}>{q.status}</span></span> : '견적 없음'}</li>
            })}
          </ul>
        </details>
      )}
    </div>
  )
}

/** 체크한 불량 → 줄(품목명=불량명, 수량 1, 단가 입력) */
function QuoteComposer({ defects, unquotedIds, disabled, onCancel, onSubmit }: {
  defects: GridDefect[]
  unquotedIds: Set<string>
  disabled: boolean
  onCancel: () => void
  onSubmit: (lines: Array<{ defectId: string; description: string; detail?: string | null; quantity: number; unitPrice: number }>, validUntil: string) => void
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(defects.filter(d => unquotedIds.has(d.id)).map(d => d.id)))
  const [price, setPrice] = useState<Record<string, string>>({})
  const [qty, setQty] = useState<Record<string, string>>({})
  const [validUntil, setValidUntil] = useState(addDays(todayKst(), 30))
  const sel = defects.filter(d => checked.has(d.id))
  const subtotal = sel.reduce((s, d) => s + (Number(price[d.id] || 0) * Number(qty[d.id] || 1)), 0)
  return (
    <div className="mx-1 rounded-lg border border-brand-line bg-brand-tint/40 p-2 space-y-1.5 text-form-xs" data-testid="quote-composer">
      <p className="text-ink-sub">견적에 넣을 불량을 고르고 단가를 적으세요. 품목명은 불량명, 수량은 1이 기본입니다. 견적은 불량 표를 바꾸지 않습니다.</p>
      <ul className="space-y-1">
        {defects.map(d => (
          <li key={d.id} className="flex flex-wrap items-center gap-1.5">
            <label className="inline-flex items-center gap-1 min-w-[12rem]">
              <input type="checkbox" checked={checked.has(d.id)} disabled={disabled}
                onChange={e => setChecked(prev => { const n = new Set(prev); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n })} />
              <span className={unquotedIds.has(d.id) ? '' : 'text-ink-meta'}>{d.defect_name}{unquotedIds.has(d.id) ? '' : ' (견적 있음)'}</span>
            </label>
            {checked.has(d.id) && (<>
              <input type="number" min={1} step={1} value={qty[d.id] ?? '1'} onChange={e => setQty(p => ({ ...p, [d.id]: e.target.value }))}
                className="h-7 w-14 rounded border border-brand-line px-1.5 text-right" title="수량" disabled={disabled} />
              <input type="number" min={0} step={1000} value={price[d.id] ?? ''} placeholder="단가(원)" onChange={e => setPrice(p => ({ ...p, [d.id]: e.target.value }))}
                className="h-7 w-28 rounded border border-brand-line px-1.5 text-right" disabled={disabled} data-testid="quote-line-price" />
            </>)}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1">유효기간 <DateInput value={validUntil} onChange={e => setValidUntil(e.target.value)} className="h-7 rounded border border-brand-line px-1.5 text-form-xs" /></label>
        <span className="text-ink-sub">공급가액 {won(subtotal)} · 부가세 {won(Math.round(subtotal * 0.1))} · 합계 {won(subtotal + Math.round(subtotal * 0.1))}</span>
        <button disabled={disabled || sel.length === 0} data-testid="quote-create-submit"
          onClick={() => onSubmit(sel.map(d => ({ defectId: d.id, description: d.defect_name, detail: d.defect_detail ?? null, quantity: Math.max(1, Number(qty[d.id] || 1)), unitPrice: Number(price[d.id] || 0) })), validUntil)}
          className="inline-flex items-center gap-1 h-7 px-3 rounded-lg bg-brand text-white text-form-xs hover:bg-brand-strong disabled:opacity-50">
          견적 만들기 ({sel.length}건)
        </button>
        <button onClick={onCancel} disabled={disabled} className="inline-flex items-center h-7 px-2 rounded-lg border border-brand-line-soft text-form-xs text-ink-sub"><X className="size-3" /></button>
      </div>
    </div>
  )
}

function ApproveForm({ disabled, onCancel, onSubmit }: {
  disabled: boolean; onCancel: () => void; onSubmit: (name: string, channel: 'email' | 'phone' | 'paper') => void
}) {
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<'email' | 'phone' | 'paper'>('phone')
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/40 p-1.5" data-testid="quote-approve-form">
      <span className="text-form-2xs text-ink-sub">관계인이 견적을 보고 진행에 동의했다는 기록입니다(전자서명 아님). 계약서는 따로 받습니다.</span>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="승인한 관계인 이름" className="h-7 w-36 rounded border border-brand-line px-1.5 text-form-xs" disabled={disabled} data-testid="approve-name" />
      <select value={channel} onChange={e => setChannel(e.target.value as 'email' | 'phone' | 'paper')} className="h-7 rounded border border-brand-line px-1 text-form-xs" disabled={disabled}>
        <option value="phone">전화·유선</option><option value="email">이메일</option><option value="paper">서면</option>
      </select>
      <button onClick={() => onSubmit(name, channel)} disabled={disabled || !name.trim()} className="h-7 px-3 rounded-lg bg-brand text-white text-form-xs disabled:opacity-50" data-testid="approve-submit">승인 기록</button>
      <button onClick={onCancel} disabled={disabled} className="h-7 px-2 rounded-lg border border-brand-line-soft text-form-xs text-ink-sub"><X className="size-3" /></button>
    </div>
  )
}

function OrderForm({ disabled, contractFileName, onCancel, onSubmit }: {
  disabled: boolean; contractFileName: string | null; onCancel: () => void
  onSubmit: (contractor: { name: string; bizNo?: string; rep?: string; phone?: string; address?: string } | null) => void
}) {
  const [external, setExternal] = useState(false)
  const [c, setC] = useState({ name: '', bizNo: '', rep: '', phone: '', address: '' })
  return (
    <div className="mt-1 space-y-1 rounded-lg border border-emerald-100 bg-emerald-50/40 p-1.5 text-form-xs" data-testid="quote-order-form">
      <p className="text-form-2xs text-ink-sub">
        수주 = 소방시설공사 계약입니다. 계약서는 별지 11호 법정 첨부(시행규칙 23조)라 ⑥ 제출 패키지에 자동으로 들어갑니다 —
        {contractFileName ? ` 지금 올라온 계약서: ${contractFileName}` : ' 아직 계약서가 없습니다(위 「계약서 업로드」, 나중에 올려도 패키지는 최신본을 집습니다).'}
      </p>
      <label className="inline-flex items-center gap-1"><input type="checkbox" checked={external} onChange={e => setExternal(e.target.checked)} disabled={disabled} /> 외주 시공(별지 11호 「소방공사업체」 칸에 시공사를 인쇄)</label>
      {external && (
        <div className="flex flex-wrap gap-1">
          <input value={c.name} onChange={e => setC({ ...c, name: e.target.value })} placeholder="시공사 상호 *" className="h-7 w-40 rounded border border-brand-line px-1.5" disabled={disabled} data-testid="contractor-name" />
          <input value={c.bizNo} onChange={e => setC({ ...c, bizNo: e.target.value })} placeholder="사업자번호" className="h-7 w-32 rounded border border-brand-line px-1.5" disabled={disabled} />
          <input value={c.rep} onChange={e => setC({ ...c, rep: e.target.value })} placeholder="대표자" className="h-7 w-24 rounded border border-brand-line px-1.5" disabled={disabled} />
          <input value={c.phone} onChange={e => setC({ ...c, phone: e.target.value })} placeholder="전화" className="h-7 w-32 rounded border border-brand-line px-1.5" disabled={disabled} />
          <input value={c.address} onChange={e => setC({ ...c, address: e.target.value })} placeholder="소재지" className="h-7 w-64 rounded border border-brand-line px-1.5" disabled={disabled} />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <button onClick={() => onSubmit(external ? c : null)} disabled={disabled || (external && !c.name.trim())}
          className="h-7 px-3 rounded-lg bg-brand text-white text-form-xs disabled:opacity-50" data-testid="order-submit">수주로 전환</button>
        <button onClick={onCancel} disabled={disabled} className="h-7 px-2 rounded-lg border border-brand-line-soft text-form-xs text-ink-sub"><X className="size-3" /></button>
      </div>
    </div>
  )
}

export type { RepairOrder }
