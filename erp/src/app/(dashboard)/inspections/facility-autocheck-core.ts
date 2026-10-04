/** 점검표 → 1.4 대장 따라잡기 **판정·쓰기 코어** — facility-autocheck-actions.ts에서 추출 (C1, 2026-10-04)
 *
 *  ⚠ 이 파일에는 `'use server'`를 **넣지 않는다** (step-revalidate.ts와 같은 전례).
 *  웹 서버액션(`facility-autocheck-actions.ts`)과 모바일 라우트(`/api/mobile/sheet-save`)가
 *  **같은 함수 한 벌**을 타기 위해서다 — 액션은 requirePermission(쿠키), 라우트는
 *  requireMobileUser(Bearer)로 각자 인증한 뒤 여기로 위임한다. 판정 로직이 두 벌이 되면
 *  "보이는 것과 켜지는 것"이 입구에 따라 갈린다.
 *
 *  동작 원칙(원본 주석 요약 — 상세는 facility-autocheck-actions.ts 머리말):
 *  - `facilities_verified_at`은 절대 건드리지 않는다(§9-4 — 사람의 확인 행위).
 *  - 행 단위 upsert만. `detail.note`(사람 비고)는 보존, 출처는 `detail.auto`로 남긴다.
 *  - 0동·다동은 쓰지 않고 `skipped`로 알린다(§9-7 미결정 1).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { foldSheetGroupStats } from '@/lib/sheet-facility-map'
import { sheetItemGroupRef } from '@/lib/sheet-scope'
import { getAllSheetItems, getSheets } from '@/lib/sheet-catalog'
import { planFacilityAutoCheck, type AutoCheckResult } from '@/lib/facility-autocheck'
import { FORM3_ITEMS } from '@/lib/doc-templates/report9'
import { todayKst } from '@/lib/kst-date'

/** 읽기·쓰기 공용 — 판정은 한 번만 정의한다(보이는 것과 켜지는 것이 갈리면 안 된다) */
export async function runAutoCheck(
  inspectionId: string,
  opts: { write: boolean; only?: string[] },
): Promise<AutoCheckResult> {
  const admin = createAdminClient()

  const { data: insp } = await admin.from('inspections')
    .select('customer_id').eq('id', inspectionId).maybeSingle()
  const customerId = (insp as { customer_id?: string } | null)?.customer_id
  if (!customerId) return { added: [], ambiguous: [], skipped: '점검 건을 찾을 수 없습니다.' }

  const { data: blds } = await admin.from('buildings')
    .select('id').eq('customer_id', customerId).eq('is_active', true)
  const bldIds = ((blds ?? []) as Array<{ id: string }>).map(b => b.id)
  // 🚨 대장은 **건물 축**, 점검은 **고객 축**이라 다동에서는 어느 동에 쓸지 정할 수 없다(§9-7 미결정 1).
  //   고객 1:건물 1로 고정된 뒤(§10 `cf139d0`) 정상 경로는 항상 1동이다. 0동·다동은 **쓰지 않고 알린다** —
  //   조용히 넘어가면 "자동 반영이 왜 안 됐지"를 영영 못 푼다.
  if (bldIds.length === 0) return { added: [], ambiguous: [], skipped: '활성 건물이 없어 대장에 반영할 수 없습니다.' }
  if (bldIds.length > 1) return { added: [], ambiguous: [], skipped: `활성 건물이 ${bldIds.length}동이라 어느 동의 대장인지 정할 수 없습니다.` }
  const buildingId = bldIds[0]

  const [{ data: respRaw }, { data: facRaw }, items, sheets] = await Promise.all([
    admin.from('inspection_sheet_responses').select('item_code, result').eq('inspection_id', inspectionId),
    admin.from('fire_facilities').select('facility_code, installed, detail').eq('building_id', buildingId),
    getAllSheetItems(),
    getSheets(),
  ])
  const responses = (respRaw ?? []) as Array<{ item_code: string; result: string }>
  if (responses.length === 0) return { added: [], ambiguous: [] }

  const facRows = (facRaw ?? []) as Array<{ facility_code: string; installed: boolean; detail: Record<string, unknown> | null }>
  const installedCodes = facRows.filter(f => f.installed).map(f => f.facility_code)

  // 구성은 `foldSheetGroupStats` 한 곳으로 — 별지 조립·1.4 배지와 **같은 통계**여야 한다
  // (수기 구성이 o 축을 빠뜨려 「전부 ／인 시트가 ○로 인쇄」된 전례, 26 S1).
  // 카탈로그 항목은 `sheet_id`만 들고 있다 — 시트 **이름**이 롤업의 축이라 한 번 이어 준다
  const nameById = new Map(sheets.map(s => [s.id, s.sheet_name]))
  const sheetByItem = new Map(items.map(i => [i.item_code, nameById.get(i.sheet_id) ?? '']))
  const groupByItem = new Map(items.map(i => [i.item_code, sheetItemGroupRef(i).code]))
  const entries = foldSheetGroupStats(responses.map(r => ({
    sheet: sheetByItem.get(r.item_code) ?? '',
    group: groupByItem.get(r.item_code) ?? null,
    result: r.result,
  })))

  const plan = planFacilityAutoCheck({ entries, form3Items: FORM3_ITEMS, installedCodes })
  // 읽기 전용 호출은 여기서 끝 — **아무것도 쓰지 않는다**(화면이 갈래를 계속 띄우기 위한 경로)
  if (!opts.write) return { added: [], ambiguous: plan.ambiguous }
  // `only`가 오면 사람이 고른 그 하나만 — 자동 확정분은 건드리지 않는다
  const targets = opts.only ?? plan.confirmed
  if (targets.length === 0) return { added: [], ambiguous: plan.ambiguous }

  // 행 단위로만 손댄다. 기존 행이 있으면 `installed`만 올리고 **`detail.note`(사람이 쓴 비고)는 보존**한다.
  const byCode = new Map(facRows.map(f => [f.facility_code, f]))
  const stamp = { auto: todayKst() }
  const added: string[] = []
  for (const code of targets) {
    const prev = byCode.get(code)
    // ③ 이미 설치면 쓰지 않는다 — 판정 함수가 이미 걸렀지만, 경합으로 그 사이 켜졌을 수 있다
    if (prev?.installed) continue
    const detail = { ...(prev?.detail ?? {}), ...stamp }
    const { error } = prev
      ? await admin.from('fire_facilities').update({ installed: true, detail } as Record<string, unknown>)
        .eq('building_id', buildingId).eq('facility_code', code)
      : await admin.from('fire_facilities').insert({
        building_id: buildingId, facility_code: code, installed: true, detail,
      } as Record<string, unknown>)
    if (!error) added.push(code)
  }
  // ⚠ `facilities_verified_at`은 여기서 **절대** 건드리지 않는다(§9-4). 위 주석의 이유가 전부다.
  return { added, ambiguous: plan.ambiguous }
}
