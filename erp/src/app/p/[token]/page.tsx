import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveShareToken, logShareEvent, clientMeta, ROUND_DOC_KINDS } from '@/lib/share-links'
import { loadQuoteDocBase } from '@/lib/quote-doc-server'
import { kdateLong } from '@/lib/doc-templates/quote'
import { todayKst } from '@/lib/kst-date'
import { ApproveForm } from './approve-form'

/** 관계인 열람·승인 페이지 — 로그인 없이 링크 토큰으로만 열린다 (불량 → 매출 2단계, 2026-10-02)
 *
 *  🔒 규약(정적 게이트 test-share-links가 고정):
 *   · service role(createAdminClient)로만 읽는다 — anon 키·쿠키 세션 클라이언트 금지(RLS가 「로그인이면 전부」라 위험)
 *   · 위조·만료·철회는 전부 같은 404 — 무엇이 틀렸는지 말하지 않는다
 *   · 화면에는 문서에 필요한 최소 정보만: 회사명·고객(대상물)명·품목·금액. 주소·전화·관계인 연락처는 싣지 않는다
 *  proxy.ts PUBLIC_PATHS에 '/p/'가 있다. */
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: '문서 확인', robots: { index: false, follow: false } }

const KIND_TITLE = {
  quote: '소방시설 보수 견적서', report9: '자체점검 실시결과 보고서(별지 9호)', report10: '이행계획서(별지 10호)', report11: '이행완료 보고서(별지 11호)',
  round: '자체점검 회차 문서', billing: '청구·세금계산서 내역',
} as const
const ROUND_DOC_TITLE = { report9: '자체점검 실시결과 보고서(별지 9호)', report10: '이행계획서(별지 10호)', report11: '이행완료 보고서(별지 11호)' } as const
const won = (n: number) => `${Math.round(Number(n)).toLocaleString('ko-KR')}원`

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  const link = await resolveShareToken(admin, token)
  if (!link) notFound()
  await logShareEvent(admin, link.id, 'viewed', clientMeta(await headers()))
  const base = await loadQuoteDocBase(admin, link.customer_id, link.inspection_id)

  let body: React.ReactNode
  if (link.kind === 'quote') {
    const { data: q } = await admin.from('quotes')
      .select('quote_number, quote_date, valid_until, status, items, subtotal, tax_amount, total_amount, approved_at, approved_by_name')
      .eq('id', link.quote_id!).maybeSingle()
    if (!q) notFound()
    const quote = q as {
      quote_number: string; quote_date: string; valid_until: string | null; status: string
      items: Array<{ description: string; quantity: number; unit_price: number; amount: number; detail?: string | null }>
      subtotal: number; tax_amount: number; total_amount: number; approved_at: string | null; approved_by_name: string | null
    }
    const expired = !!quote.valid_until && quote.valid_until < todayKst()
    const approvable = ['작성중', '발송'].includes(quote.status) && !expired
    body = (
      <>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
          <span>견적번호 <b className="font-mono text-gray-900">{quote.quote_number}</b></span>
          <span>견적일 {kdateLong(quote.quote_date)}</span>
          {quote.valid_until && <span>유효기간 {kdateLong(quote.valid_until)}{expired ? ' (지남)' : ''}</span>}
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm" data-testid="share-quote-table">
            <thead className="bg-gray-50 text-gray-600">
              <tr><th className="px-3 py-2 text-left">품목</th><th className="px-3 py-2 text-right">수량</th><th className="px-3 py-2 text-right">단가</th><th className="px-3 py-2 text-right">금액</th></tr>
            </thead>
            <tbody>
              {(quote.items ?? []).map((it, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">{it.description}{it.detail && <span className="block text-xs text-gray-500">{it.detail}</span>}</td>
                  <td className="px-3 py-2 text-right">{Number(it.quantity).toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-right">{won(it.unit_price)}</td>
                  <td className="px-3 py-2 text-right">{won(it.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-gray-50">
              <tr><td colSpan={3} className="px-3 py-1.5 text-right text-gray-600">공급가액</td><td className="px-3 py-1.5 text-right">{won(quote.subtotal)}</td></tr>
              <tr><td colSpan={3} className="px-3 py-1.5 text-right text-gray-600">부가세</td><td className="px-3 py-1.5 text-right">{won(quote.tax_amount)}</td></tr>
              <tr><td colSpan={3} className="px-3 py-2 text-right font-semibold">합계</td><td className="px-3 py-2 text-right font-bold" data-testid="share-total">{won(quote.total_amount)}</td></tr>
            </tfoot>
          </table>
        </div>
        <a href={`/p/${token}/file`} className="inline-block rounded-lg border px-4 py-2 text-sm hover:bg-gray-50" data-testid="share-pdf">견적서 PDF 내려받기</a>
        <div className="rounded-lg border p-4" data-testid="share-approve-box">
          {quote.approved_at ? (
            <p className="text-sm" data-testid="share-approved">✅ {quote.approved_by_name}님이 {kdateLong(quote.approved_at.slice(0, 10))}에 진행에 동의했습니다. 담당자가 일정을 연락드립니다.</p>
          ) : !approvable ? (
            <p className="text-sm text-gray-600" data-testid="share-not-approvable">
              {expired ? '유효기간이 지난 견적입니다 — 담당자에게 새 견적을 요청해 주세요.' : `이 견적은 지금 「${quote.status}」 상태라 여기서 승인할 수 없습니다.`}
            </p>
          ) : (
            <ApproveForm token={token} />
          )}
        </div>
      </>
    )
  } else if (link.kind === 'round') {
    // 한 회차의 별지 9·10·11호 최신 PDF 묶음 — 있는 것만 연결, 없는 것은 「준비 전」
    const prefix = `${link.customer_id}/inspections/${link.inspection_id}`
    const { data: objects } = await admin.storage.from('fire-plans').list(prefix, { limit: 100, sortBy: { column: 'name', order: 'desc' } })
    const names = (objects ?? []).map(o => o.name)
    body = (
      <ul className="divide-y rounded-lg border" data-testid="share-round-list">
        {ROUND_DOC_KINDS.map(k => {
          const has = names.some(n => new RegExp(`^${k}_\\d+\\.pdf$`).test(n))
          return (
            <li key={k} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <span>{ROUND_DOC_TITLE[k]}</span>
              {has
                ? <a href={`/p/${token}/file?doc=${k}`} className="rounded-lg border px-3 py-1 hover:bg-gray-50" data-testid={`share-round-${k}`}>열기(PDF)</a>
                : <span className="text-gray-400" data-testid={`share-round-${k}-none`}>준비 전</span>}
            </li>
          )
        })}
      </ul>
    )
  } else if (link.kind === 'billing') {
    // 고객의 청구·세금계산서 이력(최근 36건) — 금액·입금 여부·세금계산서 발행 상태. 계좌·사업자 상세는 싣지 않는다
    const { data: billsRaw } = await admin.from('bills')
      .select('id, billing_month, bill_type, bill_date, total_amount, paid_amount, paid_at')
      .eq('customer_id', link.customer_id).order('bill_date', { ascending: false }).limit(36)
    const bills = (billsRaw ?? []) as Array<{ id: string; billing_month: string; bill_type: string; bill_date: string; total_amount: number; paid_amount: number; paid_at: string | null }>
    const { data: invRaw } = bills.length
      ? await admin.from('tax_invoices').select('bill_id, issue_date, invoice_status').in('bill_id', bills.map(b => b.id))
      : { data: [] }
    const inv = new Map(((invRaw ?? []) as Array<{ bill_id: string; issue_date: string | null; invoice_status: string }>).map(i => [i.bill_id, i]))
    const unpaid = bills.reduce((s, b) => s + Math.max(0, Number(b.total_amount) - Number(b.paid_amount)), 0)
    body = bills.length === 0
      ? <p className="text-sm text-gray-600" data-testid="share-billing-empty">청구 내역이 없습니다.</p>
      : (
        <>
          <p className="text-sm" data-testid="share-billing-unpaid">미입금 합계 <b>{won(unpaid)}</b></p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm" data-testid="share-billing-table">
              <thead className="bg-gray-50 text-gray-600">
                <tr><th className="px-3 py-2 text-left">청구월</th><th className="px-3 py-2 text-left">내용</th><th className="px-3 py-2 text-right">금액</th><th className="px-3 py-2 text-left">입금</th><th className="px-3 py-2 text-left">세금계산서</th></tr>
              </thead>
              <tbody>
                {bills.map(b => {
                  const paid = Number(b.paid_amount) >= Number(b.total_amount)
                  const ti = inv.get(b.id)
                  return (
                    <tr key={b.id} className="border-t">
                      <td className="px-3 py-2">{b.billing_month}</td>
                      <td className="px-3 py-2">{b.bill_type}</td>
                      <td className="px-3 py-2 text-right">{won(b.total_amount)}</td>
                      <td className="px-3 py-2">{paid ? `입금(${b.paid_at ?? ''})` : Number(b.paid_amount) > 0 ? `일부 ${won(b.paid_amount)}` : '미입금'}</td>
                      <td className="px-3 py-2">{ti ? `${ti.invoice_status}${ti.issue_date ? ` ${ti.issue_date}` : ''}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )
  } else {
    const prefix = `${link.customer_id}/inspections/${link.inspection_id}`
    const { data: objects } = await admin.storage.from('fire-plans').list(prefix, { limit: 100, sortBy: { column: 'name', order: 'desc' } })
    const re = new RegExp(`^${link.kind}_\\d+\\.pdf$`)
    const has = (objects ?? []).some(o => re.test(o.name))
    body = has
      ? <a href={`/p/${token}/file`} className="inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm text-white" data-testid="share-pdf">문서 열기(PDF)</a>
      : <p className="text-sm text-gray-600" data-testid="share-no-file">아직 문서가 준비되지 않았습니다. 담당자에게 문의해 주세요.</p>
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-8" data-testid="share-page">
      <header className="space-y-1 border-b pb-3">
        <p className="text-sm text-gray-500">{base.company.name}</p>
        <h1 className="text-xl font-bold">{KIND_TITLE[link.kind]}</h1>
        <p className="text-sm text-gray-700">{base.customer.name}{base.inspectionLabel ? ` · ${base.inspectionLabel}` : ''}</p>
      </header>
      {body}
      <footer className="border-t pt-3 text-xs text-gray-500">
        이 링크는 {kdateLong(link.expires_at.slice(0, 10))}까지 유효하며, 받으신 분만 쓰도록 보내 드린 것입니다. 열람 기록이 남습니다.
        {base.company.phone && <> 문의 {base.company.phone}</>}
      </footer>
    </main>
  )
}
