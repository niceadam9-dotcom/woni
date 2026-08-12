import type { SupabaseClient } from '@supabase/supabase-js'

/** 문서 누락·기한 판정 함수 1곳 (소방계획서_5 7-C #8, R8-b) —
 *  대시보드 '문서 할 일' 위젯(R0-9)·보고서 센터 누락 뱃지(R8)·고객 문서 현황(R2)·제출 현황판(S4)·크론이 공유.
 *  이중 판정 금지: 화면별로 같은 로직을 다시 만들지 않는다. */

const BUCKET = 'fire-plans'

/** 자체점검(작동·종합) 조건 — plan_type special_*·null 단독 판정, 관리유형 무관 (소방계획서_6 W-4·W-17) */
export const SELF_INSPECTION_OR = 'plan_type.is.null,plan_type.like.special_*'

export type MissingCertRow = {
  inspectionId: string
  customerId: string
  customerName: string
  year: number
  sequenceNum: number
  inspectionType: string
  completedDate: string | null   // 종료일(없으면 시작일)
  daysSince: number | null       // 완료 후 경과일 (정렬용 — 오래된 누락부터)
  assigneeId: string | null      // P-4: '내 담당만' 필터용 배정 직원
}

export type DueReport9Row = {
  inspectionId: string
  customerId: string
  customerName: string
  year: number
  sequenceNum: number
  due: string          // 점검 종료 + 15일
  dday: number         // 음수 = 기한 초과
  assigneeId: string | null      // P-4: '내 담당만' 필터용 배정 직원
}

type InspRow = {
  id: string; customer_id: string; year: number; sequence_num: number
  inspection_type: string; inspection_start_date: string | null; inspection_end_date: string | null
  assigned_employee_id: string | null
  customer: { customer_name: string } | null
}

const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]
const addDays = (base: string, days: number) => {
  const d = new Date(base); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]
}
const diffDays = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000)

/** 배치확인서 업로드 슬롯 파일명 규약 — 판정하는 곳이 여러 화면에 흩어져 있어 정규식을 한 곳에 둔다.
 *  (흩어진 사본이 제각각 갱신되면서 '종이 보관됨'을 못 알아보는 화면이 생겼던 이력이 있다) */
export const CERT_FILE_RE = /^cert_\d+\./i
export const isCertFileName = (name: string) => CERT_FILE_RE.test(name)
/** 계약서 슬롯 — 같은 이유로 규칙을 한 곳에 둔다(표시측이 대소문자를 구분하면 정리측과 어긋난다) */
export const CONTRACT_FILE_RE = /^contract_\d+\./i

/** 점검 폴더에 cert_ 슬롯 파일이 있는가 — 업로드 직감 규칙(R10-c)과 같은 판정 */
export async function hasCertFile(admin: SupabaseClient, customerId: string, inspectionId: string): Promise<boolean> {
  const { data } = await admin.storage.from(BUCKET)
    .list(`${customerId}/inspections/${inspectionId}`, { limit: 100 })
  return (data ?? []).some(o => isCertFileName(o.name))
}

/** 정리 액션이 회차에 남기는 마커 — 증빙 누락 감시가 '업로드 안 함'과 '종이 보관 후 정리'를 구분하는 근거.
 *  activity_logs는 append-only(001)라 이력 자체가 2년 증빙 재구성의 단서로 남는다(소방계획서_18 D-5). */
export const ARCHIVE_CLEANUP_ACTION = 'fire_plan_archive_cleanup'

/** 보관 정책(소방계획서_18 D-7)으로 스캔이 정리된 회차 — '업로드 안 함'과 구분해야 한다.
 *  과거 회차 배치확인서는 종이 보관 후 ERP에서 지우므로, storage만 보면 전부 '누락'으로 보인다.
 *  정리 액션이 남긴 activity_logs 마커가 있으면 종이로 보관 중이라는 뜻이므로 경고 대상에서 뺀다. */
export async function findArchivedCertInspections(
  admin: SupabaseClient, inspectionIds: string[],
): Promise<Set<string>> {
  if (inspectionIds.length === 0) return new Set()
  // 마커는 영구 보존이라 같은 회차에 반복 정리가 누적될 수 있다 — 기본 max-rows에 걸려
  // 일부가 조용히 빠지면 오경고가 되살아나므로 상한을 조회 대상 수에 맞춰 명시한다.
  const { data } = await admin.from('activity_logs')
    .select('entity_id')
    .eq('action', ARCHIVE_CLEANUP_ACTION)
    .eq('entity_type', 'inspection')
    .in('entity_id', inspectionIds)
    .limit(Math.max(1000, inspectionIds.length * 20))
  return new Set((data ?? []).map(r => (r as { entity_id: string }).entity_id))
}

/** R8: 배치확인서 누락 — 완료된 자체점검 & cert 슬롯 없음 & 종이 정리 이력 없음
 *  (정기·레거시 event 제외, 기본 최근 90일 — D-9 정합) */
export async function findMissingCerts(
  admin: SupabaseClient, opts: { sinceDays?: number; limit?: number } = {},
): Promise<MissingCertRow[]> {
  const since = addDays(todayKst(), -(opts.sinceDays ?? 90))
  const { data } = await admin.from('inspections')
    .select('id, customer_id, year, sequence_num, inspection_type, assigned_employee_id, inspection_start_date, inspection_end_date, customer:customers(customer_name)')
    .eq('status', 'completed')
    .or(SELF_INSPECTION_OR)
    .gte('inspection_start_date', since)
    .order('inspection_start_date', { ascending: true })
    .limit(opts.limit ?? 60)
  const rows = (data ?? []) as unknown as InspRow[]
  const today = todayKst()
  const archived = await findArchivedCertInspections(admin, rows.map(i => i.id))
  const checked = await Promise.all(rows.map(async i => {
    if (archived.has(i.id)) return null
    const has = await hasCertFile(admin, i.customer_id, i.id)
    if (has) return null
    const completedDate = i.inspection_end_date ?? i.inspection_start_date
    return {
      inspectionId: i.id, customerId: i.customer_id,
      customerName: i.customer?.customer_name ?? '—',
      year: i.year, sequenceNum: i.sequence_num, inspectionType: i.inspection_type,
      completedDate, daysSince: completedDate ? diffDays(today, completedDate) : null,
      assigneeId: i.assigned_employee_id,
    } satisfies MissingCertRow
  }))
  // 오래된 누락부터 (경과일 내림차순)
  return (checked.filter(Boolean) as MissingCertRow[]).sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0))
}

/** 별지 9호 제출 기한 — 미제출 & 종료일+15일 (임박 판정은 호출부에서 dday ≤ withinDays로) */
export async function findDueReport9(
  admin: SupabaseClient, opts: { sinceDays?: number; withinDays?: number } = {},
): Promise<DueReport9Row[]> {
  const since = addDays(todayKst(), -(opts.sinceDays ?? 90))
  const { data } = await admin.from('inspections')
    .select('id, customer_id, year, sequence_num, inspection_type, assigned_employee_id, inspection_start_date, inspection_end_date, report9_submitted_at, customer:customers(customer_name)')
    .or(SELF_INSPECTION_OR)
    .is('report9_submitted_at', null)
    .not('inspection_end_date', 'is', null)
    .gte('inspection_end_date', since)
    .limit(100)
  const today = todayKst()
  const out: DueReport9Row[] = []
  for (const i of (data ?? []) as unknown as InspRow[]) {
    const end = i.inspection_end_date!
    const due = addDays(end, 15)
    const dday = diffDays(due, today)
    if (opts.withinDays !== undefined && dday > opts.withinDays) continue
    out.push({
      inspectionId: i.id, customerId: i.customer_id,
      customerName: i.customer?.customer_name ?? '—',
      year: i.year, sequenceNum: i.sequence_num, due, dday,
      assigneeId: i.assigned_employee_id,
    })
  }
  // 위험순 — 초과(음수) → 임박
  return out.sort((a, b) => a.dday - b.dday)
}

/** 대시보드 '문서 할 일' 위젯 데이터 (R0-9) — 기한 임박(D-7 이내·초과) + 배치확인서 누락 */
export async function getDocTodo(admin: SupabaseClient): Promise<{
  dueSoon: DueReport9Row[]; missingCerts: MissingCertRow[]
}> {
  const [dueSoon, missingCerts] = await Promise.all([
    findDueReport9(admin, { withinDays: 7 }),
    findMissingCerts(admin),
  ])
  return { dueSoon, missingCerts }
}
