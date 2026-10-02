'use server'

/** ⑤ 보수 칸의 매출 사슬 — 불량 → 견적 → 수주(계약) → 청구 (비교진단 「불량 → 매출 해결방안」 1단계, 2026-10-02)
 *
 *  원칙: 새 표를 만들지 않는다. `quotes`·`orders`·`bills`에 회차·수주 외래키(마이그 166)를 더하고
 *  이 파일이 그 사이를 잇는다. `inspection_defects`에는 쓰지 않는다(상태 파생 규칙·⑤⑥ 완료 조건 불변).
 *  견적 줄(items)에는 `defect_ids`(배열)가 실려 어느 불량의 견적인지 역추적한다 — 설비 대장 절의
 *  `asset_ids`와 같은 방식이고 연결 표는 두지 않는다(줄 id가 없는 구조).
 *
 *  권한은 영업관리 모듈의 키를 그대로 쓴다: 견적 quote_create(전 직원) · 수주 order_manage(manager+) ·
 *  청구 billing_manage(manager+). 화면은 같은 키로 버튼을 가린다(page.tsx가 `can()`으로 계산해 넘김). */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getProfile } from '@/lib/auth'
import { nextSalesDocNumber } from '@/lib/sales-numbers'
import { convertHtmlToPdf } from '@/lib/pdf'
import { renderQuote } from '@/lib/doc-templates/quote'
import { formatBizNo, formatTel } from '@/lib/format-contact'
import { CONTRACT_FILE_RE } from '@/lib/doc-status'
import { todayKst } from '@/lib/kst-date'

const BUCKET = 'fire-plans'

export type RepairQuoteItem = {
  description: string
  quantity: number
  unit_price: number
  amount: number
  /** 이 줄이 가리키는 불량(선택). 불량 하나당 줄 하나가 기본 */
  defect_ids?: string[]
  /** 품목 아래 작은 글씨 — 불량 세부 */
  detail?: string | null
}

export type RepairQuote = {
  id: string
  quote_number: string
  quote_date: string
  valid_until: string | null
  status: string
  items: RepairQuoteItem[]
  subtotal: number
  tax_amount: number
  total_amount: number
  approved_at: string | null
  approved_by_name: string | null
  approval_channel: string | null
  pdf_path: string | null
}

export type RepairOrder = {
  id: string
  quote_id: string | null
  order_number: string
  order_date: string
  status: string
  total_amount: number
  tax_amount: number
  contractor_name: string | null
  contract_file_path: string | null
  completed_at: string | null
}

export type RepairBill = {
  id: string
  order_id: string | null
  billing_month: string
  bill_date: string
  total_amount: number
  paid_amount: number
}

export type RepairSalesState = { quotes: RepairQuote[]; orders: RepairOrder[]; bills: RepairBill[] }

const QUOTE_COLS = 'id, quote_number, quote_date, valid_until, status, items, subtotal, tax_amount, total_amount, approved_at, approved_by_name, approval_channel, pdf_path'
const ORDER_COLS = 'id, quote_id, order_number, order_date, status, total_amount, tax_amount, contractor_name, contract_file_path, completed_at'

/** 회차의 견적·수주·청구 한 벌 — ⑤ 칸이 열릴 때 한 번 읽는다(lazy, 상세 페이지 물결에 얹지 않는다) */
export async function getRepairSalesAction(inspectionId: string): Promise<RepairSalesState & { error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const [qRes, oRes] = await Promise.all([
    admin.from('quotes').select(QUOTE_COLS).eq('inspection_id', inspectionId).order('created_at', { ascending: false }),
    admin.from('orders').select(ORDER_COLS).eq('inspection_id', inspectionId).order('created_at', { ascending: false }),
  ])
  if (qRes.error || oRes.error) {
    console.error('[repair-sales] 조회 실패:', qRes.error ?? oRes.error)
    return { quotes: [], orders: [], bills: [], error: '견적·수주를 불러오지 못했습니다.' }
  }
  const orders = (oRes.data ?? []) as unknown as RepairOrder[]
  let bills: RepairBill[] = []
  if (orders.length) {
    const bRes = await admin.from('bills').select('id, order_id, billing_month, bill_date, total_amount, paid_amount')
      .in('order_id', orders.map(o => o.id))
    if (bRes.error) console.error('[repair-sales] 청구 조회 실패:', bRes.error)
    bills = (bRes.data ?? []) as unknown as RepairBill[]
  }
  return { quotes: (qRes.data ?? []) as unknown as RepairQuote[], orders, bills }
}

function revalidateAll(inspectionId: string) {
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/quotes')
  revalidatePath('/orders')
}

/** 「견적 만들기」 — 체크한 불량을 줄로 삼아 견적 1건. 불량 쪽에는 쓰지 않는다. */
export async function createDefectQuoteAction(input: {
  inspectionId: string
  lines: Array<{ defectId: string; description: string; detail?: string | null; quantity: number; unitPrice: number }>
  validUntil?: string | null
  notes?: string | null
}): Promise<{ error?: string; quoteId?: string }> {
  await requirePermission('quote_create')
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }
  if (!input.lines.length) return { error: '견적에 넣을 불량을 하나 이상 고르세요.' }
  for (const l of input.lines) {
    if (!l.description.trim()) return { error: '품목명이 빈 줄이 있습니다.' }
    if (!(l.quantity > 0) || !Number.isFinite(l.unitPrice) || l.unitPrice < 0) return { error: '수량·단가를 확인하세요.' }
  }
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', input.inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const customerId = (insp as { customer_id: string }).customer_id

  // 불량이 이 회차의 것인지 — 다른 회차의 불량 id가 섞여 들어오면 견적이 엉뚱한 회차를 가리킨다
  const { data: defs } = await admin.from('inspection_defects').select('id').eq('inspection_id', input.inspectionId)
    .in('id', input.lines.map(l => l.defectId))
  const known = new Set(((defs ?? []) as Array<{ id: string }>).map(d => d.id))
  if (input.lines.some(l => !known.has(l.defectId))) return { error: '이 회차의 불량이 아닌 항목이 있습니다.' }

  const today = todayKst()
  const items: RepairQuoteItem[] = input.lines.map(l => ({
    description: l.description.trim(),
    detail: l.detail?.trim() || null,
    quantity: l.quantity,
    unit_price: Math.round(l.unitPrice),
    amount: Math.round(l.unitPrice) * l.quantity,
    defect_ids: [l.defectId],
  }))
  const subtotal = items.reduce((s, i) => s + i.amount, 0)
  const taxAmount = Math.round(subtotal * 0.1)
  const quoteNumber = await nextSalesDocNumber(admin, 'quotes', today)
  const { data, error } = await admin.from('quotes').insert({
    customer_id: customerId,
    inspection_id: input.inspectionId,
    source: 'defect',
    quote_number: quoteNumber,
    quote_date: today,
    valid_until: input.validUntil ?? null,
    items,
    subtotal, tax_amount: taxAmount, total_amount: subtotal + taxAmount,
    notes: input.notes ?? null,
    created_by: profile.id,
  }).select('id').single()
  if (error) { console.error('[repair-sales] 견적 생성 실패:', error); return { error: '견적 생성에 실패했습니다.' } }
  revalidateAll(input.inspectionId)
  return { quoteId: (data as { id: string }).id }
}

/** 발송 표시 — 1단계는 수단만 기록한다(링크 발송은 2단계 포털). 작성중 → 발송 */
export async function markQuoteSentAction(quoteId: string): Promise<{ error?: string }> {
  await requirePermission('quote_create')
  const admin = createAdminClient()
  const { data: q } = await admin.from('quotes').select('status, inspection_id').eq('id', quoteId).single()
  if (!q) return { error: '견적을 찾을 수 없습니다.' }
  const row = q as { status: string; inspection_id: string | null }
  if (row.status !== '작성중') return { error: `「${row.status}」 상태에서는 발송 표시를 할 수 없습니다.` }
  const { error } = await admin.from('quotes').update({ status: '발송' }).eq('id', quoteId)
  if (error) return { error: '상태 변경에 실패했습니다.' }
  if (row.inspection_id) revalidateAll(row.inspection_id)
  return {}
}

/** 관계인 승인 기록 — 전자서명이 아니라 「견적을 보고 진행에 동의했다」는 시각 증빙.
 *  1단계는 전화·메일·서면으로 받은 승인을 사람이 적는다. 포털 승인(portal)은 2단계가 쓴다. */
export async function approveQuoteAction(input: {
  quoteId: string; approvedByName: string; channel: 'email' | 'phone' | 'paper'
}): Promise<{ error?: string }> {
  await requirePermission('quote_manage')
  const admin = createAdminClient()
  const name = input.approvedByName.trim()
  if (!name) return { error: '승인한 관계인 이름을 적으세요.' }
  const { data: q } = await admin.from('quotes').select('status, inspection_id').eq('id', input.quoteId).single()
  if (!q) return { error: '견적을 찾을 수 없습니다.' }
  const row = q as { status: string; inspection_id: string | null }
  if (!['작성중', '발송'].includes(row.status)) return { error: `「${row.status}」 상태에서는 승인을 기록할 수 없습니다.` }
  const { error } = await admin.from('quotes').update({
    status: '승인', approved_at: new Date().toISOString(), approved_by_name: name, approval_channel: input.channel,
  }).eq('id', input.quoteId)
  if (error) { console.error('[repair-sales] 승인 기록 실패:', error); return { error: '승인 기록에 실패했습니다.' } }
  if (row.inspection_id) revalidateAll(row.inspection_id)
  return {}
}

export async function cancelQuoteAction(quoteId: string): Promise<{ error?: string }> {
  await requirePermission('quote_manage')
  const admin = createAdminClient()
  const { data: q } = await admin.from('quotes').select('status, inspection_id').eq('id', quoteId).single()
  if (!q) return { error: '견적을 찾을 수 없습니다.' }
  const row = q as { status: string; inspection_id: string | null }
  if (row.status === '수주') return { error: '수주로 전환된 견적은 취소할 수 없습니다 — 수주를 취소하세요.' }
  const { error } = await admin.from('quotes').update({ status: '취소' }).eq('id', quoteId)
  if (error) return { error: '취소에 실패했습니다.' }
  if (row.inspection_id) revalidateAll(row.inspection_id)
  return {}
}

/** 「수주로 전환」 — orders 1건 = 공사 계약. ⑤ 칸에 올린 계약서(contract_*)가 있으면 그 경로를 싣는다.
 *  시공사 칸이 비면 자사 시공(별지 11호 「소방공사업체」는 company_profile). */
export async function convertQuoteToOrderAction(input: {
  quoteId: string
  contractor?: { name: string; bizNo?: string; rep?: string; phone?: string; address?: string } | null
  deliveryDate?: string | null
}): Promise<{ error?: string; orderId?: string }> {
  await requirePermission('order_manage')
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()
  const { data: q } = await admin.from('quotes').select('id, customer_id, inspection_id, status, items, subtotal, tax_amount, total_amount')
    .eq('id', input.quoteId).single()
  if (!q) return { error: '견적을 찾을 수 없습니다.' }
  const quote = q as { id: string; customer_id: string; inspection_id: string | null; status: string; items: RepairQuoteItem[]; subtotal: number; tax_amount: number; total_amount: number }
  if (!['발송', '승인'].includes(quote.status)) return { error: `「${quote.status}」 상태의 견적은 수주로 전환할 수 없습니다(발송 또는 승인 뒤).` }
  // 같은 견적으로 수주를 두 번 만들지 않는다
  const { count } = await admin.from('orders').select('id', { count: 'exact', head: true }).eq('quote_id', quote.id).neq('status', '취소')
  if ((count ?? 0) > 0) return { error: '이 견적은 이미 수주로 전환돼 있습니다.' }

  // ⑤ 칸 계약서 — 회차 접두의 contract_* 최신본
  let contractPath: string | null = null
  if (quote.inspection_id) {
    const prefix = `${quote.customer_id}/inspections/${quote.inspection_id}`
    const { data: objects } = await admin.storage.from(BUCKET).list(prefix, { limit: 100, sortBy: { column: 'name', order: 'desc' } })
    const c = (objects ?? []).find(o => CONTRACT_FILE_RE.test(o.name))
    if (c) contractPath = `${prefix}/${c.name}`
  }

  const today = todayKst()
  const orderNumber = await nextSalesDocNumber(admin, 'orders', today)
  const ct = input.contractor && input.contractor.name.trim() ? input.contractor : null
  const { data, error } = await admin.from('orders').insert({
    customer_id: quote.customer_id,
    inspection_id: quote.inspection_id,
    quote_id: quote.id,
    order_number: orderNumber,
    order_date: today,
    delivery_date: input.deliveryDate ?? null,
    items: quote.items,
    total_amount: quote.total_amount,
    tax_amount: quote.tax_amount,
    contract_file_path: contractPath,
    contractor_name: ct?.name.trim() ?? null,
    contractor_biz_no: ct?.bizNo?.replace(/\D/g, '') || null,
    contractor_rep: ct?.rep?.trim() || null,
    contractor_phone: ct?.phone?.trim() || null,
    contractor_address: ct?.address?.trim() || null,
    created_by: profile.id,
  }).select('id').single()
  if (error) { console.error('[repair-sales] 수주 생성 실패:', error); return { error: '수주 생성에 실패했습니다.' } }
  await admin.from('quotes').update({ status: '수주' }).eq('id', quote.id)
  if (quote.inspection_id) revalidateAll(quote.inspection_id)
  return { orderId: (data as { id: string }).id }
}

/** 수주 상태 — 수주 → 진행중 → 완료(completed_at 기록) / 취소 */
export async function setRepairOrderStatusAction(input: {
  orderId: string; status: '수주' | '진행중' | '완료' | '취소'
}): Promise<{ error?: string }> {
  await requirePermission('order_manage')
  const admin = createAdminClient()
  const { data: o } = await admin.from('orders').select('inspection_id, status').eq('id', input.orderId).single()
  if (!o) return { error: '수주를 찾을 수 없습니다.' }
  const row = o as { inspection_id: string | null; status: string }
  if (input.status === '취소') {
    const { count } = await admin.from('bills').select('id', { count: 'exact', head: true }).eq('order_id', input.orderId)
    if ((count ?? 0) > 0) return { error: '청구가 만들어진 수주는 취소할 수 없습니다 — 청구를 먼저 정리하세요.' }
  }
  const patch: Record<string, unknown> = { status: input.status }
  patch.completed_at = input.status === '완료' ? todayKst() : null
  const { error } = await admin.from('orders').update(patch).eq('id', input.orderId)
  if (error) return { error: '상태 변경에 실패했습니다.' }
  if (row.inspection_id) revalidateAll(row.inspection_id)
  revalidatePath('/billing/status')
  return {}
}

/** 「청구 만들기」 — 완료된 수주 1건 → bills 건별·보수공사 1건. 월정액 크론과 별건이며 수주당 1건. */
export async function createRepairBillAction(input: { orderId: string; billDate?: string | null }): Promise<{ error?: string; billId?: string }> {
  await requirePermission('billing_manage')
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()
  const { data: o } = await admin.from('orders').select('id, customer_id, inspection_id, order_number, status, total_amount, tax_amount, completed_at')
    .eq('id', input.orderId).single()
  if (!o) return { error: '수주를 찾을 수 없습니다.' }
  const order = o as { id: string; customer_id: string; inspection_id: string | null; order_number: string; status: string; total_amount: number; tax_amount: number; completed_at: string | null }
  if (order.status !== '완료') return { error: '완료된 수주만 청구할 수 있습니다.' }
  const { count } = await admin.from('bills').select('id', { count: 'exact', head: true }).eq('order_id', order.id)
  if ((count ?? 0) > 0) return { error: '이 수주의 청구는 이미 만들어져 있습니다.' }

  const billDate = input.billDate ?? order.completed_at ?? todayKst()
  const total = Number(order.total_amount)
  const tax = Number(order.tax_amount)
  const { data, error } = await admin.from('bills').insert({
    customer_id: order.customer_id,
    order_id: order.id,
    inspection_plan_item_id: null,
    billing_month: billDate.slice(0, 7).replace('-', '.'),
    bill_type: '보수공사',
    bill_date: billDate,
    supply_value: total - tax,
    tax_value: tax,
    total_amount: total,
    paid_amount: 0,
    fee_type: '건별',
    notes: `수주 ${order.order_number} 보수공사`,
    created_by: profile.id,
  } as Record<string, unknown>).select('id').single()
  if (error) { console.error('[repair-sales] 청구 생성 실패:', error); return { error: '청구 생성에 실패했습니다.' } }
  revalidatePath('/billing/status')
  if (order.inspection_id) revalidateAll(order.inspection_id)
  return { billId: (data as { id: string }).id }
}

function kdateLong(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

/** 견적 PDF 1장 — 생성해 fire-plans/{customer}/quotes/ 에 보관하고 서명 URL(300초)을 돌려준다.
 *  이미 있으면 다시 만들지 않고 URL만(재생성은 regenerate=true). */
export async function generateQuotePdfAction(input: { quoteId: string; regenerate?: boolean }): Promise<{ error?: string; url?: string; fileName?: string }> {
  await requirePermission('quote_create')
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()
  const { data: q } = await admin.from('quotes')
    .select('id, customer_id, inspection_id, quote_number, quote_date, valid_until, items, subtotal, tax_amount, total_amount, notes, pdf_path, customer:customers(customer_name, address, phone)')
    .eq('id', input.quoteId).single()
  if (!q) return { error: '견적을 찾을 수 없습니다.' }
  const quote = q as unknown as {
    id: string; customer_id: string; inspection_id: string | null; quote_number: string; quote_date: string; valid_until: string | null
    items: RepairQuoteItem[]; subtotal: number; tax_amount: number; total_amount: number; notes: string | null; pdf_path: string | null
    customer: { customer_name: string; address: string | null; phone: string | null } | null
  }
  const fileName = `${(quote.customer?.customer_name ?? '고객').replace(/[\\/:*?"<>|]/g, '_')}_견적서_${quote.quote_number}.pdf`
  if (quote.pdf_path && !input.regenerate) {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(quote.pdf_path, 300)
    if (signed?.signedUrl) return { url: signed.signedUrl, fileName }
  }

  const { data: companyRows } = await admin.from('company_profile')
    .select('company_name, business_number, representative, phone, address').limit(1)
  const company = (companyRows?.[0] ?? {}) as { company_name?: string; business_number?: string; representative?: string; phone?: string; address?: string }
  let inspectionLabel = ''
  if (quote.inspection_id) {
    const { data: insp } = await admin.from('inspections').select('inspection_type, year, inspection_start_date').eq('id', quote.inspection_id).single()
    const i = insp as { inspection_type: string; year: number | null; inspection_start_date: string | null } | null
    if (i) inspectionLabel = `${i.year ?? i.inspection_start_date?.slice(0, 4) ?? ''}년 ${i.inspection_type}점검${i.inspection_start_date ? ` (${i.inspection_start_date})` : ''}`
  }
  const html = renderQuote({
    quoteNumber: quote.quote_number,
    quoteDate: kdateLong(quote.quote_date),
    validUntil: kdateLong(quote.valid_until),
    company: {
      name: company.company_name ?? '', bizNo: formatBizNo(company.business_number), rep: company.representative ?? '',
      phone: formatTel(company.phone), address: company.address ?? '',
    },
    customer: { name: quote.customer?.customer_name ?? '', address: quote.customer?.address ?? '', contact: formatTel(quote.customer?.phone) },
    inspectionLabel,
    items: (quote.items ?? []).map(it => ({ description: it.description, quantity: Number(it.quantity), unit_price: Number(it.unit_price), amount: Number(it.amount), detail: it.detail ?? null })),
    subtotal: Number(quote.subtotal), taxAmount: Number(quote.tax_amount), totalAmount: Number(quote.total_amount),
    notes: quote.notes ?? '',
  })
  let pdf: Uint8Array
  try { pdf = await convertHtmlToPdf(html, [], { marginMode: 'none' }) }
  catch (e) { return { error: `PDF 변환 실패: ${e instanceof Error ? e.message : String(e)}` } }
  const path = `${quote.customer_id}/quotes/${quote.id}_${Date.now()}.pdf`
  const up = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf' })
  if (up.error) return { error: `PDF 업로드 실패: ${up.error.message}` }
  await admin.from('quotes').update({ pdf_path: path }).eq('id', quote.id)
  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 300)
  if (quote.inspection_id) revalidateAll(quote.inspection_id)
  return { url: signed?.signedUrl, fileName }
}
