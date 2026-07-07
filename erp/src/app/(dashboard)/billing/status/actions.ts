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
      notes:                    input.notes ?? null,
      created_by:               user.id,
    })
    .select('id')
    .single()

  if (error) return { error: '청구서 등록에 실패했습니다.' }
  revalidatePath('/billing/status')
  return { id: (data as { id: string }).id }
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
