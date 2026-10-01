import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/** 1.4 소방시설(PlanForm14) 초기 데이터 조립 — **로드 규칙 단일 원천** (소방계획서_40 S1).
 *
 *  종전엔 고객 상세 페이지에 인라인돼 있었다. /inspections/[id]/facilities(점검 귀속 설비 화면)가
 *  같은 폼을 서빙하게 되면서, 두 화면이 서로 다른 초기값을 보는 사고를 막으려면 조립이 한 곳이어야 한다.
 *  저장 쪽 단일 원천은 saveFacilitiesAction — 읽기·쓰기가 각각 하나씩이다.
 *
 *  속도 개선 3단계(2026-10-01): 조회(fetch*)와 조립(assemble)을 갈랐다. 고객 상세는 건물 id를 기다리지
 *  않고 **고객 id로 바로**(buildings!inner 조인 필터) 세 표를 묻어 첫 물결에 합류한다 — 종전엔 건물 조회가
 *  끝난 뒤의 둘째 물결이라 왕복 한 번(~230ms)이 더 들었다. 조립 규칙은 한 벌이다. */

export type FacilityFormBuilding = {
  id: string; building_name: string; verified_at: string | null
  facilities: Array<{ facility_code: string; installed: boolean; detail: { note?: string } | null }>
  floors: Array<{ floor_label: string; counts: Record<string, number> }>
  purpose: string | null; floorsAbove: number | null; floorsBelow: number | null
  receiverLocation: string | null; emergencyElevatorCount: number | null
}

/** buildings 행에서 조립에 쓰는 컬럼만 — 고객 페이지는 select('*') 결과를 그대로 넘겨도 맞는다 */
export type FacilityBuildingRow = {
  id: string; building_name: string; is_active: boolean
  facilities_verified_at: string | null
  purpose: string | null; floors_above: number | null; floors_below: number | null
} & Record<string, unknown>

type FacRow = { building_id: string; facility_code: string; installed: boolean; detail: { note?: string } | null }
type FloorRow = { building_id: string; floor_label: string; counts: Record<string, number> }
type SpecRow = { building_id: string | null; section_key: string; spec: Record<string, unknown> | null }
/** 세 표의 원시 행 — 조립 전 */
export type FacilityRawRows = { facilities: FacRow[]; floors: FloorRow[]; specs: SpecRow[] }

const FAC_COLS = 'building_id, facility_code, installed, detail'
const FLOOR_COLS = 'building_id, floor_label, counts'
const SPEC_COLS = 'building_id, section_key, spec'

function collect(
  name: string,
  facRes: { data: unknown; error: { message: string } | null },
  floorRes: { data: unknown; error: { message: string } | null },
  specRes: { data: unknown; error: { message: string } | null },
): FacilityRawRows {
  for (const [t, r] of [['fire_facilities', facRes], ['fire_facility_floors', floorRes], ['customer_facility_specs', specRes]] as const) {
    if (r.error) console.error(`[facility-form-data] ${t} 조회 실패(${name}) — 1.4 화면이 비어 보일 수 있습니다:`, r.error.message)
  }
  return {
    facilities: (facRes.data ?? []) as FacRow[],
    floors: (floorRes.data ?? []) as FloorRow[],
    specs: (specRes.data ?? []) as SpecRow[],
  }
}

/** 고객 id만으로 세 표를 묻는다 — 건물 id 없이 첫 물결에서 병렬 시작할 수 있다.
 *  `buildings!inner(customer_id)` + `.eq('buildings.customer_id')`: fire_facilities→buildings FK는 하나라
 *  임베드 모호성(PGRST201)이 없다. 임베드된 buildings 키는 조립이 읽지 않는다. */
export async function fetchFacilityRowsByCustomer(admin: Admin, customerId: string): Promise<FacilityRawRows> {
  const [facRes, floorRes, specRes] = await Promise.all([
    admin.from('fire_facilities').select(`${FAC_COLS}, buildings!inner(customer_id)`).eq('buildings.customer_id', customerId),
    admin.from('fire_facility_floors').select(`${FLOOR_COLS}, buildings!inner(customer_id)`).eq('buildings.customer_id', customerId).order('sort_order'),
    // H-19 설비 대장 — 세부 제원 초기값 (112 customer_facility_specs, building_id NULL = 대표/공통)
    admin.from('customer_facility_specs').select(SPEC_COLS).eq('customer_id', customerId),
  ])
  return collect('customer', facRes, floorRes, specRes)
}

async function fetchFacilityRowsByBuildings(admin: Admin, customerId: string, buildingIds: string[]): Promise<FacilityRawRows> {
  if (buildingIds.length === 0) return { facilities: [], floors: [], specs: [] }
  const [facRes, floorRes, specRes] = await Promise.all([
    admin.from('fire_facilities').select(FAC_COLS).in('building_id', buildingIds),
    admin.from('fire_facility_floors').select(FLOOR_COLS).in('building_id', buildingIds).order('sort_order'),
    admin.from('customer_facility_specs').select(SPEC_COLS).eq('customer_id', customerId),
  ])
  return collect('buildings', facRes, floorRes, specRes)
}

/** 조립 — 건물 행 + 세 표의 원시 행 → 1.4 폼 초기값 (순수 함수) */
export function assembleFacilityFormData(
  buildings: FacilityBuildingRow[], rows: FacilityRawRows,
): { facilityBuildings: FacilityFormBuilding[]; specsByBuilding: Record<string, Record<string, Record<string, unknown>>> } {
  const facByBuilding = new Map<string, FacilityFormBuilding['facilities']>()
  for (const f of rows.facilities) {
    if (!facByBuilding.has(f.building_id)) facByBuilding.set(f.building_id, [])
    facByBuilding.get(f.building_id)!.push({ facility_code: f.facility_code, installed: f.installed, detail: f.detail })
  }
  const floorByBuilding = new Map<string, FacilityFormBuilding['floors']>()
  for (const fl of rows.floors) {
    if (!floorByBuilding.has(fl.building_id)) floorByBuilding.set(fl.building_id, [])
    floorByBuilding.get(fl.building_id)!.push({ floor_label: fl.floor_label, counts: fl.counts ?? {} })
  }
  const facilityBuildings: FacilityFormBuilding[] = buildings.filter(b => b.is_active).map(b => ({
    id: b.id, building_name: b.building_name, verified_at: b.facilities_verified_at,
    facilities: facByBuilding.get(b.id) ?? [], floors: floorByBuilding.get(b.id) ?? [],
    // §6-E: 층 자동 생성·기본 세트용
    purpose: b.purpose, floorsAbove: b.floors_above, floorsBelow: b.floors_below,
    // H-19: 기존 필드 자동 연결(§4-A-1) — 수신기 위치 회색 표시용
    receiverLocation: (b.receiver_location as string | null) ?? null,
    // 세부제원의 건물 파생 필드(3-8 비상용승강기) 원천 — 건물·시설 탭에서 이미 받은 값을 다시 묻지 않는다
    emergencyElevatorCount: (b.emergency_elevator_count as number | null) ?? null,
  }))
  // H-19 설비 대장 — 건물별 세부 제원 초기값 ('' = 대표/공통 building_id NULL 폴백)
  const specsByBuilding: Record<string, Record<string, Record<string, unknown>>> = {}
  for (const r of rows.specs) {
    const k = r.building_id ?? ''
    if (!specsByBuilding[k]) specsByBuilding[k] = {}
    specsByBuilding[k][r.section_key] = (r.spec ?? {}) as Record<string, unknown>
  }
  return { facilityBuildings, specsByBuilding }
}

/** 조회+조립 한 번에 — /inspections/[id]/facilities 등 건물 id 경로의 호출부용 */
export async function loadFacilityFormData(
  admin: Admin, customerId: string,
  /** 호출부가 이미 buildings를 조회했으면 재사용(왕복 1회 절약). 없으면 여기서 조회 */
  prefetchedBuildings?: FacilityBuildingRow[],
): Promise<{ facilityBuildings: FacilityFormBuilding[]; specsByBuilding: Record<string, Record<string, Record<string, unknown>>> }> {
  const buildings = prefetchedBuildings ?? (
    ((await admin.from('buildings').select('*').eq('customer_id', customerId).order('building_name'))
      .data ?? []) as FacilityBuildingRow[]
  )
  const rows = await fetchFacilityRowsByBuildings(admin, customerId, buildings.map(b => b.id))
  return assembleFacilityFormData(buildings, rows)
}
