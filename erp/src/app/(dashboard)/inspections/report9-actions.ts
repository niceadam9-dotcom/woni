'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { convertHtmlToPdf } from '@/lib/pdf'
import { renderReport10, renderReport11, type Annex1011Data } from '@/lib/doc-templates/report1011'

/** 별지 9호(자체점검 실시결과 보고서) 생성 — P3 MVP (소방계획서_4.md §9-3·§9-6⑦)
 *  입력은 소유하지 않는 준비 화면 원칙: 공통값=고객 탭, 점검값=점검 상세, 여기는 생성·조회만.
 *  별지 10·11호는 서버 동기 생성(HTML→Gotenberg PDF — 소방계획서_7 H-6·H-8, SDK·워커 미경유). */

const BUCKET = 'fire-plans'

type Admin = ReturnType<typeof createAdminClient>

function kdate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

/** 별지 10·11호 데이터 조립 — 워커 process_report1011과 동일 원본 (fireplan-worker.py 이식).
 *  ③ 서식 고유 값(제출일·업체 수기 등)은 S3A annex_inputs 도입 시 병합 예정 */
async function assembleAnnex1011(
  admin: Admin,
  customerId: string,
  inspectionId: string,
  kind: 'report10' | 'report11',
): Promise<{ data: Annex1011Data; missing: string[] }> {
  const [custRes, bldRes, contactsRes, defectsRes] = await Promise.all([
    admin.from('customers').select('customer_name, address, fire_station').eq('id', customerId).single(),
    admin.from('buildings').select('purpose').eq('customer_id', customerId).eq('is_active', true)
      .order('created_at', { ascending: true }).limit(1),
    admin.from('customer_contacts').select('role, name, phone').eq('customer_id', customerId),
    admin.from('inspection_defects')
      .select('defect_name, action_plan, action_start, action_end, action_taken, action_completed_at')
      .eq('inspection_id', inspectionId).order('created_at'),
  ])
  const cust = custRes.data as { customer_name: string; address: string | null; fire_station: string | null } | null
  if (!cust) throw new Error('고객을 찾을 수 없습니다')
  const purpose = ((bldRes.data?.[0] as { purpose: string | null } | undefined)?.purpose) ?? ''
  const contacts = (contactsRes.data ?? []) as Array<{ role: string; name: string; phone: string | null }>
  const owner = contacts.find(c => c.role === '대표') ?? contacts[0] ?? null
  type DefectRow = {
    defect_name: string | null; action_plan: string | null; action_start: string | null
    action_end: string | null; action_taken: string | null; action_completed_at: string | null
  }
  const defects = (defectsRes.data ?? []) as DefectRow[]

  const missing: string[] = []
  const data: Annex1011Data = {
    customerName: cust.customer_name,
    purpose,
    address: cust.address ?? '',
    ownerName: owner?.name ?? '',
    ownerPhone: owner?.phone ?? '',
    // 소방안전관리자 별도 데이터 미보유 — 관계인 폴백 (워커 동일, 개선은 별지 MD §4)
    mgrName: owner?.name ?? '',
    mgrPhone: owner?.phone ?? '',
    rows: [],
    reportDate: kdate(new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]),
    submitTo: cust.fire_station ? `${cust.fire_station}장` : '관할 소방서장',
  }

  if (kind === 'report10') {
    const planned = defects.filter(d => d.action_plan || d.action_start)
    data.rows = planned.map(d => ({
      content: d.action_plan || d.defect_name || '',
      period: `${d.action_start ?? ''} ~ ${d.action_end ?? ''}`.replace(/^ ~ $/, ''),
    }))
    const starts = planned.map(d => d.action_start).filter(Boolean).sort() as string[]
    const ends = planned.map(d => d.action_end).filter(Boolean).sort() as string[]
    if (starts.length && ends.length) {
      const days = Math.round((new Date(ends[ends.length - 1]).getTime() - new Date(starts[0]).getTime()) / 86400000) + 1
      data.totalPeriod = `${kdate(starts[0])} ~ ${kdate(ends[ends.length - 1])}`
      data.totalDays = String(days)
    }
    if (planned.length === 0) missing.push('이행조치 계획 미입력')
  } else {
    const done = defects.filter(d => d.action_completed_at)
    data.rows = done.map(d => ({
      content: d.action_taken || d.defect_name || '',
      period: d.action_completed_at ?? '',
    }))
    const { data: companyRows } = await admin.from('company_profile')
      .select('company_name, business_number, representative, phone, address').limit(1)
    const company = (companyRows?.[0] ?? {}) as {
      company_name?: string; business_number?: string; representative?: string; phone?: string; address?: string
    }
    data.companyName = company.company_name ?? ''
    data.companyBizno = company.business_number ?? ''
    data.companyRep = company.representative ?? ''
    data.companyPhone = company.phone ?? ''
    data.companyAddress = company.address ?? ''
    if (done.length === 0) missing.push('이행완료 항목 없음')
  }
  return { data, missing }
}

export type Report9Job = {
  id: string; status: string; missing: string[] | null; error: string | null; created_at: string
}
export type Report9File = { name: string; path: string; createdAt: string | null }

/** 생성 요청 — fire_plan_gen_jobs 큐 등록 (워커가 처리, 별지 9·10·11호·외관점검표 공용 — 101·102) */
const ANNEX_TYPES = ['report9', 'report10', 'report11', 'exterior'] as const
export type AnnexType = typeof ANNEX_TYPES[number]

export async function requestReport9Action(
  inspectionId: string,
  reportType: AnnexType = 'report9',
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  if (!ANNEX_TYPES.includes(reportType)) return { error: '지원하지 않는 서식입니다.' }
  const admin = createAdminClient()

  const { data: insp } = await admin.from('inspections')
    .select('id, customer_id, year, inspection_type, plan_type, customer:customers(customer_name)')
    .eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const i = insp as unknown as { id: string; customer_id: string; year: number; inspection_type: string; plan_type: string | null; customer: { customer_name: string } | null }

  // 유형 가드(데이터 계층) — 별지 9·10·11호는 자체점검(special_*·null)만, 정기·레거시 event는 외관점검표만.
  // 관리유형 무관 — 일반관리 자체점검도 대상 (소방계획서_6 W-15, page.tsx isSpecial과 동일 기준)
  const isSpecial = !i.plan_type || i.plan_type.startsWith('special')
  if (['report9', 'report10', 'report11'].includes(reportType) && !isSpecial) {
    return { error: '일반·정기 점검은 별지 9·10·11호 대상이 아닙니다 — 외관점검표만 작성합니다.' }
  }
  if (reportType === 'exterior' && isSpecial) {
    return { error: '자체점검(특별점검)은 외관점검표 대상이 아닙니다 — 별지 9호를 작성해주세요.' }
  }

  const { data: waiting } = await admin.from('fire_plan_gen_jobs')
    .select('id').eq('inspection_id', inspectionId).in('status', ['pending', 'processing']).limit(1)
  if (waiting && waiting.length > 0) return { error: '이미 생성 대기·진행 중입니다 — 잠시 후 새로고침해주세요.' }

  // 소방계획서_7 H-8: 별지 10·11호는 서버 동기 생성 — HTML 템플릿 → Gotenberg PDF, 잡은 완료 기록용
  // (기존 폴링 UI·문서 현황·최근 문서가 잡 테이블·파일 규약을 그대로 읽음. 9호·외관은 아직 워커 경유)
  if (reportType === 'report10' || reportType === 'report11') {
    try {
      const { data: annexData, missing } = await assembleAnnex1011(admin, i.customer_id, inspectionId, reportType)
      const html = reportType === 'report10' ? renderReport10(annexData) : renderReport11(annexData)
      const pdf = await convertHtmlToPdf(html, [], { marginMode: 'none' })
      const stamp = Date.now()
      const base = `${i.customer_id}/inspections/${inspectionId}/${reportType}_${stamp}`
      const upHtml = await admin.storage.from(BUCKET)
        .upload(`${base}.html`, new TextEncoder().encode(html), { contentType: 'text/html; charset=utf-8' })
      if (upHtml.error) return { error: `HTML 업로드 실패: ${upHtml.error.message}` }
      const upPdf = await admin.storage.from(BUCKET)
        .upload(`${base}.pdf`, pdf, { contentType: 'application/pdf' })
      if (upPdf.error) return { error: `PDF 업로드 실패: ${upPdf.error.message}` }
      await admin.from('fire_plan_gen_jobs').insert({
        report_type: reportType,
        inspection_id: inspectionId,
        customer_id: i.customer_id,
        customer_name: i.customer?.customer_name ?? '—',
        year: i.year,
        requested_by: profile.id,
        requested_by_name: profile.name,
        status: 'done',
        missing,
        finished_at: new Date().toISOString(),
      } as Record<string, unknown>)
      revalidatePath(`/inspections/${inspectionId}`)
      return {}
    } catch (e) {
      return { error: `별지 ${reportType === 'report10' ? '10' : '11'}호 생성 실패: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  const { error } = await admin.from('fire_plan_gen_jobs').insert({
    report_type: reportType,
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

/** 별지 10·11호 미리보기 HTML (소방계획서_7 H-4) — 생성물과 동일 렌더 함수 단일 소스,
 *  미입력 항목은 하이라이트(§4-A-2c). 클라이언트는 iframe srcDoc으로 표시 */
export async function getAnnexPreviewHtmlAction(
  inspectionId: string,
  reportType: 'report10' | 'report11',
): Promise<{ html?: string; missing?: string[]; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('id, customer_id, plan_type').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const ins = insp as { customer_id: string; plan_type: string | null }
  if (!(!ins.plan_type || ins.plan_type.startsWith('special'))) {
    return { error: '자체점검 건만 별지 10·11호 대상입니다.' }
  }
  try {
    const { data, missing } = await assembleAnnex1011(admin, ins.customer_id, inspectionId, reportType)
    const html = reportType === 'report10'
      ? renderReport10(data, { highlight: true })
      : renderReport11(data, { highlight: true })
    return { html, missing }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** 최신 작업 상태 + 생성물 목록 (클라이언트 폴링용) */
export async function getReport9StatusAction(inspectionId: string): Promise<{
  job: Report9Job | null; files: Report9File[]; error?: string
}> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()

  const { data: insp } = await admin.from('inspections')
    .select('customer_id, inspection_type, plan_type').eq('id', inspectionId).single()
  if (!insp) return { job: null, files: [], error: '점검을 찾을 수 없습니다.' }
  const ins = insp as { customer_id: string; inspection_type: string; plan_type: string | null }
  const customerId = ins.customer_id

  // 유형 가드(데이터 계층) — 자체점검은 별지 9/10/11호만, 정기·레거시 event는 외관점검표만 조회 (page.tsx isSpecial과 동일)
  const isSpecial = !ins.plan_type || ins.plan_type.startsWith('special')
  const allowTypes = isSpecial ? ['report9', 'report10', 'report11'] : ['exterior']
  const filePattern = isSpecial ? /^report(9|10|11)_/ : /^exterior_/

  const { data: jobs } = await admin.from('fire_plan_gen_jobs')
    .select('id, status, missing, error, created_at')
    .eq('inspection_id', inspectionId).in('report_type', allowTypes)
    .order('created_at', { ascending: false }).limit(1)

  const prefix = `${customerId}/inspections/${inspectionId}`
  const { data: objects } = await admin.storage.from(BUCKET).list(prefix, { limit: 60, sortBy: { column: 'name', order: 'desc' } })
  const files: Report9File[] = (objects ?? [])
    .filter(o => filePattern.test(o.name))
    .map(o => ({ name: o.name, path: `${prefix}/${o.name}`, createdAt: o.created_at ?? null }))

  return { job: (jobs?.[0] as Report9Job | undefined) ?? null, files }
}

/** R4-c: 최신 생성물 바로 받기 — 종류별 최신 스탬프의 PDF(없으면 HWP) 서명 URL.
 *  보고서 센터 ②③ 목록의 인라인 [받기]용(문서 현황 우회, 중복 생성 대신 기생성분 우선). */
export async function getLatestAnnexUrlAction(
  inspectionId: string, kind: 'report9' | 'report10' | 'report11', saveBase?: string,
): Promise<{ url?: string; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const customerId = (insp as { customer_id: string }).customer_id
  const prefix = `${customerId}/inspections/${inspectionId}`
  const { data: objects } = await admin.storage.from(BUCKET)
    .list(prefix, { limit: 100, sortBy: { column: 'name', order: 'desc' } })
  const re = new RegExp(`^${kind}_(\\d+)\\.(hwpx?|pdf|html?)$`, 'i')
  const byStamp: Record<string, { pdf?: string; hwp?: string }> = {}
  let bestStamp = ''
  for (const o of objects ?? []) {
    const m = o.name.match(re)
    if (!m) continue
    const stamp = m[1]; const ext = m[2].toLowerCase()
    const slot = byStamp[stamp] ??= {}
    if (ext.startsWith('pdf')) slot.pdf = o.name
    else if (ext.startsWith('hwp')) slot.hwp = o.name
    if (stamp > bestStamp) bestStamp = stamp
  }
  if (!bestStamp) return { error: '생성된 문서가 없습니다 — 먼저 생성해주세요.' }
  const name = byStamp[bestStamp].pdf ?? byStamp[bestStamp].hwp
  if (!name) return { error: '내려받을 파일을 찾지 못했습니다.' }
  const ext = name.split('.').pop()!
  const saveName = saveBase ? `${saveBase.replace(/[\\/:*?"<>|]/g, '_')}_${(bestStamp || '').slice(0, 8)}.${ext}` : undefined
  const { data, error } = await admin.storage.from(BUCKET)
    .createSignedUrl(`${prefix}/${name}`, 300, saveName ? { download: saveName } : undefined)
  if (error || !data) return { error: '다운로드 URL 생성 실패' }
  return { url: data.signedUrl }
}

/** 생성물 다운로드 — 5분 서명 URL (경로는 해당 점검 폴더로 한정)
 *  saveName 지정 시 저장명 = 고객명_문서명_YYYY-MM-DD.확장자 (R11-d, content-disposition) */
export async function downloadReport9Action(inspectionId: string, path: string, saveName?: string): Promise<{ url?: string; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const prefix = `${(insp as { customer_id: string }).customer_id}/inspections/${inspectionId}/`
  if (!path.startsWith(prefix)) return { error: '잘못된 경로입니다.' }
  const { data, error } = await admin.storage.from(BUCKET)
    .createSignedUrl(path, 300, saveName ? { download: saveName } : undefined)
  if (error || !data) return { error: '다운로드 URL 생성 실패' }
  return { url: data.signedUrl }
}
