import type { SupabaseClient } from '@supabase/supabase-js'

/** 문서 누락·기한 판정 함수 1곳 (소방계획서_5 7-C #8, R8-b) —
 *  대시보드 '문서 할 일' 위젯(R0-9)·보고서 센터 누락 뱃지(R8)·고객 문서 현황(R2)·제출 현황판(S4)·크론이 공유.
 *  이중 판정 금지: 화면별로 같은 로직을 다시 만들지 않는다. */

const BUCKET = 'fire-plans'

/** 자체점검(작동·종합) 조건 — plan_type special_*·null & 일반관리 제외 (§3-3 매트릭스, R9와 동일 기준) */
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
}

export type DueReport9Row = {
  inspectionId: string
  customerId: string
  customerName: string
  year: number
  sequenceNum: number
  due: string          // 점검 종료 + 15일
  dday: number         // 음수 = 기한 초과
}

type InspRow = {
  id: string; customer_id: string; year: number; sequence_num: number
  inspection_type: string; inspection_start_date: string | null; inspection_end_date: string | null
  customer: { customer_name: string } | null
}

const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]
const addDays = (base: string, days: number) => {
  const d = new Date(base); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]
}
const diffDays = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000)

/** 점검 폴더에 cert_ 슬롯 파일이 있는가 — 업로드 직감 규칙(R10-c)과 같은 판정 */
export async function hasCertFile(admin: SupabaseClient, customerId: string, inspectionId: string): Promise<boolean> {
  const { data } = await admin.storage.from(BUCKET)
    .list(`${customerId}/inspections/${inspectionId}`, { limit: 100 })
  return (data ?? []).some(o => /^cert_\d+\./.test(o.name))
}

/** R8: 배치확인서 누락 — 완료된 자체점검 & cert 슬롯 없음 (정기·일반관리 제외, 기본 최근 90일 — D-9 정합) */
export async function findMissingCerts(
  admin: SupabaseClient, opts: { sinceDays?: number; limit?: number } = {},
): Promise<MissingCertRow[]> {
  const since = addDays(todayKst(), -(opts.sinceDays ?? 90))
  const { data } = await admin.from('inspections')
    .select('id, customer_id, year, sequence_num, inspection_type, inspection_start_date, inspection_end_date, customer:customers(customer_name)')
    .eq('status', 'completed')
    .neq('inspection_type', '일반관리')
    .or(SELF_INSPECTION_OR)
    .gte('inspection_start_date', since)
    .order('inspection_start_date', { ascending: true })
    .limit(opts.limit ?? 60)
  const rows = (data ?? []) as unknown as InspRow[]
  const today = todayKst()
  const checked = await Promise.all(rows.map(async i => {
    const has = await hasCertFile(admin, i.customer_id, i.id)
    if (has) return null
    const completedDate = i.inspection_end_date ?? i.inspection_start_date
    return {
      inspectionId: i.id, customerId: i.customer_id,
      customerName: i.customer?.customer_name ?? '—',
      year: i.year, sequenceNum: i.sequence_num, inspectionType: i.inspection_type,
      completedDate, daysSince: completedDate ? diffDays(today, completedDate) : null,
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
    .select('id, customer_id, year, sequence_num, inspection_type, inspection_start_date, inspection_end_date, report9_submitted_at, customer:customers(customer_name)')
    .neq('inspection_type', '일반관리')
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
