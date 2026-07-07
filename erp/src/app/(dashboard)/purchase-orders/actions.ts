'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

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
