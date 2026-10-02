import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveShareToken, logShareEvent, clientMeta } from '@/lib/share-links'
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

const KIND_TITLE = { quote: '소방시설 보수 견적서', report9: '자체점검 실시결과 보고서(별지 9호)', report10: '이행계획서(별지 10호)', report11: '이행완료 보고서(별지 11호)' } as const
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
