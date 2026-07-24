'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { createStockMovementAction } from '@/app/(dashboard)/stock/actions'

export type POStatus = 'draft' | 'ordered' | 'received' | 'cancelled'

export type CreatePOInput = {
  partner_id?: string
  order_date: string
  expected_date?: string
  notes?: string
  lines: { item_id: string; quantity: number; unit_price: number }[]
}

export async function createPurchaseOrderAction(input: CreatePOInput): Promise<{ error?: string; poId?: string }> {
  const profile = await requirePermission('purchase_order_manage')
  const admin = createAdminClient()

  const total_amount = input.lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0)

  const { data: po, error: poError } = await admin
    .from('purchase_orders')
    .insert({
      partner_id: input.partner_id || null,
      order_date: input.order_date,
      expected_date: input.expected_date || null,
      notes: input.notes || null,
      status: 'draft',
      total_amount,
      created_by: profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (poError) return { error: poError.message }
  const poId = (po as { id: string }).id

  const lines = input.lines.map(l => ({
    po_id: poId,
    item_id: l.item_id,
    quantity: l.quantity,
    unit_price: l.unit_price,
    subtotal: l.quantity * l.unit_price,
    received_quantity: 0,
  }))

  const { error: lineError } = await admin.from('purchase_order_lines').insert(lines as Record<string, unknown>[])
  if (lineError) return { error: lineError.message }

  revalidatePath('/purchase-orders')
  return { poId }
}

/** EX-S4: 발주 입고 처리 — 미입고 수량을 재고에 가산하고 발주를 '입고완료'로. 이중 입고 방지(상태 CAS + 라인별 미입고분만). */
export async function receivePurchaseOrderAction(id: string): Promise<{ error?: string; received?: number }> {
  await requirePermission('purchase_order_manage')
  const admin = createAdminClient()

  const { data: po } = await admin.from('purchase_orders').select('status').eq('id', id).single()
  if (!po) return { error: '발주를 찾을 수 없습니다.' }
  const status = (po as { status: string }).status
  if (status === 'cancelled') return { error: '취소된 발주는 입고할 수 없습니다.' }
  if (status === 'received') return { error: '이미 입고 완료된 발주입니다.' }

  // 상태 CAS 락 — 동시 이중 입고 방지(먼저 status를 received로 선점, 못 잡으면 다른 요청이 처리 중)
  const { data: locked } = await admin.from('purchase_orders')
    .update({ status: 'received', updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', id).eq('status', status).select('id')
  if (!locked || locked.length === 0) return { error: '발주 상태가 이미 변경되었습니다 — 새로고침 후 확인해주세요.' }

  // 라인별 미입고분(quantity − received_quantity)만 재고 가산 — 부분 반복 입고에도 총 발주수량 초과 없음
  const { data: lineRows } = await admin.from('purchase_order_lines')
    .select('id, item_id, quantity, received_quantity').eq('po_id', id)
  const lines = (lineRows ?? []) as Array<{ id: string; item_id: string; quantity: number; received_quantity: number | null }>
  let received = 0
  for (const l of lines) {
    const remaining = l.quantity - (l.received_quantity ?? 0)
    if (remaining <= 0) continue
    const mv = await createStockMovementAction({
      item_id: l.item_id, movement_type: 'in', quantity: remaining,
      reference_type: 'purchase_order', reference_id: id, notes: '발주 입고',
    })
    if (mv.error) return { error: `재고 반영 실패(${l.item_id}): ${mv.error}` }
    await admin.from('purchase_order_lines')
      .update({ received_quantity: l.quantity } as Record<string, unknown>).eq('id', l.id)
    received += remaining
  }

  revalidatePath('/purchase-orders')
  revalidatePath('/stock/in')
  revalidatePath('/stock/status')
  revalidatePath('/items')
  return { received }
}

export async function updatePOStatusAction(id: string, status: POStatus): Promise<{ error?: string }> {
  await requirePermission('purchase_order_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('purchase_orders')
    .update({ status, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/purchase-orders')
  return {}
}
