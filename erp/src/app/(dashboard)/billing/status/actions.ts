'use server'

import { revalidatePath } from 'next/cache'
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
