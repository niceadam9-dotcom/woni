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

// 불량사진 업로드 (FormData 방식)
export async function uploadDefectPhotoAction(formData: FormData): Promise<{ error?: string; url?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  const defectId     = formData.get('defectId')     as string | null
  const inspectionId = formData.get('inspectionId') as string | null
  const file         = formData.get('file')         as File | null

  if (!defectId || !inspectionId || !file) return { error: '파일 정보가 없습니다.' }

  const ext  = file.name.split('.').pop() ?? 'jpg'
  const path = `${inspectionId}/${defectId}/${Date.now()}.${ext}`

  const buffer = await file.arrayBuffer()
  const { error: uploadErr } = await admin.storage
    .from('inspection-defects')
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (uploadErr) return { error: '사진 업로드에 실패했습니다.' }

  // photo_url 업데이트
  const { data: urlData } = admin.storage
    .from('inspection-defects')
    .getPublicUrl(path)

  const photoUrl = urlData.publicUrl

  await admin
    .from('inspection_defects')
    .update({ photo_url: photoUrl })
    .eq('id', defectId)

  revalidatePath(`/inspections/${inspectionId}`)
  return { url: photoUrl }
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
