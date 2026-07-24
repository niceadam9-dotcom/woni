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

  if (input.quantity <= 0) return { error: '수량은 0보다 커야 합니다.' }

  // EX-C3: 동시 출고 레이스 차단 — read→check→update 사이 경합을 CAS(compare-and-swap)로 원자화.
  // PostgREST는 current_stock = current_stock - qty 표현식 업데이트 불가 → 읽은 값을 조건(eq)으로 건 낙관적 갱신 + 재시도.
  for (let attempt = 0; attempt < 6; attempt++) {
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

    // CAS: 읽을 때의 current_stock가 그대로일 때만 갱신 (그 사이 다른 이동이 끼면 0행 → 재시도)
    const { data: updated, error: updateError } = await admin
      .from('inventory_items')
      .update({ current_stock: newStock, updated_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', input.item_id)
      .eq('current_stock', currentStock)
      .select('id')
    if (updateError) return { error: updateError.message }
    if (!updated || updated.length === 0) continue   // 경합 발생 — 재시도

    // 재고 갱신 성공(원자적) 후 이동 이력 기록
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

    revalidatePath('/stock/in')
    revalidatePath('/stock/out')
    revalidatePath('/stock/status')
    revalidatePath('/stock/adjust')
    revalidatePath('/items')
    return {}
  }
  return { error: '동시 재고 처리 충돌 — 잠시 후 다시 시도해주세요.' }
}
