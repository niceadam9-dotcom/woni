'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth'

// 세금계산서 발행 처리
export async function issueTaxInvoiceAction(input: {
  billId: string
  issueDate: string
  approvalNum?: string | null
}): Promise<{ error?: string }> {
  await requireRole(['manager', 'admin'])
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
  revalidatePath('/tax-invoices')
  revalidatePath('/billing/status')
  return {}
}

// 세금계산서 취소
export async function cancelTaxInvoiceAction(billId: string): Promise<{ error?: string }> {
  await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin
    .from('tax_invoices')
    .update({ invoice_status: '취소', issued: false })
    .eq('bill_id', billId)

  if (error) return { error: '취소에 실패했습니다.' }
  revalidatePath('/tax-invoices')
  revalidatePath('/billing/status')
  return {}
}
