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
    .select('customer_id, year, title, pdf_path, hwp_path, html_path, odt_path')
    .eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }
  const p = plan as { customer_id: string; year: number; title: string | null; pdf_path: string | null; hwp_path: string | null; html_path: string | null; odt_path: string | null }

  // 부속자료(지도·사진)는 행이 FK CASCADE(086)로 함께 사라진다 — 파일을 먼저 지우지 않으면
  // 아무도 접근할 수 없는 고아 파일만 스토리지에 남는다.
  const { data: atts, error: attErr } = await admin.from('fire_plan_attachments')
    .select('file_path').eq('fire_plan_id', planId)
  // 조회 실패를 빈 목록으로 오인하면 부속자료 파일을 남긴 채 행만 지워 고아가 된다
  if (attErr) return { error: `부속자료 목록 조회에 실패해 중단했습니다: ${attErr.message}` }

  // 파일 삭제가 실패하면 행을 지우지 않는다 — 지우면 CASCADE로 참조가 사라져 되찾을 수 없다
  const { error: rmErr } = await admin.storage.from(BUCKET).remove([
    ...(p.pdf_path ? [p.pdf_path] : []),
    ...(p.hwp_path ? [p.hwp_path] : []),
    ...(p.html_path ? [p.html_path] : []),
    ...(p.odt_path ? [p.odt_path] : []),
    // 표준양식 생성분의 폼 데이터(.form.json)도 함께 정리 — 없으면 무시됨
    ...(p.pdf_path?.includes('generated_') ? [p.pdf_path.replace(/\.pdf$/, '.form.json')] : []),
    ...((atts ?? []) as Array<{ file_path: string }>).map(a => a.file_path),
  ])
  if (rmErr) return { error: `첨부 파일 삭제에 실패해 중단했습니다 — 다시 시도해주세요. (${rmErr.message})` }

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

/** 제출추적 저장 (FP-2) — 관할 소방서 제출일·관할서 */
export async function updateFirePlanSubmissionAction(
  planId: string, input: { submittedAt: string | null; fireStation: string }
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: plan } = await admin.from('fire_plans').select('customer_id').eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }
  const { error } = await admin.from('fire_plans')
    .update({ submitted_at: input.submittedAt || null, fire_station: input.fireStation.trim() || null } as Record<string, unknown>)
    .eq('id', planId)
  if (error) return { error: `제출정보 저장 실패: ${error.message}` }
  revalidatePath(`/customers/${(plan as { customer_id: string }).customer_id}`)
  return {}
}

/** 부속자료(지도·사진) 업로드 (FP-2) */
export async function uploadFirePlanAttachmentAction(formData: FormData): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const planId = String(formData.get('planId') ?? '')
  const kind = String(formData.get('kind') ?? '기타')
  const file = formData.get('file') as File | null
  if (!planId || !file || file.size === 0) return { error: '파일을 선택해주세요.' }
  if (file.size > MAX_SIZE) return { error: '파일은 30MB 이하여야 합니다.' }

  const { data: plan } = await admin.from('fire_plans').select('customer_id').eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }

  const ext = file.name.split('.').pop() ?? 'bin'
  const path = `att/${planId}/${Date.now()}.${ext}`
  const { error: upErr } = await admin.storage.from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return { error: `업로드 실패: ${upErr.message}` }

  const { error: insErr } = await admin.from('fire_plan_attachments').insert({
    fire_plan_id: planId, kind: ['지도', '사진', '기타'].includes(kind) ? kind : '기타',
    file_name: file.name, file_path: path, uploaded_by: profile.id,
  } as Record<string, unknown>)
  if (insErr) { await admin.storage.from(BUCKET).remove([path]); return { error: `저장 실패: ${insErr.message}` } }
  revalidatePath(`/customers/${(plan as { customer_id: string }).customer_id}`)
  return {}
}

export async function deleteFirePlanAttachmentAction(attId: string): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: att } = await admin.from('fire_plan_attachments')
    .select('file_path, fire_plan_id, fire_plans(customer_id)').eq('id', attId).single()
  if (!att) return { error: '부속자료를 찾을 수 없습니다.' }
  const a = att as { file_path: string; fire_plans: { customer_id: string } | { customer_id: string }[] | null }
  await admin.storage.from(BUCKET).remove([a.file_path])
  const { error } = await admin.from('fire_plan_attachments').delete().eq('id', attId)
  if (error) return { error: '삭제에 실패했습니다.' }
  const cust = Array.isArray(a.fire_plans) ? a.fire_plans[0] : a.fire_plans
  if (cust) revalidatePath(`/customers/${cust.customer_id}`)
  return {}
}

/** 연차발행 (FP-2) — 현재 계획서를 다음 연도로 복제(파일 복사, 개정차수 1로 리셋) */
export async function issueNextYearPlanAction(planId: string): Promise<{ error?: string; year?: number }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: plan } = await admin.from('fire_plans')
    .select('customer_id, year, title, pdf_name, pdf_path, hwp_name, hwp_path, pdf_status').eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }
  const p = plan as { customer_id: string; year: number; title: string | null; pdf_name: string | null; pdf_path: string | null; hwp_name: string | null; hwp_path: string | null; pdf_status: string }
  if (!p.pdf_path || p.pdf_status !== 'ready') return { error: 'PDF 변환이 완료된 뒤 연차발행할 수 있습니다.' }
  const newYear = p.year + 1

  const stamp = Date.now()
  const newPdfPath = `${p.customer_id}/${newYear}/${stamp}.pdf`
  const { error: cpErr } = await admin.storage.from(BUCKET).copy(p.pdf_path, newPdfPath)
  if (cpErr) return { error: `파일 복사 실패: ${cpErr.message}` }
  let newHwpPath: string | null = null
  if (p.hwp_path) {
    newHwpPath = `${p.customer_id}/${newYear}/${stamp}.${p.hwp_path.endsWith('hwpx') ? 'hwpx' : 'hwp'}`
    await admin.storage.from(BUCKET).copy(p.hwp_path, newHwpPath).catch(() => { newHwpPath = null })
  }

  const { error: insErr } = await admin.from('fire_plans').insert({
    customer_id: p.customer_id, year: newYear, title: `${newYear}년 소방계획서`,
    pdf_name: p.pdf_name, pdf_path: newPdfPath, hwp_name: p.hwp_name, hwp_path: newHwpPath,
    revision: 1, note: `${p.year}년 계획서에서 연차발행`, uploaded_by: profile.id,
  } as Record<string, unknown>)
  if (insErr) { await admin.storage.from(BUCKET).remove([newPdfPath, ...(newHwpPath ? [newHwpPath] : [])]); return { error: `발행 실패: ${insErr.message}` } }

  // 11-2 전년도 이어받기: 서식 입력(fire_plan_forms)은 고객당 1행이라 자동 승계 —
  // 개정이력 입력(sections.revision)만 '연차 갱신'으로 갱신해 전년도 개정 문구가 새해에 딸려가지 않게 한다.
  const { data: formRow } = await admin.from('fire_plan_forms')
    .select('sections').eq('customer_id', p.customer_id).maybeSingle()
  const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
  const sections = {
    ...((formRow as { sections?: Record<string, unknown> } | null)?.sections ?? {}),
    revision: { revisionDate: kstToday, revisionNote: `${newYear}년 연차 갱신 (전년도 이어받기)` },
  }
  await admin.from('fire_plan_forms').upsert({
    customer_id: p.customer_id, sections,
    updated_at: new Date().toISOString(), updated_by: profile.id,
  } as Record<string, unknown>)

  revalidatePath(`/customers/${p.customer_id}`)
  return { year: newYear }
}

const IMAGE_EXTS: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/** 표준양식 삽입용 사진 업로드 — fire-plans 버킷 gen-assets 경로 (마이그레이션 없음) */
export async function uploadFirePlanGenImageAction(
  customerId: string,
  formData: FormData,
): Promise<{ error?: string; path?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { error: '이미지 파일을 선택해주세요.' }
  if (file.size > 10 * 1024 * 1024) return { error: '이미지는 10MB 이하여야 합니다.' }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  const mime = IMAGE_EXTS[ext]
  if (!mime) return { error: 'JPG/PNG/WEBP 이미지만 업로드할 수 있습니다.' }

  const path = `${customerId}/gen-assets/${Date.now()}.${ext}`
  const { error } = await admin.storage.from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: mime, upsert: false })
  if (error) return { error: `업로드 실패: ${error.message}` }
  return { path }
}

/** 표준양식 삽입용 사진 삭제 (폼에서 제거 시) — gen-assets 경로만 허용 */
export async function deleteFirePlanGenImageAction(
  customerId: string,
  path: string,
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  if (!path.startsWith(`${customerId}/gen-assets/`)) return { error: '잘못된 경로입니다.' }
  const admin = createAdminClient()
  await admin.storage.from(BUCKET).remove([path])
  return {}
}

// §7-5 출력 엔진 단일화(2026-07-23): 웹 계획서 템플릿 폐기 — generateFirePlanAction(HTML→Gotenberg PDF)과
// getFirePlanFormAction(.form.json 재편집)을 제거. 과거 .form.json은 임포트(7-3b)에서 읽기 전용으로만 사용.
// 데이터 시트(한컴독스 수동 편집 참조용 1장 요약)와 그 전용 조립 getFirePlanGenDefaultsAction도 제거 —
// SDK 제거·전 문서 서버 PDF 전환(소방계획서_7)으로 수동 편집 워크플로가 소멸 (소방계획서_14 #8, 2026-08-10).

/** 다운로드/인쇄/미리보기용 서명 URL (5분 유효) — html = HWP 생성분 웹 미리보기(레이아웃 참고) */
export async function getFirePlanFileUrlAction(
  planId: string,
  kind: 'pdf' | 'hwp' | 'html'
): Promise<{ error?: string; url?: string; fileName?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  const { data: plan } = await admin
    .from('fire_plans')
    .select('pdf_path, pdf_name, hwp_path, hwp_name, html_path')
    .eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }
  const p = plan as { pdf_path: string | null; pdf_name: string | null; hwp_path: string | null; hwp_name: string | null; html_path: string | null }

  const path = kind === 'pdf' ? p.pdf_path : kind === 'hwp' ? p.hwp_path : p.html_path
  const name = kind === 'pdf' ? p.pdf_name : kind === 'hwp' ? p.hwp_name : '미리보기.html'
  if (!path) {
    return {
      error: kind === 'pdf' ? 'PDF가 아직 준비되지 않았습니다. (변환 중)'
        : kind === 'hwp' ? 'HWP 원본이 등록되지 않았습니다.'
        : '웹 미리보기가 없는 계획서입니다. (HWP 자동 생성분만 제공)',
    }
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error || !data?.signedUrl) return { error: 'URL 생성에 실패했습니다.' }
  return { url: data.signedUrl, fileName: name ?? undefined }
}
