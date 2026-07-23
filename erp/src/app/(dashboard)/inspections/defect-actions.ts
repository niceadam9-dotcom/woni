'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole, getSessionUser } from '@/lib/auth'

export type DefectSeverity = '경미' | '보통' | '중대'

// 불량내역 추가
export async function addDefectAction(input: {
  inspectionId: string
  defectCode?: string | null
  defectName: string
  defectDetail?: string | null
  severity: DefectSeverity
}): Promise<{ error?: string; id?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('inspection_defects')
    .insert({
      inspection_id: input.inspectionId,
      defect_code:   input.defectCode   ?? null,
      defect_name:   input.defectName,
      defect_detail: input.defectDetail ?? null,
      severity:      input.severity,
    })
    .select('id')
    .single()

  if (error) return { error: '불량내역 저장에 실패했습니다.' }
  revalidatePath(`/inspections/${input.inspectionId}`)
  return { id: (data as { id: string }).id }
}

// 단골 불량 원터치 칩 TOP 8 + 표준 문구 (소방계획서_5 R13-a·R13-e) —
// 전사 inspection_defects 등록 빈도 상위, 부족분은 defect_catalog 프리셋 백필. 메모 표준 문구도 함께.
export async function getDefectSuggestionsAction(): Promise<{ chips: string[]; standard: string[] }> {
  const user = await getSessionUser()
  if (!user) return { chips: [], standard: [] }
  const admin = createAdminClient()
  const { data } = await admin
    .from('inspection_defects')
    .select('defect_name')
    .order('created_at', { ascending: false })
    .limit(500)
  const freq = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ defect_name: string | null }>) {
    const n = r.defect_name?.trim()
    if (!n) continue
    freq.set(n, (freq.get(n) ?? 0) + 1)
  }
  const chips = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n)
  // 통계 부족(초기) 시 defect_catalog 프리셋으로 백필
  if (chips.length < 8) {
    const { data: cat } = await admin.from('defect_catalog').select('description').order('sort_order').limit(24)
    for (const c of (cat ?? []) as Array<{ description: string }>) {
      if (chips.length >= 8) break
      if (c.description && !chips.includes(c.description)) chips.push(c.description)
    }
  }
  const { data: std } = await admin.from('defect_catalog').select('description').order('sort_order').limit(8)
  const standard = [...new Set(((std ?? []) as Array<{ description: string }>).map(s => s.description).filter(Boolean))]
  return { chips, standard }
}

// 불량사진 업로드 (FormData 방식)
export async function uploadDefectPhotoAction(formData: FormData): Promise<{ error?: string; url?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  const defectId     = formData.get('defectId')     as string | null
  const inspectionId = formData.get('inspectionId') as string | null
  const file         = formData.get('file')         as File | null
  const field        = (formData.get('field') as string | null) === 'after' ? 'after_photo_url' : 'photo_url'

  if (!defectId || !inspectionId || !file) return { error: '파일 정보가 없습니다.' }

  const ext  = file.name.split('.').pop() ?? 'jpg'
  const path = `${inspectionId}/${defectId}/${field === 'after_photo_url' ? 'after_' : ''}${Date.now()}.${ext}`

  const buffer = await file.arrayBuffer()
  const { error: uploadErr } = await admin.storage
    .from('inspection-defects')
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (uploadErr) return { error: '사진 업로드에 실패했습니다.' }

  const { data: urlData } = admin.storage
    .from('inspection-defects')
    .getPublicUrl(path)

  const photoUrl = urlData.publicUrl

  await admin
    .from('inspection_defects')
    .update({ [field]: photoUrl } as Record<string, unknown>)
    .eq('id', defectId)

  revalidatePath(`/inspections/${inspectionId}`)
  return { url: photoUrl }
}

// 불량 조치 저장 (P34-4 + R-3 §9-7) — 이행계획(별지 10호: 계획·기간) + 조치완료(별지 11호: 내용·완료일)
export async function updateDefectActionAction(input: {
  defectId: string
  inspectionId: string
  actionTaken?: string | null
  actionCompletedAt?: string | null
  actionPlan?: string | null
  actionStart?: string | null
  actionEnd?: string | null
}): Promise<{ error?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()
  const patch: Record<string, unknown> = {
    action_taken: input.actionTaken?.trim() || null,
    action_completed_at: input.actionCompletedAt || null,
  }
  if (input.actionPlan !== undefined) patch.action_plan = input.actionPlan?.trim() || null
  if (input.actionStart !== undefined) patch.action_start = input.actionStart || null
  if (input.actionEnd !== undefined) patch.action_end = input.actionEnd || null
  const { error } = await admin
    .from('inspection_defects')
    .update(patch)
    .eq('id', input.defectId)
  if (error) return { error: '조치 내용 저장에 실패했습니다.' }
  revalidatePath(`/inspections/${input.inspectionId}`)
  return {}
}

// 불량내역 삭제
export async function deleteDefectAction(defectId: string, inspectionId: string): Promise<{ error?: string }> {
  await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  // Storage 사진 삭제 (있으면)
  const { data: defect } = await admin
    .from('inspection_defects')
    .select('photo_url')
    .eq('id', defectId)
    .single()

  if ((defect as { photo_url?: string | null } | null)?.photo_url) {
    // Extract path from URL
    const url = (defect as { photo_url: string }).photo_url
    const pathMatch = url.match(/inspection-defects\/(.+)$/)
    if (pathMatch) {
      await admin.storage.from('inspection-defects').remove([pathMatch[1]])
    }
  }

  const { error } = await admin
    .from('inspection_defects')
    .delete()
    .eq('id', defectId)

  if (error) return { error: '삭제에 실패했습니다.' }
  revalidatePath(`/inspections/${inspectionId}`)
  return {}
}
