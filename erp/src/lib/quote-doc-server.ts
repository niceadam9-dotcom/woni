import 'server-only'

/** 견적 문서 서버 헬퍼 — 머리 정보 조립·PDF 보관본 확보 (2026-10-02)
 *
 *  보수 견적 페이지(직원)와 공개 열람 링크 /p/{token}(관계인)이 **같은 함수**를 쓴다 — 본 것과 받은 것이 같아야 한다.
 *  종전엔 'use server' 파일(repair-sales-actions)에 있었는데, 거기 export는 그 자체로 호출 가능한 액션 엔드포인트가 된다.
 *  admin 클라이언트를 인자로 받는 함수가 공개 엔드포인트로 노출되는 꼴이라 일반 서버 모듈로 옮겼다. */
import type { createAdminClient } from '@/lib/supabase/admin'
import { convertHtmlToPdf } from '@/lib/pdf'
import { renderQuote, quoteDocFrom, type QuoteDocBase } from '@/lib/doc-templates/quote'
import { formatBizNo, formatTel } from '@/lib/format-contact'

const BUCKET = 'fire-plans'

export type RepairQuoteItemLike = {
  description: string; quantity: number; unit_price: number; amount: number; defect_ids?: string[]; detail?: string | null
}

type AdminClient = ReturnType<typeof createAdminClient>

/** 견적 머리 정보(공급자·수신·회차) — 보수 견적 페이지 미리보기와 PDF가 같이 쓴다 */
export async function loadQuoteDocBase(admin: AdminClient, customerId: string, inspectionId: string | null): Promise<QuoteDocBase> {
  const [{ data: companyRows }, { data: cust }, inspRes] = await Promise.all([
    admin.from('company_profile').select('company_name, business_number, representative, phone, address').limit(1),
    admin.from('customers').select('customer_name, address, phone').eq('id', customerId).single(),
    inspectionId
      ? admin.from('inspections').select('inspection_type, year, inspection_start_date').eq('id', inspectionId).single()
      : Promise.resolve({ data: null }),
  ])
  const company = (companyRows?.[0] ?? {}) as { company_name?: string; business_number?: string; representative?: string; phone?: string; address?: string }
  const c = (cust ?? {}) as { customer_name?: string; address?: string | null; phone?: string | null }
  const i = inspRes.data as { inspection_type: string; year: number | null; inspection_start_date: string | null } | null
  return {
    company: {
      name: company.company_name ?? '', bizNo: formatBizNo(company.business_number), rep: company.representative ?? '',
      phone: formatTel(company.phone), address: company.address ?? '',
    },
    customer: { name: c.customer_name ?? '', address: c.address ?? '', contact: formatTel(c.phone) },
    inspectionLabel: i ? `${i.year ?? i.inspection_start_date?.slice(0, 4) ?? ''}년 ${i.inspection_type}점검${i.inspection_start_date ? ` (${i.inspection_start_date})` : ''}` : '',
  }
}

export type QuoteRow = {
  id: string; customer_id: string; inspection_id: string | null; quote_number: string; quote_date: string; valid_until: string | null
  status: string; items: RepairQuoteItemLike[]; notes: string | null; pdf_path: string | null
  customer: { customer_name: string } | null
}
export const QUOTE_PDF_COLS = 'id, customer_id, inspection_id, quote_number, quote_date, valid_until, status, items, notes, pdf_path, customer:customers(customer_name)'

export function quoteFileName(q: QuoteRow): string {
  return `${(q.customer?.customer_name ?? '고객').replace(/[\\/:*?"<>|]/g, '_')}_견적서_${q.quote_number}.pdf`
}

/** 견적 PDF 바이트 + 경로 — 있으면 보관본을, 없거나 regenerate면 새로 만들어 보관한다 */
export async function ensureQuotePdf(admin: AdminClient, q: QuoteRow, regenerate = false): Promise<{ error?: string; path?: string; bytes?: Uint8Array }> {
  if (q.pdf_path && !regenerate) {
    const { data: blob } = await admin.storage.from(BUCKET).download(q.pdf_path)
    if (blob) return { path: q.pdf_path, bytes: new Uint8Array(await blob.arrayBuffer()) }
  }
  const base = await loadQuoteDocBase(admin, q.customer_id, q.inspection_id)
  const html = renderQuote(quoteDocFrom(base, q))
  let pdf: Uint8Array
  try { pdf = await convertHtmlToPdf(html, [], { marginMode: 'none' }) }
  catch (e) { return { error: `PDF 변환 실패: ${e instanceof Error ? e.message : String(e)}` } }
  const path = `${q.customer_id}/quotes/${q.id}_${Date.now()}.pdf`
  const up = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf' })
  if (up.error) return { error: `PDF 업로드 실패: ${up.error.message}` }
  await admin.from('quotes').update({ pdf_path: path }).eq('id', q.id)
  return { path, bytes: pdf }
}

