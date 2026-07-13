'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'

const BUCKET = 'fire-plans'
const MAX_SIZE = 30 * 1024 * 1024 // 30MB

/** 소방계획서 업로드 — 인쇄용 PDF(표준양식) 필수 + 한글 원본(HWP) 선택 (doc02 §8) */
export async function uploadFirePlanAction(
  customerId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const year = parseInt(String(formData.get('year') ?? ''), 10)
  if (isNaN(year) || year < 2000 || year > 2100) return { error: '연도를 확인해주세요.' }

  const pdf = formData.get('pdf') as File | null
  if (!pdf || pdf.size === 0) return { error: '인쇄용 PDF 파일을 선택해주세요. (소방계획서 표준양식)' }
  if (!pdf.name.toLowerCase().endsWith('.pdf')) return { error: '인쇄용 파일은 PDF 형식이어야 합니다.' }
  if (pdf.size > MAX_SIZE) return { error: 'PDF 파일은 30MB 이하여야 합니다.' }

  const hwp = formData.get('hwp') as File | null
  const hasHwp = !!hwp && hwp.size > 0
  if (hasHwp) {
    const lower = hwp.name.toLowerCase()
    if (!lower.endsWith('.hwp') && !lower.endsWith('.hwpx')) return { error: '원본 파일은 HWP/HWPX 형식이어야 합니다.' }
    if (hwp.size > MAX_SIZE) return { error: 'HWP 파일은 30MB 이하여야 합니다.' }
  }

  const { data: cust } = await admin
    .from('customers').select('customer_name').eq('id', customerId).single()
  if (!cust) return { error: '고객을 찾을 수 없습니다.' }

  const stamp = Date.now()
  const pdfPath = `${customerId}/${year}/${stamp}.pdf`
  const { error: pdfErr } = await admin.storage.from(BUCKET)
    .upload(pdfPath, Buffer.from(await pdf.arrayBuffer()), { contentType: 'application/pdf', upsert: false })
  if (pdfErr) return { error: `PDF 업로드 실패: ${pdfErr.message}` }

  let hwpPath: string | null = null
  if (hasHwp) {
    hwpPath = `${customerId}/${year}/${stamp}.${hwp.name.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp'}`
    const { error: hwpErr } = await admin.storage.from(BUCKET)
      .upload(hwpPath, Buffer.from(await hwp.arrayBuffer()), { contentType: 'application/octet-stream', upsert: false })
    if (hwpErr) {
      await admin.storage.from(BUCKET).remove([pdfPath]) // PDF만 남는 반쪽 업로드 방지
      return { error: `HWP 업로드 실패: ${hwpErr.message}` }
    }
  }

  const title = String(formData.get('title') ?? '').trim() || `${year}년 소방계획서`
  const note = String(formData.get('note') ?? '').trim() || null

  const { error: insErr } = await admin.from('fire_plans').insert({
    customer_id: customerId,
    year,
    title,
    pdf_name: pdf.name,
    pdf_path: pdfPath,
    hwp_name: hasHwp ? hwp.name : null,
    hwp_path: hwpPath,
    note,
    uploaded_by: profile.id,
  } as Record<string, unknown>)
  if (insErr) {
    await admin.storage.from(BUCKET).remove([pdfPath, ...(hwpPath ? [hwpPath] : [])])
    return { error: `저장 실패: ${insErr.message}` }
  }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'fire_plan_uploaded',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: { year, title, pdf_name: pdf.name, hwp_name: hasHwp ? hwp.name : null },
  } as Record<string, unknown>)

  revalidatePath(`/customers/${customerId}`)
  return {}
}

export async function deleteFirePlanAction(planId: string): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { data: plan } = await admin
    .from('fire_plans')
    .select('customer_id, year, title, pdf_path, hwp_path')
    .eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }
  const p = plan as { customer_id: string; year: number; title: string | null; pdf_path: string; hwp_path: string | null }

  await admin.storage.from(BUCKET).remove([p.pdf_path, ...(p.hwp_path ? [p.hwp_path] : [])])
  const { error } = await admin.from('fire_plans').delete().eq('id', planId)
  if (error) return { error: '삭제에 실패했습니다.' }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'fire_plan_deleted',
    entity_type: 'customer',
    entity_id: p.customer_id,
    metadata: { year: p.year, title: p.title },
  } as Record<string, unknown>)

  revalidatePath(`/customers/${p.customer_id}`)
  return {}
}

/** 다운로드/인쇄용 서명 URL (5분 유효) */
export async function getFirePlanFileUrlAction(
  planId: string,
  kind: 'pdf' | 'hwp'
): Promise<{ error?: string; url?: string; fileName?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  const { data: plan } = await admin
    .from('fire_plans')
    .select('pdf_path, pdf_name, hwp_path, hwp_name')
    .eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }
  const p = plan as { pdf_path: string; pdf_name: string; hwp_path: string | null; hwp_name: string | null }

  const path = kind === 'pdf' ? p.pdf_path : p.hwp_path
  const name = kind === 'pdf' ? p.pdf_name : p.hwp_name
  if (!path) return { error: 'HWP 원본이 등록되지 않았습니다.' }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error || !data?.signedUrl) return { error: 'URL 생성에 실패했습니다.' }
  return { url: data.signedUrl, fileName: name ?? undefined }
}
