'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getProfile } from '@/lib/auth'

export type OrderItem = {
  description: string
  quantity: number
  unit_price: number
  amount: number
}

export async function createOrderAction(input: {
  customerId: string
  quoteId?: string | null
  orderDate: string
  deliveryDate?: string | null
  items: OrderItem[]
  notes?: string | null
}): Promise<{ error?: string }> {
  await requirePermission('order_manage')
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }

  const admin = createAdminClient()

  // 수주번호 자동 생성: OR-YYYYMMDD-NNN
  const datePrefix = input.orderDate.replace(/-/g, '')
  const { count } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .like('order_number', `OR-${datePrefix}-%`)
  const seq = String((count ?? 0) + 1).padStart(3, '0')
  const orderNumber = `OR-${datePrefix}-${seq}`

  const totalAmount = input.items.reduce((s, i) => s + i.amount, 0)

  const { error } = await admin.from('orders').insert({
    customer_id:   input.customerId,
    quote_id:      input.quoteId ?? null,
    order_number:  orderNumber,
    order_date:    input.orderDate,
    delivery_date: input.deliveryDate ?? null,
    items:         input.items,
    total_amount:  totalAmount,
    notes:         input.notes ?? null,
    created_by:    profile.id,
  })

  if (error) return { error: '수주 등록에 실패했습니다.' }

  // 연결된 견적서가 있으면 상태 → 수주
  if (input.quoteId) {
    await admin.from('quotes').update({ status: '수주' }).eq('id', input.quoteId)
  }

  revalidatePath('/orders')
  revalidatePath('/quotes')
  return {}
}

export async function updateOrderStatusAction(
  id: string,
  status: string
): Promise<{ error?: string }> {
  await requirePermission('order_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('orders')
    .update({ status })
    .eq('id', id)

  if (error) return { error: '상태 변경에 실패했습니다.' }
  revalidatePath('/orders')
  return {}
}

export async function deleteOrderAction(id: string): Promise<{ error?: string }> {
  await requirePermission('order_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('orders')
    .delete()
    .eq('id', id)

  if (error) return { error: '삭제에 실패했습니다.' }
  revalidatePath('/orders')
  return {}
}
