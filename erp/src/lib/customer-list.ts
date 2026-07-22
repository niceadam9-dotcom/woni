import type { SupabaseClient } from '@supabase/supabase-js'
import { computeFirePlanReadiness } from '@/lib/fire-plan-readiness'
import { isGeneralManagement } from '@/lib/doc-requirements'
import type { InspectionType } from '@/types'

/** 고객 목록 공용 조회 (서버 전용) — 목록 페이지와 상세 [◀ 이전|다음 ▶] 네비가 같은 필터·정렬을 공유한다.
 *  (탭개편 설계 §6-B·§6-C-3 — 미완료 판정은 고객 상세 탭 뱃지(§4)와 동일 기준) */

export type CustomerListFilter = {
  q?: string
  type?: string
  active?: string   // 'active'(기본) | 'inactive' | 'all'
  inc?: string      // '' | 'any'(입력 미완료) | 'plan'(계획서 미완료, §6-D-5)
}

export type CustomerListBuilding = {
  id: string; building_name: string
  total_area: number | null; floors_above: number | null; floors_below: number | null
  purpose: string | null; is_active: boolean
}

export type CustomerListItem = {
  id: string; customer_code: string; customer_name: string
  contract_date: string | null; use_approval_date: string | null; plan_anchor_date: string | null
  inspection_type: InspectionType; address: string | null
  is_active: boolean; assigned_employee_id: string | null; created_at: string
  buildings: CustomerListBuilding[]
  planDone: number; planTotal: number
  /** 미완료 영역 (탭 뱃지 §4 기준): 기본정보·건물·관계인·계획서·청구 */
  incompleteAreas: string[]
}

/** URL searchParams → 필터 (목록·상세 lq 공용) */
export function parseListFilter(sp: Record<string, string | undefined>): CustomerListFilter {
  return { q: sp.q ?? '', type: sp.type ?? '', active: sp.active ?? 'active', inc: sp.inc ?? '' }
}

export async function fetchCustomerList(
  admin: SupabaseClient,
  f: CustomerListFilter,
): Promise<CustomerListItem[]> {
  let query = admin
    .from('customers')
    .select(`id, customer_code, customer_name, contract_date, use_approval_date, plan_anchor_date,
      inspection_type, address, is_active, assigned_employee_id, created_at,
      region_si, region_myeon, region_ri,
      manager_selected_at, building_grade, insurance_joined, op_hours_weekday,
      headcount_worker, headcount_resident, headcount_max,
      buildings(id, building_name, total_area, floors_above, floors_below, purpose, is_active,
        receiver_location, main_structure, roof_structure)`)
    .order('created_at', { ascending: false })

  // 통합 검색 (V10 §6 스마트 감지): 건물명·주소·읍면·리 + 담당자 이름
  const q = (f.q ?? '').trim()
  if (q) {
    const { data: matchedEmps } = await admin.from('profiles').select('id').ilike('name', `%${q}%`)
    const empIds = ((matchedEmps ?? []) as { id: string }[]).map(e => e.id)
    const ors = [
      `customer_name.ilike.%${q}%`,
      `address.ilike.%${q}%`,
      `region_myeon.ilike.%${q}%`,
      `region_ri.ilike.%${q}%`,
    ]
    if (empIds.length > 0) ors.push(`assigned_employee_id.in.(${empIds.join(',')})`)
    query = query.or(ors.join(','))
  }
  if (f.type) query = query.eq('inspection_type', f.type)
  if (f.active === 'active' || !f.active) query = query.eq('is_active', true)
  if (f.active === 'inactive') query = query.eq('is_active', false)

  const { data } = await query
  type Raw = Record<string, unknown> & { buildings: Array<Record<string, unknown>> | null }
  const rows = (data ?? []) as unknown as Raw[]
  if (rows.length === 0) return []

  // 미완료 판정용 배치 조회 (관계인 대표·사업자·자위소방대) — 고객 수만큼 개별 조회하지 않음
  const ids = rows.map(r => r.id as string)
  const [repsRes, billingRes, brigadeRes] = await Promise.all([
    admin.from('customer_contacts').select('customer_id').in('customer_id', ids).eq('role', '대표'),
    admin.from('billing_profiles').select('customer_id').in('customer_id', ids),
    admin.from('fire_brigade_members').select('customer_id').in('customer_id', ids),
  ])
  const repIds = new Set(((repsRes.data ?? []) as Array<{ customer_id: string }>).map(r => r.customer_id))
  const billingIds = new Set(((billingRes.data ?? []) as Array<{ customer_id: string }>).map(r => r.customer_id))
  const brigadeIds = new Set(((brigadeRes.data ?? []) as Array<{ customer_id: string }>).map(r => r.customer_id))

  const s = (v: unknown) => (v == null ? '' : String(v))
  const items = rows.map(r => {
    const buildings = ((r.buildings ?? []) as Array<Record<string, unknown>>).map(b => ({
      id: b.id as string, building_name: b.building_name as string,
      total_area: (b.total_area as number | null) ?? null,
      floors_above: (b.floors_above as number | null) ?? null,
      floors_below: (b.floors_below as number | null) ?? null,
      purpose: (b.purpose as string | null) ?? null,
      is_active: (b.is_active as boolean) ?? true,
      receiver_location: (b.receiver_location as string | null) ?? null,
      main_structure: (b.main_structure as string | null) ?? null,
      roof_structure: (b.roof_structure as string | null) ?? null,
    }))
    const activeBlds = buildings.filter(b => b.is_active)
    const firstBld = activeBlds[0]
    const readiness = computeFirePlanReadiness({
      receiverLocation: s(firstBld?.receiver_location),
      structure: s(firstBld?.main_structure),
      roof: s(firstBld?.roof_structure),
      managerSelectedAt: s(r.manager_selected_at),
      grade: s(r.building_grade),
      insuranceJoined: (r.insurance_joined as boolean | null) ?? null,
      opHoursWeekday: s(r.op_hours_weekday),
      hasHeadcount: r.headcount_worker != null || r.headcount_resident != null || r.headcount_max != null,
      hasBrigade: brigadeIds.has(r.id as string),
    })
    // 일반관리 = 소방계획서 작성 대상 아님 (§9-8 doc-requirements) — 준비율·계획서 미완료 판정 억제
    const general = isGeneralManagement({ inspection_type: r.inspection_type as string })
    const incompleteAreas: string[] = []
    if (!r.plan_anchor_date || !r.assigned_employee_id) incompleteAreas.push('기본정보')
    if (!(activeBlds.length > 0 && activeBlds.some(b => b.purpose && b.total_area != null))) incompleteAreas.push('건물')
    if (!repIds.has(r.id as string)) incompleteAreas.push('관계인')
    if (!general && readiness.done < readiness.total) incompleteAreas.push('계획서')
    if (!billingIds.has(r.id as string)) incompleteAreas.push('청구')

    return {
      id: r.id as string, customer_code: r.customer_code as string, customer_name: r.customer_name as string,
      contract_date: (r.contract_date as string | null) ?? null,
      use_approval_date: (r.use_approval_date as string | null) ?? null,
      plan_anchor_date: (r.plan_anchor_date as string | null) ?? null,
      inspection_type: r.inspection_type as InspectionType,
      address: (r.address as string | null) ?? null,
      is_active: r.is_active as boolean,
      assigned_employee_id: (r.assigned_employee_id as string | null) ?? null,
      created_at: r.created_at as string,
      buildings,
      planDone: general ? 0 : readiness.done, planTotal: general ? 0 : readiness.total,
      incompleteAreas,
    }
  })

  // 미완료 필터 (조회 후 판정 — 대상 규모가 작아 JS 필터로 충분)
  if (f.inc === 'any') return items.filter(i => i.incompleteAreas.length > 0)
  if (f.inc === 'plan') return items.filter(i => i.planDone < i.planTotal)
  return items
}
