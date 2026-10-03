'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { COMPANY_PROFILE_ORDER } from '@/lib/company-profile'
import { SEAL_BUCKET } from '@/lib/company-seal'
import { normalizeSeal } from '@/lib/company-seal-normalize'
import { checkImageUpload } from '@/lib/upload-guard'

/** 회사 직인 업로드·교체·삭제 (통합 실행계획 C5 마무리, 2026-10-03 · 마이그 174)
 *
 *  비공개 버킷 `company-assets`(정책 0 — service role만)에 **정규화한 투명 PNG**로 둔다. 파일명에 시각을 넣어
 *  교체 때 옛 파일과 겹치지 않게 하고, 새 경로를 저장한 **뒤에** 옛 파일을 지운다(중간 실패 시 문서는 옛 직인).
 *  권한은 회사정보 저장과 같은 company_manage. */

async function companyRow() {
  const admin = createAdminClient()
  // 정렬 고정 — getCompanyProfile·upsertCompanyAction과 같은 행을 본다(2행 사고, company/actions.ts)
  const { data, error } = await admin.from('company_profile')
    .select('id, seal_path').order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle()
  return { admin, row: data as { id: string; seal_path: string | null } | null, error }
}

export async function uploadCompanySealAction(formData: FormData): Promise<{ error?: string }> {
  await requirePermission('company_manage')
  const file = formData.get('file') as File | null
  if (!file) return { error: '파일을 선택해주세요.' }
  const checked = await checkImageUpload(file, 'document')
  if (!checked.ok) return { error: checked.error }

  let png: Uint8Array
  try {
    png = (await normalizeSeal(new Uint8Array(checked.buffer))).png
  } catch (e) {
    return { error: `직인 이미지를 처리하지 못했습니다: ${(e as Error).message}` }
  }

  const { admin, row, error } = await companyRow()
  if (error) return { error: `회사정보 조회 실패: ${error.message}` }
  if (!row) return { error: '회사정보를 먼저 저장해주세요.' }

  const path = `seal/seal_${Date.now()}.png`
  const { error: upErr } = await admin.storage.from(SEAL_BUCKET).upload(path, png, { contentType: 'image/png' })
  if (upErr) return { error: `업로드 실패: ${upErr.message}` }
  const { error: dbErr } = await admin.from('company_profile').update({ seal_path: path }).eq('id', row.id)
  if (dbErr) {
    await admin.storage.from(SEAL_BUCKET).remove([path])
    return { error: `저장 실패: ${dbErr.message}` }
  }
  if (row.seal_path && row.seal_path !== path) await admin.storage.from(SEAL_BUCKET).remove([row.seal_path])
  revalidatePath('/company')
  return {}
}

export async function removeCompanySealAction(): Promise<{ error?: string }> {
  await requirePermission('company_manage')
  const { admin, row, error } = await companyRow()
  if (error) return { error: `회사정보 조회 실패: ${error.message}` }
  if (!row?.seal_path) return {}
  const { error: dbErr } = await admin.from('company_profile').update({ seal_path: null }).eq('id', row.id)
  if (dbErr) return { error: `삭제 실패: ${dbErr.message}` }
  await admin.storage.from(SEAL_BUCKET).remove([row.seal_path])
  revalidatePath('/company')
  return {}
}
