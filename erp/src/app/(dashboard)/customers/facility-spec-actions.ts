'use server'

// 설비 세부현황(customer_facility_specs) · 별지 고유 값(annex_inputs) 저장 액션 — S3A/H-18
// (소방계획서_7.md §4-A-0 입력 3계층 ③) — 마이그레이션 112 참조.
//   · customer_facility_specs: 고객·건물 단위 제원(별지 4호 3~7쪽 = 별지 9호 4~7쪽 공용 원본)
//   · annex_inputs: 점검 건 단위 별지 9·10·11호 서식 고유 값

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { FACILITY_SPEC_SECTIONS } from '@/lib/facility-spec-schema'
import { FACILITY_STANDARD } from '@/lib/facility-codes'
import { facilitiesForSheet } from '@/lib/sheet-facility-map'
import { getLatestSpecialInspection } from '@/lib/latest-inspection'

const SECTION_KEYS = new Set(FACILITY_SPEC_SECTIONS.map(s => s.key))
const ANNEX_NOS = new Set(['report9', 'report10', 'report11'])

// ── 설비 세부현황 (고객·건물 단위) ──────────────────────────────────────────

/** 고객(+건물)의 세부현황 전체 조회 — buildingId 생략/null = 대표(공통) 세트 */
export async function getFacilitySpecsAction(
  customerId: string,
  buildingId?: string | null,
): Promise<{ specs: Record<string, Record<string, unknown>>; error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  let query = admin.from('customer_facility_specs')
    .select('section_key, spec')
    .eq('customer_id', customerId)
  query = buildingId ? query.eq('building_id', buildingId) : query.is('building_id', null)

  const { data, error } = await query
  if (error) return { specs: {}, error: `세부현황 조회 실패: ${error.message}` }

  const specs: Record<string, Record<string, unknown>> = {}
  for (const row of data ?? []) {
    specs[row.section_key as string] = (row.spec ?? {}) as Record<string, unknown>
  }
  return { specs }
}

/** 섹션 1건 upsert 본체 — 단건·벌크 액션 공용. 성공 시 null, 실패 시 에러 메시지 반환.
 *  UNIQUE가 coalesce 식 인덱스(building_id NULL 대응)라 upsert onConflict를 못 씀 —
 *  select → update / insert, 경합으로 insert가 중복(23505)이면 update 재시도 */
async function upsertSpec(
  admin: ReturnType<typeof createAdminClient>,
  customerId: string,
  buildingId: string | null,
  sectionKey: string,
  spec: Record<string, unknown>,
): Promise<string | null> {
  let sel = admin.from('customer_facility_specs')
    .select('id')
    .eq('customer_id', customerId)
    .eq('section_key', sectionKey)
  sel = buildingId ? sel.eq('building_id', buildingId) : sel.is('building_id', null)
  const { data: existing, error: selError } = await sel.maybeSingle()
  if (selError) return `세부현황 조회 실패: ${selError.message}`

  const now = new Date().toISOString()
  if (existing) {
    const { error } = await admin.from('customer_facility_specs')
      .update({ spec, updated_at: now } as Record<string, unknown>)
      .eq('id', existing.id)
    if (error) return `세부현황 저장 실패: ${error.message}`
  } else {
    const { error } = await admin.from('customer_facility_specs')
      .insert({ customer_id: customerId, building_id: buildingId, section_key: sectionKey, spec, updated_at: now } as Record<string, unknown>)
    if (error) {
      if (error.code === '23505') {
        // 동시 저장 경합 — 이미 생긴 행에 update 재시도
        let upd = admin.from('customer_facility_specs')
          .update({ spec, updated_at: now } as Record<string, unknown>)
          .eq('customer_id', customerId)
          .eq('section_key', sectionKey)
        upd = buildingId ? upd.eq('building_id', buildingId) : upd.is('building_id', null)
        const { error: updError } = await upd
        if (updError) return `세부현황 저장 실패: ${updError.message}`
      } else {
        return `세부현황 저장 실패: ${error.message}`
      }
    }
  }
  return null
}

/** 세부현황 섹션 단위 저장 (upsert) — sectionKey는 카탈로그(s31~s38) 화이트리스트 검증 */
export async function saveFacilitySpecAction(
  customerId: string,
  buildingId: string | null,
  sectionKey: string,
  spec: Record<string, unknown>,
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  if (!SECTION_KEYS.has(sectionKey)) return { error: '알 수 없는 세부현황 섹션입니다.' }
  const admin = createAdminClient()
  const err = await upsertSpec(admin, customerId, buildingId, sectionKey, spec)
  if (err) return { error: err }
  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** 세부현황 벌크 저장 (소방계획서_9 — 2026-08-05) — 미저장 섹션 전부를 [모두 저장] 1클릭으로.
 *  부분 실패 허용: 실패 섹션은 errors에 수집(호출부가 dirty 유지 → 재클릭 = 재시도), revalidate는 마지막 1회 */
export async function saveFacilitySpecsBulkAction(
  customerId: string,
  buildingId: string | null,
  specs: Record<string, Record<string, unknown>>,
): Promise<{ saved: string[]; errors: Record<string, string> }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const saved: string[] = []
  const errors: Record<string, string> = {}
  for (const [sectionKey, spec] of Object.entries(specs)) {
    if (!SECTION_KEYS.has(sectionKey)) { errors[sectionKey] = '알 수 없는 세부현황 섹션입니다.'; continue }
    const err = await upsertSpec(admin, customerId, buildingId, sectionKey, spec)
    if (err) errors[sectionKey] = err
    else saved.push(sectionKey)
  }
  if (saved.length > 0) revalidatePath(`/customers/${customerId}`)
  return { saved, errors }
}

/** 교차 검증 (소방계획서_8 H-5e·D-17 ④) — 최근 자체점검 회차에서 점검표 응답(○×)이 있는 설비 코드.
 *  설비 대장이 "점검은 했는데 제원 미입력" 칩을 띄우는 근거 — 응답이 있는 최신 회차 1건 기준.
 *  시트→설비 매핑은 SHEET_FACILITY_MAP(명시) 우선, 미등재 시트는 퍼지 폴백.
 *
 *  T-2a(소방계획서_14_점검업무) — 여기에 **시트별 응답 통계**를 얹는다. 설비 대장 섹션 헤더의
 *  점검 결과 배지가 쓴다. 마크(○/×/／) 판정은 호출부가 공용 rollUpForm3Results로 직접 하도록
 *  **원자료만** 돌려준다. 이유 두 가지:
 *   ① 별지9호 3쪽과 **같은 함수**를 쓰게 되어 문서와 화면이 어긋나지 않는다(T-2a-1).
 *   ② '해당없음(／)' 판정에 필요한 설치 여부는 클라이언트가 더 정확하다 — 화면의 1.4 체크는
 *      저장 전 토글까지 반영된 최신 상태라, 서버가 DB로 판정하면 방금 켠 설비가 ／로 보인다. */
export async function getInspectedFacilityCodesAction(
  customerId: string,
): Promise<{
  codes: string[]
  roundLabel: string | null
  /** 시트명 → { any: 응답 있음, x: 불량 있음 } — rollUpForm3Results 입력 */
  sheetStats: Array<[string, { any: boolean; x: boolean }]>
  /** 시트명 → 불량(X) 응답 수 — 배지의 "불량 n건" */
  defectsBySheet: Record<string, number>
  error?: string
}> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const empty = { codes: [], roundLabel: null, sheetStats: [], defectsBySheet: {} }

  // 최신 자체점검 건 판정은 공용 헬퍼로 단일화 (소방계획서_14_점검업무 T-2b-1b·D-6) —
  // 종전 이 자리의 로컬 구현을 그대로 옮긴 것. 축이 갈리면 이 칩과 점검표 화면이 다른 회차를 가리킨다.
  const target = await getLatestSpecialInspection(admin, customerId, { requireResponses: true })
  if (!target) return empty
  const roundLabel = target.label

  // 응답 전량 (PostgREST 1,000행 한도 대비 페이지 순회 — report9 롤업과 동일 계열)
  const resultByItem = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('inspection_sheet_responses')
      .select('item_code, result').eq('inspection_id', target.id).range(from, from + 999)
    const rows = (data ?? []) as Array<{ item_code: string; result: string }>
    for (const r of rows) resultByItem.set(r.item_code, r.result)
    if (rows.length < 1000) break
  }

  // item_code → 시트 (카탈로그 고정 데이터 전량 순회)
  const sheetIdByItem = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('inspection_sheet_items')
      .select('item_code, sheet_id').range(from, from + 999)
    const rows = (data ?? []) as Array<{ item_code: string; sheet_id: string }>
    for (const r of rows) if (resultByItem.has(r.item_code)) sheetIdByItem.set(r.item_code, r.sheet_id)
    if (rows.length < 1000) break
  }
  const sheetIds = new Set(sheetIdByItem.values())
  if (sheetIds.size === 0) return { ...empty, roundLabel }

  const { data: sheetRaw } = await admin.from('inspection_sheets')
    .select('id, sheet_name').in('id', [...sheetIds])
  const nameById = new Map(((sheetRaw ?? []) as Array<{ id: string; sheet_name: string }>)
    .map(s => [s.id, s.sheet_name]))

  const stat = new Map<string, { any: boolean; x: boolean }>()
  const defectsBySheet: Record<string, number> = {}
  for (const [itemCode, result] of resultByItem) {
    const name = nameById.get(sheetIdByItem.get(itemCode) ?? '')
    if (!name) continue
    const cur = stat.get(name) ?? { any: false, x: false }
    stat.set(name, { any: true, x: cur.x || result === 'X' })
    if (result === 'X') defectsBySheet[name] = (defectsBySheet[name] ?? 0) + 1
  }

  const allFacilities = FACILITY_STANDARD.flatMap(g => g.items)
  const codes = new Set<string>()
  for (const name of stat.keys()) {
    for (const c of facilitiesForSheet(name, allFacilities)) codes.add(c)
  }
  return { codes: [...codes], roundLabel, sheetStats: [...stat], defectsBySheet }
}

// ── 별지 서식 고유 값 (점검 건 단위) ────────────────────────────────────────

/** 별지 9·10·11호 고유 값 조회 — 없으면 빈 객체 (첫 작성) */
export async function getAnnexInputsAction(
  inspectionId: string,
  annexNo: string,
): Promise<{ fields: Record<string, unknown>; error?: string }> {
  await requirePermission('inspection_register')
  if (!ANNEX_NOS.has(annexNo)) return { fields: {}, error: '알 수 없는 별지 서식입니다.' }
  const admin = createAdminClient()

  const { data, error } = await admin.from('annex_inputs')
    .select('fields')
    .eq('inspection_id', inspectionId)
    .eq('annex_no', annexNo)
    .maybeSingle()
  if (error) return { fields: {}, error: `별지 입력값 조회 실패: ${error.message}` }
  return { fields: (data?.fields ?? {}) as Record<string, unknown> }
}

/** 전 회차 이어받기 (소방계획서_8 H-5b·D-5) — 같은 고객의 직전 자체점검 회차에서 같은 별지의
 *  입력값을 조회해 반환. 날짜류 제외는 클라이언트(FIELD_DEFS type==='date')가 담당. */
export async function getPrevAnnexInputsAction(
  inspectionId: string,
  annexNo: string,
): Promise<{ fields: Record<string, unknown>; fromLabel?: string; error?: string }> {
  await requirePermission('inspection_register')
  if (!ANNEX_NOS.has(annexNo)) return { fields: {}, error: '알 수 없는 별지 서식입니다.' }
  const admin = createAdminClient()

  const { data: cur } = await admin.from('inspections')
    .select('customer_id, inspection_start_date').eq('id', inspectionId).single()
  if (!cur) return { fields: {}, error: '점검을 찾을 수 없습니다.' }
  const c = cur as { customer_id: string; inspection_start_date: string | null }

  // 직전 자체점검 회차 — 시작일 기준 바로 이전 (같은 고객·자체점검만)
  let q = admin.from('inspections')
    .select('id, year, sequence_num, inspection_start_date')
    .eq('customer_id', c.customer_id)
    .neq('id', inspectionId)
    .or('plan_type.is.null,plan_type.like.special_*')
    .order('inspection_start_date', { ascending: false, nullsFirst: false })
    .limit(1)
  if (c.inspection_start_date) q = q.lt('inspection_start_date', c.inspection_start_date) as typeof q
  const { data: prevList } = await q
  const prev = (prevList?.[0] ?? null) as { id: string; year: number; sequence_num: number } | null
  if (!prev) return { fields: {} }

  const { data } = await admin.from('annex_inputs')
    .select('fields')
    .eq('inspection_id', prev.id)
    .eq('annex_no', annexNo)
    .maybeSingle()
  const fields = (data?.fields ?? {}) as Record<string, unknown>
  if (Object.keys(fields).length === 0) return { fields: {} }
  return { fields, fromLabel: `${prev.year}년 ${prev.sequence_num}차` }
}

/** 별지 9·10·11호 고유 값 저장 (upsert) — 재작성 시 이전 입력 유지·갱신(§4-A-2b) */
export async function saveAnnexInputsAction(
  inspectionId: string,
  annexNo: string,
  fields: Record<string, unknown>,
): Promise<{ error?: string }> {
  await requirePermission('inspection_register')
  if (!ANNEX_NOS.has(annexNo)) return { error: '알 수 없는 별지 서식입니다.' }
  const admin = createAdminClient()

  const { error } = await admin.from('annex_inputs')
    .upsert(
      { inspection_id: inspectionId, annex_no: annexNo, fields, updated_at: new Date().toISOString() } as Record<string, unknown>,
      { onConflict: 'inspection_id,annex_no' },
    )
  if (error) return { error: `별지 입력값 저장 실패: ${error.message}` }
  return {}
}
