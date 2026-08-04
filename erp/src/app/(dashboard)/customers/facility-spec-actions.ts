'use server'

// 설비 세부현황(customer_facility_specs) · 별지 고유 값(annex_inputs) 저장 액션 — S3A/H-18
// (소방계획서_7.md §4-A-0 입력 3계층 ③) — 마이그레이션 112 참조.
//   · customer_facility_specs: 고객·건물 단위 제원(별지 4호 3~7쪽 = 별지 9호 4~7쪽 공용 원본)
//   · annex_inputs: 점검 건 단위 별지 9·10·11호 서식 고유 값

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { FACILITY_SPEC_SECTIONS } from '@/lib/facility-spec-schema'

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

  // UNIQUE가 coalesce 식 인덱스(building_id NULL 대응)라 upsert onConflict를 못 씀 —
  // select → update / insert, 경합으로 insert가 중복(23505)이면 update 재시도
  let sel = admin.from('customer_facility_specs')
    .select('id')
    .eq('customer_id', customerId)
    .eq('section_key', sectionKey)
  sel = buildingId ? sel.eq('building_id', buildingId) : sel.is('building_id', null)
  const { data: existing, error: selError } = await sel.maybeSingle()
  if (selError) return { error: `세부현황 조회 실패: ${selError.message}` }

  const now = new Date().toISOString()
  if (existing) {
    const { error } = await admin.from('customer_facility_specs')
      .update({ spec, updated_at: now } as Record<string, unknown>)
      .eq('id', existing.id)
    if (error) return { error: `세부현황 저장 실패: ${error.message}` }
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
        if (updError) return { error: `세부현황 저장 실패: ${updError.message}` }
      } else {
        return { error: `세부현황 저장 실패: ${error.message}` }
      }
    }
  }

  revalidatePath(`/customers/${customerId}`)
  return {}
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
