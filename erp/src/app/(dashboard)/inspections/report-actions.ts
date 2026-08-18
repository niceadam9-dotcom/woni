'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole, getSessionUser } from '@/lib/auth'
export type { StepReportType, LegacyReportType, ReportType } from './report-constants'
import type { ReportType } from './report-constants'

const BUCKET = 'inspection-reports'

export async function uploadReportAction(
  inspectionId: string,
  reportType: ReportType,
  formData: FormData
): Promise<{ error?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  // 배정된 직원 또는 manager/admin만 허용
  const [profileRes, inspRes2] = await Promise.all([
    admin.from('profiles').select('id, role').eq('id', user.id).single(),
    admin.from('inspections').select('customer_id, assigned_employee_id').eq('id', inspectionId).single(),
  ])
  const role = (profileRes.data as { role: string } | null)?.role
  const isManagerOrAdmin = role === 'manager' || role === 'admin'
  const isAssigned = (inspRes2.data as { assigned_employee_id: string } | null)?.assigned_employee_id === user.id
  if (!isManagerOrAdmin && !isAssigned) return { error: '접근 권한이 없습니다.' }

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { error: '파일을 선택해주세요.' }
  if (file.size > 20 * 1024 * 1024) return { error: '파일 크기는 20MB 이하여야 합니다.' }

  // 고객 스냅샷 정보 (inspRes2에서 customer_id 사용)
  const { data: insp } = inspRes2
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const inspData = insp as { customer_id: string; assigned_employee_id: string }

  // submitted_by에 현재 사용자 ID 사용
  const profileId = user.id

  const { data: cust } = await admin
    .from('customers')
    .select('customer_code, customer_name')
    .eq('id', inspData.customer_id)
    .single()

  // 기존 동일 타입 보고서의 스토리지 파일 삭제
  const { data: existing } = await admin
    .from('inspection_reports')
    .select('id, file_path')
    .eq('inspection_id', inspectionId)
    .eq('report_type', reportType)
    .single()

  if (existing?.file_path) {
    await admin.storage.from(BUCKET).remove([(existing as { file_path: string }).file_path])
    await admin.from('inspection_reports').delete().eq('id', (existing as { id: string }).id)
  }

  // 스토리지 업로드
  const ext = file.name.split('.').pop() ?? 'bin'
  const filePath = `${inspectionId}/${reportType}/${Date.now()}.${ext}`

  const arrayBuf = await file.arrayBuffer()
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(filePath, Buffer.from(arrayBuf), {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadErr) return { error: `업로드 실패: ${uploadErr.message}` }

  // DB 저장
  const custData = cust as { customer_code: string; customer_name: string } | null
  await admin.from('inspection_reports').insert({
    inspection_id: inspectionId,
    report_type:   reportType,
    customer_code: custData?.customer_code ?? '',
    customer_name: custData?.customer_name ?? '',
    file_name:     file.name,
    file_path:     filePath,
    file_size:     file.size,
    mime_type:     file.type || null,
    submitted_at:  new Date().toISOString(),
    submitted_by:  profileId,
  } as Record<string, unknown>)

  await admin.from('activity_logs').insert({
    actor_id:    profileId,
    action:      'upload_report',
    entity_type: 'inspection_report',
    entity_id:   inspectionId,
    metadata:    { report_type: reportType, file_name: file.name },
  } as Record<string, unknown>)

  // 종전에는 여기서 inspection_status_log에 단계 날짜를 자동 반영했다(쓰기 3곳 중 하나).
  // 그 테이블은 inspection_steps와 1:1 중복인 두 번째 축이었고, 읽는 곳은 모니터링 화면 하나뿐이라
  // 세 곳이 쓰고 한 곳만 읽는데 그 값을 나머지 시스템은 믿지 않는 구조였다(소방계획서_24 P-14·P-15).
  // Q-8로 모니터링을 폐지하며 이 쓰기도 걷어냈다 — 단계 완료 판정의 단일 원천은 inspection_steps다.

  revalidatePath(`/inspections/${inspectionId}`)
  return {}
}

export async function deleteReportAction(
  reportId: string,
  inspectionId: string
): Promise<{ error?: string }> {
  const profile = await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  const { data: report } = await admin
    .from('inspection_reports')
    .select('file_path')
    .eq('id', reportId)
    .single()

  if (report?.file_path) {
    await admin.storage.from(BUCKET).remove([(report as { file_path: string }).file_path])
  }

  await admin.from('inspection_reports').delete().eq('id', reportId)

  await admin.from('activity_logs').insert({
    actor_id:    profile.id,
    action:      'delete_report',
    entity_type: 'inspection_report',
    entity_id:   inspectionId,
    metadata:    { report_id: reportId },
  } as Record<string, unknown>)

  revalidatePath(`/inspections/${inspectionId}`)
  return {}
}

export async function getReportDownloadUrl(
  reportId: string
): Promise<{ error?: string; url?: string; fileName?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const admin = createAdminClient()

  const { data: report } = await admin
    .from('inspection_reports')
    .select('file_path, file_name')
    .eq('id', reportId)
    .single()

  if (!report) return { error: '파일을 찾을 수 없습니다.' }

  const r = report as { file_path: string; file_name: string }

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(r.file_path, 300) // 5분 유효

  if (error || !data?.signedUrl) return { error: '다운로드 URL 생성에 실패했습니다.' }

  return { url: data.signedUrl, fileName: r.file_name }
}
