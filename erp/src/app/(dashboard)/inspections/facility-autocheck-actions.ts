'use server'

/** 점검표 → 1.4 대장 **따라잡기** 쓰기 액션 — 소방계획서_49 §9 (2026-09-11)
 *
 *  판정은 `lib/facility-autocheck`의 순수 함수가 한다. 여기는 **그 답을 DB에 옮기기만** 한다.
 *
 *  🚨 `saveFacilitiesAction`을 절대 재사용하지 않는다. 이유가 둘이고 둘 다 치명적이다:
 *   ① 그 액션은 `facilities_verified_at`을 **함께 찍는다**(`facilities-actions.ts:61`).
 *      그 값은 「**사람이** 설비 현황을 확인했다」는 뜻이고, 1.4 미확인 경고가 그걸로 판정한다.
 *      시스템이 자동으로 찍으면 경고가 스스로 꺼져 **관문이 조용히 죽는다**(§9-4).
 *   ② 그 액션은 `delete → insert` **replace 방식**이라(`:42`·`:45`), 한 행을 켜려고 부르면
 *      그 건물의 설비·비고가 통째로 지워졌다 다시 들어간다(K-5의 소실 리스크를 그대로 탄다).
 *  → 그래서 **행 단위 upsert 전용 좁은 액션**이다. `installed`만 쓰고 확인일은 건드리지 않는다.
 *
 *  ⚠ 권한은 `inspection_register`다(§9-7 미결정 3 = 허용). 점검표 입력자가 대장을 바꾸는 셈이지만,
 *    이건 **시스템 행위**이고 `detail.auto`로 출처가 남아 되돌릴 수 있다(§9-5).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { foldSheetGroupStats } from '@/lib/sheet-facility-map'
import { sheetItemGroupRef } from '@/lib/sheet-scope'
import { getAllSheetItems, getSheets } from '@/lib/sheet-catalog'
import { planFacilityAutoCheck, type AutoCheckResult } from '@/lib/facility-autocheck'
import { FORM3_ITEMS } from '@/lib/doc-templates/report9'

/* 🚨 이 파일은 `'use server'`다 — **타입을 포함해 async 함수 외의 것을 내보내지 않는다.**
   타입 재수출이 런타임에 값으로 방출돼 화면이 500으로 죽은 전례가 있다(2026-09-10).
   `AutoCheckResult`는 `lib/facility-autocheck`에 둔다. */

/** 점검표 응답을 근거로 1.4 대장을 따라잡는다. 저장 액션이 호출한다(§9-7 미결정 2 = 저장 시 즉시).
 *
 *  ⚠ 실패해도 **점검표 저장을 깨뜨리지 않는다** — 호출부가 best-effort로 감싼다.
 *    대장 따라잡기가 안 됐다고 사용자의 점검 입력이 날아가면 안 된다. */
export async function autoCheckFacilitiesFromSheetAction(
  inspectionId: string,
): Promise<AutoCheckResult> {
  await requirePermission('inspection_register')
  return runAutoCheck(inspectionId, { write: true })
}

/** 지금 상태만 읽는다 — **아무것도 쓰지 않는다**. 화면이 「어느 것입니까?」를 계속 띄우기 위해서다.
 *
 *  🚨 모호한 갈래는 저장 응답에만 실어 보내면 **새로고침 한 번에 사라진다**. 그러면 사용자는
 *  「스프링클러인지 화재조기진압용인지 못 정했다」는 사실조차 모른 채 [확인했습니다]를 눌러
 *  **빈 대장을 확인 처리**하게 된다 — 이 축에 남아 있던 마지막 구멍이었다.
 *  판정은 쓰기 경로와 **같은 함수**를 탄다(사본 금지 — 보이는 것과 켜지는 것이 갈리면 안 된다). */
export async function getFacilityAutoCheckStateAction(
  inspectionId: string,
): Promise<AutoCheckResult> {
  await requirePermission('inspection_register')
  return runAutoCheck(inspectionId, { write: false })
}

/** 사람이 고른 한 설비를 대장에 켠다 — 「어느 것입니까?」의 답.
 *
 *  ⚠ **후보 목록 안에 있는 코드만** 받는다. `'use server'`는 공개 엔드포인트라 인자를 믿지 않는다 —
 *    아무 코드나 켤 수 있으면 이 화면이 대장 전체를 쓰는 창구가 된다.
 *  ⚠ 여기서도 `facilities_verified_at`은 건드리지 않는다(§9-4). 고르는 것은 설치 사실이고,
 *    「대장 전체를 확인했다」는 별개의 행위다. */
export async function resolveAmbiguousFacilityAction(
  inspectionId: string, facilityCode: string,
): Promise<{ error?: string; added?: string }> {
  await requirePermission('inspection_register')
  const state = await runAutoCheck(inspectionId, { write: false })
  const allowed = new Set(state.ambiguous.flatMap(a => a.candidates))
  if (!allowed.has(facilityCode)) return { error: '지금 고를 수 있는 설비가 아닙니다.' }
  const done = await runAutoCheck(inspectionId, { write: true, only: [facilityCode] })
  if (done.skipped) return { error: done.skipped }
  return { added: done.added[0] }
}

/** 읽기·쓰기 공용 — 판정은 한 번만 정의한다(보이는 것과 켜지는 것이 갈리면 안 된다) */
async function runAutoCheck(
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
  const stamp = { auto: new Date().toISOString().slice(0, 10) }
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
