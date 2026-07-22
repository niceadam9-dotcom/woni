'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

/** 별지 9호(자체점검 실시결과 보고서) 생성 — P3 MVP (소방계획서_4.md §9-3·§9-6⑦)
 *  입력은 소유하지 않는 준비 화면 원칙: 공통값=고객 탭, 점검값=점검 상세, 여기는 생성·조회만. */

const BUCKET = 'fire-plans'

export type Report9Job = {
  id: string; status: string; missing: string[] | null; error: string | null; created_at: string
}
export type Report9File = { name: string; path: string; createdAt: string | null }

/** 생성 요청 — fire_plan_gen_jobs 큐 등록 (워커가 처리, report_type='report9') */
export async function requestReport9Action(inspectionId: string): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const { data: insp } = await admin.from('inspections')
    .select('id, customer_id, year, customer:customers(customer_name)')
    .eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const i = insp as unknown as { id: string; customer_id: string; year: number; customer: { customer_name: string } | null }

  const { data: waiting } = await admin.from('fire_plan_gen_jobs')
    .select('id').eq('inspection_id', inspectionId).in('status', ['pending', 'processing']).limit(1)
  if (waiting && waiting.length > 0) return { error: '이미 생성 대기·진행 중입니다 — 잠시 후 새로고침해주세요.' }

  const { error } = await admin.from('fire_plan_gen_jobs').insert({
    report_type: 'report9',
    inspection_id: inspectionId,
    customer_id: i.customer_id,
    customer_name: i.customer?.customer_name ?? '—',
    year: i.year,
    requested_by: profile.id,
    requested_by_name: profile.name,
  } as Record<string, unknown>)
  if (error) return { error: `요청 실패: ${error.message}` }
  revalidatePath(`/inspections/${inspectionId}`)
  return {}
}

/** 최신 작업 상태 + 생성물 목록 (클라이언트 폴링용) */
export async function getReport9StatusAction(inspectionId: string): Promise<{
  job: Report9Job | null; files: Report9File[]; error?: string
}> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()

  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', inspectionId).single()
  if (!insp) return { job: null, files: [], error: '점검을 찾을 수 없습니다.' }
  const customerId = (insp as { customer_id: string }).customer_id

  const { data: jobs } = await admin.from('fire_plan_gen_jobs')
    .select('id, status, missing, error, created_at')
    .eq('inspection_id', inspectionId).eq('report_type', 'report9')
    .order('created_at', { ascending: false }).limit(1)

  const prefix = `${customerId}/inspections/${inspectionId}`
  const { data: objects } = await admin.storage.from(BUCKET).list(prefix, { limit: 50, sortBy: { column: 'name', order: 'desc' } })
  const files: Report9File[] = (objects ?? [])
    .filter(o => o.name.startsWith('report9_'))
    .map(o => ({ name: o.name, path: `${prefix}/${o.name}`, createdAt: o.created_at ?? null }))

  return { job: (jobs?.[0] as Report9Job | undefined) ?? null, files }
}

/** 생성물 다운로드 — 5분 서명 URL (경로는 해당 점검 폴더로 한정) */
export async function downloadReport9Action(inspectionId: string, path: string): Promise<{ url?: string; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const prefix = `${(insp as { customer_id: string }).customer_id}/inspections/${inspectionId}/`
  if (!path.startsWith(prefix)) return { error: '잘못된 경로입니다.' }
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error || !data) return { error: '다운로드 URL 생성 실패' }
  return { url: data.signedUrl }
}
