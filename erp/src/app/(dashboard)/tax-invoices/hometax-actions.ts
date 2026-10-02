'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { COMPANY_PROFILE_ORDER } from '@/lib/company-profile'
import { billingProfileReady, isValidBizNo } from '@/lib/biz-no'
import {
  hometaxRow, HOMETAX_MAX_ROWS, matchHometaxResult,
  type HometaxBuyer, type HometaxSupplier, type HometaxResultRow, type MatchCandidate,
} from '@/lib/hometax-bulk'

/** B2-2 — 홈택스 일괄발급 엑셀(내보내기)과 발급 결과(승인번호 가져오기). 국세청 전송은 사람이 홈택스에서 한다.
 *  엑셀 파일은 클라이언트가 만든다(SheetJS 동적 로드 — 제출현황 엑셀과 같은 방식). 서버는 **행과 제외 사유**만 준다. */

type BillRow = {
  id: string; customer_id: string; bill_date: string; bill_type: string; billing_month: string
  supply_value: number; tax_value: number; total_amount: number
  customers: { customer_name: string; address: string | null } | null
  tax_invoices: { invoice_status: string } | Array<{ invoice_status: string }> | null
}
const invStatus = (b: BillRow) => {
  const t = Array.isArray(b.tax_invoices) ? b.tax_invoices[0] : b.tax_invoices
  return t?.invoice_status ?? null
}

export type HometaxSkip = { billId: string; customerName: string; reason: string }
export type HometaxExport = {
  month: string
  rows: (string | number)[][]
  skipped: HometaxSkip[]
  supplierProblems: string[]
  truncated: number
}

/** 그 달(`YYYY.MM`) 미발행 청구 → 양식 행. 발급 불가(사업자번호·이메일 미비) 건은 행을 만들지 않고 사유와 함께 돌려준다. */
export async function getHometaxExportAction(month: string): Promise<HometaxExport | { error: string }> {
  await requirePermission('tax_invoice_manage')
  if (!/^\d{4}\.\d{2}$/.test(month)) return { error: '청구월 형식을 확인해주세요 (YYYY.MM).' }
  const admin = createAdminClient()

  const [billsRes, coRes, coTaxRes] = await Promise.all([
    admin.from('bills')
      .select('id, customer_id, bill_date, bill_type, billing_month, supply_value, tax_value, total_amount, customers:customer_id ( customer_name, address ), tax_invoices ( invoice_status )')
      .eq('billing_month', month).order('bill_date').order('id'),
    admin.from('company_profile').select('business_number, company_name, representative, address, email')
      .order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle(),
    // 169 열은 따로 — 미적용 DB에서 공급자 행 전체가 비지 않게
    admin.from('company_profile').select('business_type, business_item, tax_email')
      .order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle(),
  ])
  if (billsRes.error) return { error: `청구 조회 실패: ${billsRes.error.message}` }
  const co = { ...(coRes.data ?? {}), ...(coTaxRes.data ?? {}) } as Record<string, string | null>
  const supplier: HometaxSupplier = {
    business_number: co.business_number ?? null, company_name: co.company_name ?? null, representative: co.representative ?? null,
    address: co.address ?? null, business_type: co.business_type ?? null, business_item: co.business_item ?? null,
    email: co.tax_email || co.email || null,
  }
  const supplierProblems: string[] = []
  if (isValidBizNo(supplier.business_number) !== true) supplierProblems.push('본사 사업자등록번호가 없거나 검증에 실패했습니다')
  if (!supplier.company_name) supplierProblems.push('본사 상호가 없습니다')
  if (!supplier.representative) supplierProblems.push('본사 대표자가 없습니다')
  if (!supplier.business_type || !supplier.business_item) supplierProblems.push('본사 업태·종목(세금계산서)이 없습니다 — 본사 정보에서 입력')

  const bills = ((billsRes.data ?? []) as unknown as BillRow[]).filter(b => invStatus(b) !== '발행완료')
  const custIds = [...new Set(bills.map(b => b.customer_id))]
  const profiles = new Map<string, HometaxBuyer>()
  if (custIds.length > 0) {
    const { data: bps, error } = await admin.from('billing_profiles')
      .select('customer_id, business_no, company_name, rep_name, address, business_type, business_item, tax_email')
      .in('customer_id', custIds)
    if (error) return { error: `사업자정보 조회 실패: ${error.message}` }
    for (const p of (bps ?? []) as Array<HometaxBuyer & { customer_id: string }>) profiles.set(p.customer_id, p)
  }

  const rows: (string | number)[][] = []
  const skipped: HometaxSkip[] = []
  for (const b of bills) {
    const name = b.customers?.customer_name ?? '—'
    const p = profiles.get(b.customer_id) ?? null
    if (!p) { skipped.push({ billId: b.id, customerName: name, reason: '사업자정보 없음' }); continue }
    if (!billingProfileReady(p)) {
      skipped.push({ billId: b.id, customerName: name,
        reason: isValidBizNo(p.business_no) !== true ? '사업자등록번호 없음·검증 실패' : '수신 이메일 없음·형식 오류' })
      continue
    }
    if (!(Number(b.supply_value) > 0)) { skipped.push({ billId: b.id, customerName: name, reason: '공급가액 0' }); continue }
    rows.push(hometaxRow({
      id: b.id, bill_date: b.bill_date, bill_type: b.bill_type, billing_month: b.billing_month,
      supply_value: Number(b.supply_value), tax_value: Number(b.tax_value), total_amount: Number(b.total_amount),
      customer_name: name, customer_address: b.customers?.address ?? null,
    }, p, supplier))
  }
  // 양식 한 파일 100건 — 넘치면 자르고 개수를 알린다(101~1,000건은 홈택스 별도 메뉴)
  const truncated = Math.max(0, rows.length - HOMETAX_MAX_ROWS)
  return { month, rows: rows.slice(0, HOMETAX_MAX_ROWS), skipped, supplierProblems, truncated }
}

export type HometaxImportResult = {
  applied: number
  unmatched: HometaxResultRow[]
  ambiguous: Array<{ row: HometaxResultRow; customerNames: string[] }>
  alreadyIssued: number
}

/** 발급 결과 행(클라이언트가 엑셀에서 읽어 넘긴다) → 미발행 청구와 대조 → 승인번호·발행일 기록.
 *  짝: 작성일자(=청구일) + 공급받는자 등록번호 + 합계금액. 겹치거나 못 찾은 행은 기록하지 않고 돌려준다. */
export async function applyHometaxResultAction(rows: HometaxResultRow[]): Promise<HometaxImportResult | { error: string }> {
  await requirePermission('tax_invoice_manage')
  if (!Array.isArray(rows) || rows.length === 0) return { error: '가져올 행이 없습니다.' }
  if (rows.length > 1000) return { error: '한 번에 1,000건까지 가져올 수 있습니다.' }
  const admin = createAdminClient()

  const dates = [...new Set(rows.map(r => r.writeDate).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))]
  if (dates.length === 0) return { error: '작성일자를 읽지 못했습니다 — 결과 파일 형식을 확인해주세요.' }
  const [billsRes, issuedRes] = await Promise.all([
    admin.from('bills')
      .select('id, customer_id, bill_date, total_amount, customers:customer_id ( customer_name ), tax_invoices ( invoice_status, approval_num )')
      .in('bill_date', dates),
    admin.from('tax_invoices').select('approval_num').in('approval_num', rows.map(r => r.approvalNo)),
  ])
  if (billsRes.error) return { error: `청구 조회 실패: ${billsRes.error.message}` }
  // 이미 기록된 승인번호는 다시 붙이지 않는다(같은 파일을 두 번 올려도 결과가 같다)
  const already = new Set(((issuedRes.data ?? []) as Array<{ approval_num: string | null }>).map(r => r.approval_num).filter(Boolean) as string[])
  const fresh = rows.filter(r => !already.has(r.approvalNo))

  type B = { id: string; customer_id: string; bill_date: string; total_amount: number; customers: { customer_name: string } | null
    tax_invoices: { invoice_status: string } | Array<{ invoice_status: string }> | null }
  const open = ((billsRes.data ?? []) as unknown as B[]).filter(b => {
    const t = Array.isArray(b.tax_invoices) ? b.tax_invoices[0] : b.tax_invoices
    return t?.invoice_status !== '발행완료'
  })
  const custIds = [...new Set(open.map(b => b.customer_id))]
  const bizByCust = new Map<string, string>()
  if (custIds.length > 0) {
    const { data: bps } = await admin.from('billing_profiles').select('customer_id, business_no').in('customer_id', custIds)
    for (const p of (bps ?? []) as Array<{ customer_id: string; business_no: string | null }>) if (p.business_no) bizByCust.set(p.customer_id, p.business_no)
  }
  const candidates: MatchCandidate[] = open.filter(b => bizByCust.has(b.customer_id))
    .map(b => ({ billId: b.id, billDate: b.bill_date, buyerBizNo: bizByCust.get(b.customer_id)!, total: Number(b.total_amount) }))
  const m = matchHometaxResult(fresh, candidates)

  let applied = 0
  for (const x of m.matched) {
    const { error } = await admin.from('tax_invoices').upsert({
      bill_id: x.billId, issue_date: x.issueDate, approval_num: x.approvalNo, invoice_status: '발행완료', issued: true,
    }, { onConflict: 'bill_id' })
    if (error) console.error('[hometax import] 승인번호 기록 실패:', x.billId, error.message)
    else applied++
  }
  const nameOf = new Map(open.map(b => [b.id, b.customers?.customer_name ?? '—']))
  revalidatePath('/tax-invoices')
  revalidatePath('/billing/status')
  return {
    applied,
    unmatched: m.unmatched,
    ambiguous: m.ambiguous.map(a => ({ row: a.row, customerNames: a.billIds.map(id => nameOf.get(id) ?? '—') })),
    alreadyIssued: rows.length - fresh.length,
  }
}
