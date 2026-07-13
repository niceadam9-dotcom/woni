'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

export type OwnerOption = { id: string; name: string; contact: string | null }

/** 소유자 그룹 목록 (P4-4) */
export async function listOwnersAction(): Promise<OwnerOption[]> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data } = await admin.from('owners').select('id, name, contact').order('name')
  return (data ?? []) as OwnerOption[]
}

/** 소유자 그룹 신규 생성 후 반환 */
export async function createOwnerAction(
  input: { name: string; contact?: string }
): Promise<{ error?: string; owner?: OwnerOption }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const name = input.name.trim()
  if (!name) return { error: '소유자명을 입력하세요.' }
  const { data, error } = await admin.from('owners')
    .insert({ name, contact: input.contact?.trim() || null, created_by: profile.id } as Record<string, unknown>)
    .select('id, name, contact').single()
  if (error) return { error: `소유자 생성 실패: ${error.message}` }
  return { owner: data as OwnerOption }
}

/** 고객에 소유자 그룹 지정/해제 (null이면 개별 관리) */
export async function assignOwnerAction(
  customerId: string, ownerId: string | null
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { error } = await admin.from('customers')
    .update({ owner_id: ownerId } as Record<string, unknown>).eq('id', customerId)
  if (error) return { error: `소유자 지정 실패: ${error.message}` }
  revalidatePath(`/customers/${customerId}`)
  return {}
}
