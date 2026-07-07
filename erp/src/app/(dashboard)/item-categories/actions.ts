'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

export async function createCategoryAction(input: { name: string; description?: string }): Promise<{ error?: string }> {
  await requirePermission('item_category_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('item_categories')
    .insert({ name: input.name, description: input.description || null } as Record<string, unknown>)

  if (error) return { error: error.message }
  revalidatePath('/item-categories')
  revalidatePath('/items')
  return {}
}

export async function updateCategoryAction(id: string, input: { name: string; description?: string }): Promise<{ error?: string }> {
  await requirePermission('item_category_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('item_categories')
    .update({ name: input.name, description: input.description || null, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/item-categories')
  return {}
}

export async function deleteCategoryAction(id: string): Promise<{ error?: string }> {
  await requirePermission('item_category_manage')
  const admin = createAdminClient()

  const { error } = await admin.from('item_categories').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/item-categories')
  return {}
}
