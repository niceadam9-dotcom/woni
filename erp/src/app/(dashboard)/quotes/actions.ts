'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getProfile } from '@/lib/auth'

export type QuoteItem = {
  description: string
  quantity: number
  unit_price: number
  amount: number
}

export async function createQuoteAction(input: {
  customerId: string
  quoteDate: string
  validUntil?: string | null
  items: QuoteItem[]
  notes?: string | null
}): Promise<{ error?: string }> {
  await requirePermission('quote_create')
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }

  const admin = createAdminClient()

  // 견적번호 자동 생성: QT-YYYYMMDD-NNN
  const datePrefix = input.quoteDate.replace(/-/g, '')
  const { count } = await admin
    .from('quotes')
    .select('id', { count: 'exact', head: true })
    .like('quote_number', `QT-${datePrefix}-%`)
  const seq = String((count ?? 0) + 1).padStart(3, '0')
  const quoteNumber = `QT-${datePrefix}-${seq}`

  const subtotal    = input.items.reduce((s, i) => s + i.amount, 0)
  const taxAmount   = Math.round(subtotal * 0.1)
  const totalAmount = subtotal + taxAmount

  const { error } = await admin.from('quotes').insert({
    customer_id:  input.customerId,
    quote_number: quoteNumber,
    quote_date:   input.quoteDate,
    valid_until:  input.validUntil ?? null,
    items:        input.items,
    subtotal,
    tax_amount:   taxAmount,
    total_amount: totalAmount,
    notes:        input.notes ?? null,
    created_by:   profile.id,
  })

  if (error) return { error: '견적서 등록에 실패했습니다.' }
  revalidatePath('/quotes')
  return {}
}

export async function updateQuoteStatusAction(
  id: string,
  status: string
): Promise<{ error?: string }> {
  await requirePermission('quote_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('quotes')
    .update({ status })
    .eq('id', id)

  if (error) return { error: '상태 변경에 실패했습니다.' }
  revalidatePath('/quotes')
  return {}
}

export async function deleteQuoteAction(id: string): Promise<{ error?: string }> {
  await requirePermission('quote_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('quotes')
    .delete()
    .eq('id', id)

  if (error) return { error: '삭제에 실패했습니다.' }
  revalidatePath('/quotes')
  return {}
}
