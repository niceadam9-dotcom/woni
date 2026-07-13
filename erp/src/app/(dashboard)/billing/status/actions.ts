'use server'

import { revalidatePath } from 'next/cache'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'

// 청구서 등록
export async function createBillAction(input: {
  customerId: string
  inspectionPlanItemId?: string | null
  billingMonth: string
  billType: string
  billDate: string
  supplyValue: number
  taxValue: number
  totalAmount: number
  feeType?: '정액' | '건별'
  notes?: string | null
}): Promise<{ error?: string; id?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  await requirePermission('billing_manage')
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('bills')
    .insert({
      customer_id:              input.customerId,
      inspection_plan_item_id:  input.inspectionPlanItemId ?? null,
      billing_month:            input.billingMonth,
      bill_type:                input.billType,
      bill_date:                input.billDate,
      supply_value:             input.supplyValue,
      tax_value:                input.taxValue,
      total_amount:             input.totalAmount,
      paid_amount:              0,
      fee_type:                 input.feeType ?? '건별',
      notes:                    input.notes ?? null,
      created_by:               user.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: '청구서 등록에 실패했습니다.' }
  revalidatePath('/billing/status')
  return { id: (data as { id: string }).id }
}

/**
 * 월정액 자동청구 생성 (P4-3) — 종합·작동 고객의 월정액을 지정 월(YYYY.MM)에 일괄 청구.
 * 이미 해당 월 정액 청구가 있으면 건너뜀(멱등). 반복 실행/크론에서 호출 가능.
 */
export async function generateMonthlyFixedBillsAction(input: {
  billingMonth: string   // 'YYYY.MM'
  billDate: string       // 'YYYY-MM-DD'
}): Promise<{ error?: string; created?: number; skipped?: number }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  await requirePermission('billing_manage')
  const admin = createAdminClient()

  const { data: custs } = await admin.from('customers')
    .select('id, inspection_type, monthly_fee_untaxed, monthly_fee_taxed')
    .eq('is_active', true).in('inspection_type', ['종합', '작동'])
  const rows = (custs ?? []) as Array<{
    id: string; inspection_type: string
    monthly_fee_untaxed: number | null; monthly_fee_taxed: number | null
  }>

  const { data: existing } = await admin.from('bills')
    .select('customer_id').eq('billing_month', input.billingMonth).eq('fee_type', '정액')
  const have = new Set(((existing ?? []) as Array<{ customer_id: string }>).map(e => e.customer_id))

  let created = 0, skipped = 0
  const toInsert: Record<string, unknown>[] = []
  for (const c of rows) {
    const supply = c.monthly_fee_untaxed ?? 0
    const total = c.monthly_fee_taxed ?? 0
    if (supply <= 0 && total <= 0) { skipped++; continue }   // 월정액 미설정
    if (have.has(c.id)) { skipped++; continue }
    const tax = total > supply ? total - supply : Math.round(supply * 0.1)
    toInsert.push({
      customer_id: c.id, inspection_plan_item_id: null,
      billing_month: input.billingMonth, bill_type: '월정액',
      bill_date: input.billDate,
      supply_value: supply, tax_value: tax, total_amount: total > 0 ? total : supply + tax,
      paid_amount: 0, fee_type: '정액', created_by: user.id,
    })
    created++
  }
  if (toInsert.length) {
    const { error } = await admin.from('bills').insert(toInsert)
    if (error) return { error: `월정액 청구 생성 실패: ${error.message}` }
  }
  revalidatePath('/billing/status')
  return { created, skipped }
}

// ── 입금 문자 파싱·매칭 (P4-5, §4-6-1) ───────────────────────────────────────
type ParsedDeposit = { amount: number | null; name: string | null; raw: string }

/** 은행 알림문자에서 금액·입금자명 추출 — 정규식 우선, 실패 시 AI 폴백 */
function regexParseDeposit(text: string): ParsedDeposit {
  const t = text.replace(/\s+/g, ' ').trim()
  // 금액: '입금' 근처 또는 '원' 앞의 콤마 그룹 숫자 (가장 큰 값 = 잔액과 혼동 방지 위해 '입금' 우선)
  let amount: number | null = null
  const depMatch = t.match(/입금\D{0,6}([\d,]{2,})/) || t.match(/([\d,]{2,})\s*원/)
  if (depMatch) { const n = parseInt(depMatch[1].replace(/,/g, ''), 10); if (Number.isFinite(n)) amount = n }
  // 입금자명: '님' 앞의 한글 2~4자, 또는 '입금' 뒤 한글 이름
  let name: string | null = null
  const nameMatch = t.match(/([가-힣]{2,4})\s*님/) || t.match(/입금\s*([가-힣]{2,4})/)
  if (nameMatch) name = nameMatch[1]
  return { amount, name, raw: text }
}

async function aiParseDeposit(text: string): Promise<ParsedDeposit> {
  if (!process.env.ANTHROPIC_API_KEY) return { amount: null, name: null, raw: text }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const res = await client.messages.create({
      model: 'claude-opus-4-8', max_tokens: 300,
      system: '은행 입금 알림 문자에서 입금 금액(원)과 입금자명을 추출한다. 반드시 JSON만 반환: {"amount": 숫자|null, "name": "이름"|null}. 잔액은 무시하고 이번 입금액만.',
      messages: [{ role: 'user', content: text }],
    })
    const blk = res.content.find(b => b.type === 'text')
    if (!blk || blk.type !== 'text') return { amount: null, name: null, raw: text }
    const m = blk.text.match(/\{[\s\S]*\}/)
    if (!m) return { amount: null, name: null, raw: text }
    const j = JSON.parse(m[0]) as { amount: number | null; name: string | null }
    return { amount: typeof j.amount === 'number' ? j.amount : null, name: j.name ?? null, raw: text }
  } catch { return { amount: null, name: null, raw: text } }
}

export type DepositMatch = {
  billId: string; customerName: string; billingMonth: string
  total: number; unpaid: number; score: number
}

/** 입금 문자 붙여넣기 → 파싱 → 미납 청구 후보 매칭 (자동 적용 안 함, 확인 후 updateBillPayment) */
export async function parseAndMatchDepositAction(
  text: string
): Promise<{ error?: string; parsed?: ParsedDeposit; matches?: DepositMatch[] }> {
  await requirePermission('billing_manage')
  if (!text?.trim()) return { error: '문자 내용이 비어 있습니다.' }

  let parsed = regexParseDeposit(text)
  if (parsed.amount == null || parsed.name == null) {
    const ai = await aiParseDeposit(text)
    parsed = { amount: parsed.amount ?? ai.amount, name: parsed.name ?? ai.name, raw: text }
  }

  const admin = createAdminClient()
  const { data } = await admin.from('bills')
    .select('id, billing_month, total_amount, paid_amount, customers(customer_name)')
    .order('bill_date', { ascending: false }).limit(500)
  type Row = { id: string; billing_month: string; total_amount: number; paid_amount: number; customers: { customer_name: string } | { customer_name: string }[] | null }
  const rows = (data ?? []) as unknown as Row[]

  const matches: DepositMatch[] = []
  for (const r of rows) {
    const unpaid = r.total_amount - r.paid_amount
    if (unpaid <= 0) continue
    const cust = Array.isArray(r.customers) ? r.customers[0] : r.customers
    const cname = cust?.customer_name ?? ''
    let score = 0
    if (parsed.amount != null && unpaid === parsed.amount) score += 3
    else if (parsed.amount != null && r.total_amount === parsed.amount) score += 2
    if (parsed.name && cname.includes(parsed.name)) score += 2
    if (score === 0) continue
    matches.push({ billId: r.id, customerName: cname, billingMonth: r.billing_month, total: r.total_amount, unpaid, score })
  }
  matches.sort((a, b) => b.score - a.score)
  return { parsed, matches: matches.slice(0, 10) }
}

/**
 * 소유자 통합 입금 배분 (P4-4) — 소유자 소속 고객들의 미납 청구에 오래된 순으로 배분.
 * @returns 배분된 건수·잔액
 */
export async function allocateOwnerPaymentAction(input: {
  ownerId: string; amount: number; paidAt: string
}): Promise<{ error?: string; allocated?: number; remainder?: number }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  await requirePermission('billing_manage')
  const admin = createAdminClient()
  if (!(input.amount > 0)) return { error: '배분 금액이 올바르지 않습니다.' }

  const { data: custs } = await admin.from('customers').select('id').eq('owner_id', input.ownerId)
  const custIds = ((custs ?? []) as Array<{ id: string }>).map(c => c.id)
  if (custIds.length === 0) return { error: '소유자에 연결된 고객이 없습니다.' }

  const { data: billRows } = await admin.from('bills')
    .select('id, total_amount, paid_amount')
    .in('customer_id', custIds).order('bill_date', { ascending: true })
  const bills = ((billRows ?? []) as Array<{ id: string; total_amount: number; paid_amount: number }>)
    .filter(b => b.total_amount - b.paid_amount > 0)

  let remaining = input.amount, allocated = 0
  for (const b of bills) {
    if (remaining <= 0) break
    const due = b.total_amount - b.paid_amount
    const pay = Math.min(due, remaining)
    const newPaid = b.paid_amount + pay
    const { error } = await admin.from('bills')
      .update({ paid_amount: newPaid, paid_at: newPaid >= b.total_amount ? input.paidAt : null, payment_method: '통합입금' } as Record<string, unknown>)
      .eq('id', b.id)
    if (error) return { error: `배분 실패: ${error.message}` }
    remaining -= pay; allocated++
  }
  revalidatePath('/billing/status')
  revalidatePath('/billing/annual')
  return { allocated, remainder: remaining }
}

// 입금 처리
export async function updateBillPaymentAction(input: {
  id: string
  paidAt: string | null
  paidAmount: number
  paymentMethod?: string | null
  notes?: string | null
}): Promise<{ error?: string }> {
  await requirePermission('billing_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('bills')
    .update({
      paid_at:         input.paidAt,
      paid_amount:     input.paidAmount,
      payment_method:  input.paymentMethod ?? null,
      notes:           input.notes ?? null,
    })
    .eq('id', input.id)

  if (error) return { error: '입금 처리에 실패했습니다.' }
  revalidatePath('/billing/status')
  return {}
}

// 세금계산서 발행 처리
export async function issueTaxInvoiceAction(input: {
  billId: string
  issueDate: string
  approvalNum?: string | null
}): Promise<{ error?: string }> {
  await requirePermission('billing_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('tax_invoices')
    .upsert({
      bill_id:        input.billId,
      issue_date:     input.issueDate,
      approval_num:   input.approvalNum ?? null,
      invoice_status: '발행완료',
      issued:         true,
    }, { onConflict: 'bill_id' })

  if (error) return { error: '세금계산서 발행에 실패했습니다.' }
  revalidatePath('/billing/status')
  revalidatePath('/tax-invoices')
  return {}
}
