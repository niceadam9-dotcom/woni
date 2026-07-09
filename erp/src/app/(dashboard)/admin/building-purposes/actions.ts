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

/** 위/아래 이동 — 인접 항목과 sort_order 교환 */
export async function moveBuildingPurposeAction(
  id: string,
  direction: 'up' | 'down'
): Promise<{ error?: string }> {
  await requireAdmin()
  const admin = createAdminClient()

  const { data: listRaw } = await admin
    .from('building_purposes')
    .select('id, sort_order')
    .order('sort_order')
    .order('name')
  const list = (listRaw ?? []) as Array<{ id: string; sort_order: number }>

  const idx = list.findIndex(p => p.id === id)
  if (idx < 0) return { error: '항목을 찾을 수 없습니다.' }
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= list.length) return {} // 끝이면 무시

  const a = list[idx], b = list[swapIdx]
  // 정렬값이 같은 경우(이름순 동률) 교환이 무의미하므로 간격 보정
  const aOrder = a.sort_order === b.sort_order ? b.sort_order + (direction === 'up' ? -1 : 1) : b.sort_order
  await admin.from('building_purposes').update({ sort_order: aOrder } as Record<string, unknown>).eq('id', a.id)
  await admin.from('building_purposes').update({ sort_order: a.sort_order } as Record<string, unknown>).eq('id', b.id)

  revalidatePath('/admin/building-purposes')
  return {}
}
