'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

export type CreateItemInput = {
  item_code: string
  item_name: string
  category_id?: string
  unit?: string
  standard_price?: number
  description?: string
}

/** 접두어 기반으로 다음 품목코드를 생성합니다. 예: prefix='ITEM' → 'ITEM-001' */
export async function generateItemCodeAction(prefix: string = 'ITEM'): Promise<{ code?: string; error?: string }> {
  await requirePermission('item_manage')
  const admin = createAdminClient()

  const cleanPrefix = prefix.trim().toUpperCase()
  if (!cleanPrefix) return { error: '접두어를 입력해주세요.' }

  const { data, error } = await admin
    .from('inventory_items')
    .select('item_code')
    .ilike('item_code', `${cleanPrefix}%`)
    .limit(200)

  if (error) return { error: '코드 조회에 실패했습니다.' }

  const escapedPrefix = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${escapedPrefix}[-_]?(\\d+)$`, 'i')
  let maxNum = 0
  for (const row of (data ?? []) as { item_code: string }[]) {
    const match = row.item_code.match(pattern)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > maxNum) maxNum = num
    }
  }

  const nextNum = maxNum + 1
  const code = `${cleanPrefix}-${String(nextNum).padStart(3, '0')}`
  return { code }
}

export async function createItemAction(input: CreateItemInput): Promise<{ error?: string }> {
  await requirePermission('item_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('inventory_items')
    .insert({
      item_code: input.item_code,
      item_name: input.item_name,
      category_id: input.category_id || null,
      unit: input.unit || null,
      standard_price: input.standard_price ?? null,
      description: input.description || null,
      current_stock: 0,
      is_active: true,
    } as Record<string, unknown>)

  if (error) return { error: error.message }
  revalidatePath('/items')
  return {}
}

export async function updateItemAction(id: string, input: Partial<CreateItemInput> & { is_active?: boolean }): Promise<{ error?: string }> {
  await requirePermission('item_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('inventory_items')
    .update({
      ...input,
      category_id: input.category_id || null,
      unit: input.unit || null,
      standard_price: input.standard_price ?? null,
      description: input.description || null,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/items')
  return {}
}
