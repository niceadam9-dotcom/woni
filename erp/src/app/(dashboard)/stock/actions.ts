'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth'

export type StockMovementType = 'in' | 'out' | 'adjust'

export type CreateStockMovementInput = {
  item_id: string
  movement_type: StockMovementType
  quantity: number
  unit_price?: number
  reference_type?: string
  reference_id?: string
  notes?: string
}

export async function createStockMovementAction(input: CreateStockMovementInput): Promise<{ error?: string }> {
  const profile = await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  const { data: item } = await admin
    .from('inventory_items')
    .select('current_stock')
    .eq('id', input.item_id)
    .single()

  if (!item) return { error: '품목을 찾을 수 없습니다.' }

  const currentStock = (item as { current_stock: number }).current_stock
  let newStock = currentStock

  if (input.movement_type === 'in') newStock = currentStock + input.quantity
  else if (input.movement_type === 'out') {
    if (currentStock < input.quantity) return { error: '재고가 부족합니다.' }
    newStock = currentStock - input.quantity
  } else {
    newStock = input.quantity
  }

  const { error: mvError } = await admin
    .from('stock_movements')
    .insert({
      item_id: input.item_id,
      movement_type: input.movement_type,
      quantity: input.quantity,
      unit_price: input.unit_price ?? null,
      before_stock: currentStock,
      after_stock: newStock,
      reference_type: input.reference_type || null,
      reference_id: input.reference_id || null,
      notes: input.notes || null,
      created_by: profile.id,
    } as Record<string, unknown>)

  if (mvError) return { error: mvError.message }

  const { error: updateError } = await admin
    .from('inventory_items')
    .update({ current_stock: newStock, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', input.item_id)

  if (updateError) return { error: updateError.message }

  revalidatePath('/stock/in')
  revalidatePath('/stock/out')
  revalidatePath('/stock/status')
  revalidatePath('/stock/adjust')
  revalidatePath('/items')
  return {}
}
