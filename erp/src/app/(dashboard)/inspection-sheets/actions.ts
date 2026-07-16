'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import type { InspectionType } from '@/types'

export type SheetItemInput = {
  item_code: string
  item_name: string
  facility_type?: string
  inspection_method?: string
  judgment_criteria?: string
  order_num: number
}

export type CreateSheetInput = {
  sheet_code: string
  sheet_name: string
  version: string
  inspection_type?: InspectionType
  description?: string
  items: SheetItemInput[]
}

export async function createSheetAction(
  input: CreateSheetInput
): Promise<{ error?: string; sheetId?: string }> {
  const profile = await requirePermission('inspection_sheet_manage')
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('inspection_sheets')
    .select('id')
    .eq('sheet_code', input.sheet_code)
    .eq('version', input.version)
    .single()
  if (existing) return { error: `코드 "${input.sheet_code}" v${input.version} 은 이미 존재합니다.` }

  const { data, error } = await admin
    .from('inspection_sheets')
    .insert({
      sheet_code: input.sheet_code,
      sheet_name: input.sheet_name,
      version: input.version,
      inspection_type: input.inspection_type || null,
      description: input.description || null,
      created_by: profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  const sheetId = (data as { id: string }).id

  if (input.items.length > 0) {
    const { error: itemErr } = await admin
      .from('inspection_sheet_items')
      .insert(
        input.items.map(item => ({
          sheet_id: sheetId,
          item_code: item.item_code,
          item_name: item.item_name,
          facility_type: item.facility_type || null,
          inspection_method: item.inspection_method || null,
          judgment_criteria: item.judgment_criteria || null,
          order_num: item.order_num,
        })) as Record<string, unknown>[]
      )
    if (itemErr) return { error: itemErr.message }
  }

  revalidatePath('/inspection-sheets')
  return { sheetId }
}

/** 접두어 기반으로 다음 점검표 코드를 생성합니다. 예: prefix='CHK' → 'CHK-001' */
export async function generateSheetCodeAction(prefix: string = 'CHK'): Promise<{ code?: string; error?: string }> {
  await requirePermission('inspection_sheet_manage')
  const admin = createAdminClient()

  const cleanPrefix = prefix.trim().toUpperCase()
  if (!cleanPrefix) return { error: '접두어를 입력해주세요.' }

  const { data, error } = await admin
    .from('inspection_sheets')
    .select('sheet_code')
    .ilike('sheet_code', `${cleanPrefix}%`)
    .limit(200)

  if (error) return { error: '코드 조회에 실패했습니다.' }

  const escapedPrefix = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${escapedPrefix}[-_]?(\\d+)$`, 'i')
  let maxNum = 0
  for (const row of (data ?? []) as { sheet_code: string }[]) {
    const match = row.sheet_code.match(pattern)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > maxNum) maxNum = num
    }
  }

  const nextNum = maxNum + 1
  const code = `${cleanPrefix}-${String(nextNum).padStart(3, '0')}`
  return { code }
}

/** 점검표 삭제 — 점검 응답이 이 점검표의 항목코드를 참조 중이면 차단(비활성화 안내). 항목은 FK CASCADE로 함께 삭제. */
export async function deleteSheetAction(id: string): Promise<{ error?: string }> {
  await requirePermission('inspection_sheet_manage')
  const admin = createAdminClient()

  const { data: items, error: itemErr } = await admin
    .from('inspection_sheet_items')
    .select('item_code')
    .eq('sheet_id', id)
  if (itemErr) return { error: itemErr.message }

  const codes = (items ?? []).map(i => (i as { item_code: string }).item_code)
  if (codes.length > 0) {
    const { count, error: respErr } = await admin
      .from('inspection_sheet_responses')
      .select('id', { count: 'exact', head: true })
      .in('item_code', codes)
    if (respErr) return { error: respErr.message }
    if ((count ?? 0) > 0) {
      return { error: `점검 응답 ${count}건이 이 점검표 항목을 참조하고 있어 삭제할 수 없습니다. 대신 비활성화하세요.` }
    }
  }

  const { error } = await admin.from('inspection_sheets').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/inspection-sheets')
  return {}
}

export async function updateSheetAction(input: {
  id: string
  sheet_name: string
  description?: string
  is_active: boolean
}): Promise<{ error?: string }> {
  const { getSessionUser } = await import('@/lib/auth')
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  const { error } = await admin
    .from('inspection_sheets')
    .update({
      sheet_name: input.sheet_name,
      description: input.description || null,
      is_active: input.is_active,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', input.id)

  if (error) return { error: error.message }
  revalidatePath('/inspection-sheets')
  revalidatePath(`/inspection-sheets/${input.id}`)
  return {}
}
