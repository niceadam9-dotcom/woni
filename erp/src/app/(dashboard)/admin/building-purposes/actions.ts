'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile } from '@/lib/auth'

async function requireAdmin() {
  const profile = await getProfile()
  if (!profile || profile.role !== 'admin') throw new Error('관리자만 가능합니다.')
  return profile
}

export async function addBuildingPurposeAction(name: string): Promise<{ error?: string }> {
  await requireAdmin()
  const trimmed = name.trim()
  if (!trimmed) return { error: '용도명을 입력해주세요.' }
  if (trimmed.length > 30) return { error: '용도명은 30자 이내로 입력해주세요.' }

  const admin = createAdminClient()
  // '기타'(sort 999) 앞에 오도록 현재 최대 순서 + 10
  const { data: maxRaw } = await admin
    .from('building_purposes')
    .select('sort_order')
    .lt('sort_order', 999)
    .order('sort_order', { ascending: false })
    .limit(1)
  const nextOrder = ((maxRaw?.[0] as { sort_order: number } | undefined)?.sort_order ?? 0) + 10

  const { error } = await admin
    .from('building_purposes')
    .insert({ name: trimmed, sort_order: nextOrder } as Record<string, unknown>)

  if (error) {
    if (error.code === '23505') return { error: '이미 등록된 용도입니다.' }
    return { error: '추가에 실패했습니다.' }
  }
  revalidatePath('/admin/building-purposes')
  return {}
}

export async function deleteBuildingPurposeAction(id: string): Promise<{ error?: string }> {
  await requireAdmin()
  const admin = createAdminClient()
  const { error } = await admin.from('building_purposes').delete().eq('id', id)
  if (error) return { error: '삭제에 실패했습니다.' }
  revalidatePath('/admin/building-purposes')
  return {}
}
