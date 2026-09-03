import 'server-only'

import type { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/types'
import { sheetScope, isItemInScope, sheetItemGroupRef, type SheetScope } from '@/lib/sheet-scope'
import { sheetMatchesFacilities } from '@/lib/sheet-facility-map'
import { FIRE_SUB_ITEMS } from '@/lib/facility-codes'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { isMultiUseApplicable } from '@/lib/multi-use'
import { getAllSheetItems, getSheets, type SheetCatalogItem, type SheetRow } from '@/lib/sheet-catalog'

/** 점검표 진행률 집계 — 회차별 작성·조회 트리의 설비별 요약 행과 점검 상세 배지의 공용 소스.
 *
 *  기존에는 item_code 접두 문자열 파싱(page.tsx의 응답→버킷, inspection-sheet-client의 시트→버킷)이
 *  두 파일에서 각자 재구현돼 있었고, 시드 코드 규약에 우연히 맞아떨어져 동작했다. 그 방식으로는
 *  분모(시트 항목 수)·O/X/N 집계·comprehensive_only 범위를 구할 수 없고 MU 시트 다수를 한 버킷으로 뭉갠다.
 *  여기서는 inspection_sheet_items.sheet_id 조인으로 대체한다.
 *
 *  쿼리는 점검 N건·시트 M개와 무관하게 고정 6회 — 이후 전부 in-memory 집계(N+1 없음). */

export type SheetResult = 'O' | 'X' | 'N'

/** 중분류(머더) 진행률 — 보드 카드 1장의 데이터 (소방계획서_23 S5-5).
 *  responded는 N(해당없음)을 포함한다 — '이 머더는 다 봤다'의 표현(Q-19·S7-21). */
export type SheetGroupProgress = {
  /** `${sheetId}:${groupCode}` — 시트 간 코드 중복(EXT/MU 구분란 재사용) 방어 */
  groupKey: string
  groupCode: string
  /** 134 미적용 폴백에서는 groupCode와 같을 수 있다 — 카드가 name === code로 병기 생략 */
  groupName: string
  groupOrder: number
  total: number
  responded: number
  x: number
  /** ○(양호) 응답 수 — 롤업 3축(any/x/o)의 o. 2026-09-01 신설.
   *  ⚠ 없으면 '응답은 있는데 전부 ／'를 표현할 수 없어 **해당없음이 양호로 둔갑**한다(소방계획서_26 S1과 같은 함정). */
  o: number
  /** 대괄호 소제목(3층) 이름들 — 카드 부제 칩. 등장 순서 유지 */
  subgroupNames: string[]
}

export type SheetProgress = {
  sheetId: string
  sheetCode: string
  sheetName: string
  /** 분모 = 이 시트에서 이 점검이 채워야 할 항목 수 (item_code 중복 제거) */
  total: number
  /** 분자 = 그중 응답이 있는 항목 수 */
  responded: number
  counts: { O: number; X: number; N: number }
  /** ●(comprehensive_only) 무응답 수 — 종합 회차 필수 입력 축(소방계획서_39 S1).
   *  작동 회차는 isItemInScope가 ●를 분모에서 이미 걸러 **자동 0**(별도 분기 없음).
   *  법: 고시 별지4호 각주 「●는 종합점검의 경우에만 해당」 — ○/×/／ 중 하나 필수, 빈칸 금지. */
  compBlank: number
  /** 이 고객에 설치된 설비와 매칭되는 시트인지 — 정렬·[설치 설비만 보기] 필터용 */
  installed: boolean
  /** 머더 버킷 — withGroups=true(점검 상세)에서만 채워진다. 트리(최대 8회차)는 payload 비대화 방지로 생략 */
  groups?: SheetGroupProgress[]
}

export type SheetOverview = {
  inspectionId: string
  scope: SheetScope
  /** 이 점검 건을 편집할 수 있는 사람인지 (점검 건 축 — 담당자·팀장·관리자) */
  canEdit: boolean
  viewerId: string
  /** 회차 합계 — 시트 간 중복 코드를 제거한 값 (시트별 total의 단순 합이 아니다) */
  totals: { total: number; responded: number; x: number }
  sheets: SheetProgress[]
  /** 설치 시설 정보가 하나도 없는 고객 — 호출부가 [설치 설비만 보기] 필터를 자동 해제하는 신호 */
  noFacilityInfo: boolean
  /** 대장 하위(FIRE_SUB_ITEMS) 중 설치로 등록된 코드 — Q-22 ② 대장 힌트 배너용.
   *  하위 행이 0건이면 빈 배열 → 배너 침묵(P-15). 이미 조회한 facilityCodes에서 거르므로 왕복 추가 0회 */
  ledgerSubCodes: string[]
  /** 대장에 설치(installed=true)로 등록된 코드 전체 — 형제 설비 고지(facilitiesForSheet)의 인자.
   *  withFacilityAxis=true에서만 채워진다(트리 8회차 payload 비대화 방지). */
  installedFacilityCodes?: string[]
  /** 설치인데 이 회차 범위의 **어느 시트도 덮지 않는** 설비 — 별지 결과칸이 영구 공란으로 남는 자리다.
   *  화면이 이걸 말해주지 않으면 사용자는 '왜 비었나'를 알 길이 없다(2026-08-24 물분무 사고의 이웃 사례).
   *  하위 항목(FIRE_SUB_ITEMS)은 제외 — 애초에 전용 시트가 없는 게 정상이라 섞으면 잡음이 된다. */
  uncoveredFacilityCodes?: string[]
}

type Admin = ReturnType<typeof createAdminClient>

/** 점검 건 축 편집 권한 — inspections/[id]/page.tsx의 canEdit과 같은 규칙 (담당자 본인 또는 팀장·관리자).
 *  역할 축(can(role,'inspection_register'))과는 별개이며, 화면은 두 축을 AND로 게이트한다. */
export function canEditInspection(assignedEmployeeId: string | null, viewer: { id: string; role: UserRole }): boolean {
  return assignedEmployeeId === viewer.id || viewer.role === 'manager' || viewer.role === 'admin'
}

export async function buildSheetOverviews(
  admin: Admin,
  inspectionIds: string[],
  viewer: { id: string; role: UserRole },
  opts: { withGroups?: boolean; withFacilityAxis?: boolean } = {},
): Promise<{ overviews: Record<string, SheetOverview>; error?: string }> {
  const ids = [...new Set(inspectionIds.filter(Boolean))]
  if (ids.length === 0) return { overviews: {} }

  // ① 점검 건 — 판정 축(plan_type·관리유형) + 편집 권한 축(담당자)
  const { data: inspRaw, error: inspErr } = await admin.from('inspections')
    .select('id, customer_id, plan_type, assigned_employee_id, customer:customers(inspection_type)')
    .in('id', ids)
  if (inspErr) return { overviews: {}, error: `점검 조회 실패: ${inspErr.message}` }
  const insps = (inspRaw ?? []) as unknown as Array<{
    id: string; customer_id: string; plan_type: string | null
    assigned_employee_id: string | null; customer: { inspection_type: string } | null
  }>
  if (insps.length === 0) return { overviews: {} }

  const scopeById = new Map(insps.map(i => [i.id, sheetScope(i.plan_type, i.customer?.inspection_type ?? null)]))
  const versions = [...new Set([...scopeById.values()].map(s => s.version))]
  const customerIds = [...new Set(insps.map(i => i.customer_id))]

  // ②③ 시트·항목 카탈로그 — 마스터 데이터라 캐시에서 읽는다(sheet-catalog.ts, 2026-08-20).
  // 종전에는 매 호출마다 시트 1회 + 항목 전건 페이징(860행이라 2왕복)을 다시 읽었다.
  // 42703 폴백·정렬도 캐시 안으로 옮겼다. 캐시 함수는 throw하므로 여기서 종전 error 계약으로 되돌린다.
  let sheets: SheetRow[]
  let allItems: SheetCatalogItem[]
  try {
    [sheets, allItems] = await Promise.all([getSheets(), getAllSheetItems()])
  } catch (e) {
    return { overviews: {}, error: e instanceof Error ? e.message : String(e) }
  }
  const versionSet = new Set<string>(versions)
  sheets = sheets.filter(s => versionSet.has(s.version))

  type CatalogItem = SheetCatalogItem
  const sheetIds = new Set(sheets.map(s => s.id))
  const items = allItems.filter(i => sheetIds.has(i.sheet_id))
  const itemsBySheet = new Map<string, CatalogItem[]>()
  for (const it of items) {
    const arr = itemsBySheet.get(it.sheet_id)
    if (arr) arr.push(it)
    else itemsBySheet.set(it.sheet_id, [it])
  }
  // 그룹 집계는 정렬 순서에 의존한다(연속 run). 캐시가 이미 4축(group_order→subgroup_order→
  // order_num→code)으로 정렬해 두지만, 여기서 한 번 더 고정해도 결과는 같다 — 종전 단언을 남긴다.
  if (opts.withGroups) {
    for (const arr of itemsBySheet.values()) {
      arr.sort((a, b) =>
        (a.group_order ?? Number.MAX_SAFE_INTEGER) - (b.group_order ?? Number.MAX_SAFE_INTEGER)
        || (a.subgroup_order ?? -1) - (b.subgroup_order ?? -1)
        || a.item_code.localeCompare(b.item_code))
    }
  }

  // ④ 응답 — 전 점검 1회 (회차당 수백 행이라 페이징 필수)
  const { rows: resps, error: respErr } = await fetchAllRows<{ inspection_id: string; item_code: string; result: SheetResult }>(
    (from, to) => admin.from('inspection_sheet_responses')
      .select('inspection_id, item_code, result').in('inspection_id', ids).range(from, to))
  if (respErr) return { overviews: {}, error: `응답 조회 실패: ${respErr}` }
  const respByInsp = new Map<string, Map<string, SheetResult>>()
  for (const r of resps) {
    let m = respByInsp.get(r.inspection_id)
    if (!m) { m = new Map(); respByInsp.set(r.inspection_id, m) }
    m.set(r.item_code, r.result)
  }

  // ⑤⑥ 설치 시설 — 고객 → 건물 → 시설
  const { data: bldRaw } = await admin.from('buildings')
    .select('id, customer_id').in('customer_id', customerIds).eq('is_active', true)
  const blds = (bldRaw ?? []) as Array<{ id: string; customer_id: string }>
  const customerByBld = new Map(blds.map(b => [b.id, b.customer_id]))
  const { data: facRaw } = blds.length > 0
    ? await admin.from('fire_facilities').select('building_id, facility_code')
        .in('building_id', blds.map(b => b.id)).eq('installed', true)
    : { data: [] }
  const facByCustomer = new Map<string, string[]>()
  for (const f of (facRaw ?? []) as Array<{ building_id: string; facility_code: string }>) {
    const cid = customerByBld.get(f.building_id)
    if (!cid) continue
    const arr = facByCustomer.get(cid)
    if (arr) arr.push(f.facility_code)
    else facByCustomer.set(cid, [f.facility_code])
  }

  // ⑦ 다중이용업소 판별 (S7-27 — 22 Q-10·S14-4/5 위임) — 인쇄 조립·번들 공란 리포트와 같은 축
  //   (서식 1.10.3 sections.multiUse 업종 ≥1, bundle-actions.ts:94-96과 동일식).
  //   STD-32는 SHEET_FACILITY_MAP 미등재라 installed 축에 안 잡힌다 — multiUse면 노출 예외.
  const { data: formRaw } = await admin.from('fire_plan_forms')
    .select('customer_id, sections').in('customer_id', customerIds)
  const multiUseByCustomer = new Map<string, boolean>()
  for (const row of (formRaw ?? []) as Array<{ customer_id: string; sections: Record<string, unknown> | null }>) {
    const mu = (row.sections?.['multiUse'] ?? null) as { applicable?: boolean; categories?: Record<string, string> } | null
    // 해당 여부 판정은 lib/multi-use 한 곳 — 여기는 거기에 '업종 개소 ≥1'을 더 요구하는 축이다
    if (mu && isMultiUseApplicable(mu) && Object.values(mu.categories ?? {}).some(c => String(c ?? '').trim()))
      multiUseByCustomer.set(row.customer_id, true)
  }

  // ── in-memory 집계 ──
  const overviews: Record<string, SheetOverview> = {}
  for (const insp of insps) {
    const scope = scopeById.get(insp.id)!
    const responses = respByInsp.get(insp.id) ?? new Map<string, SheetResult>()
    const facilityCodes = facByCustomer.get(insp.customer_id) ?? []
    const multiUse = multiUseByCustomer.get(insp.customer_id) ?? false

    const progress: SheetProgress[] = []
    const seenCodes = new Set<string>()   // 회차 합계용 — 시트 간 중복 코드 이중 계상 방지
    let tTotal = 0, tResponded = 0, tX = 0

    for (const sheet of sheets) {
      if (sheet.version !== scope.version) continue
      // 분모는 item_code Set 크기 — 시드에 같은 코드가 2행 있어도 1건 (bulkAllGoodAction의 중복 방어와 동일 이유)
      const codes = new Set<string>()
      // 머더 버킷(23 S5-6) — isItemInScope가 이미 적용된 자리라 작동점검 종합전용(●) 제외가 분모에도 자동 반영
      const buckets = opts.withGroups ? new Map<string, SheetGroupProgress>() : null
      // ● 무응답(39 S1) — in-scope로 살아남은 comprehensive_only 중 응답 없는 것. 시트 단위 카운트
      // (회차 합계 dedup 축과 다르다 — 요구 축이 '설치된 설비 **시트**'라 시트마다 따로 센다)
      let compBlank = 0
      for (const it of itemsBySheet.get(sheet.id) ?? []) {
        if (!isItemInScope(it, scope) || codes.has(it.item_code)) continue
        codes.add(it.item_code)
        if (it.comprehensive_only && !responses.get(it.item_code)) compBlank++
        if (buckets) {
          const ref = sheetItemGroupRef(it)
          let b = buckets.get(ref.code)
          if (!b) {
            b = {
              groupKey: `${sheet.id}:${ref.code}`, groupCode: ref.code, groupName: ref.name,
              // 134 미적용 폴백은 order가 없다 — 등장 순서(정렬 후)로 대체
              groupOrder: ref.order ?? buckets.size + 1,
              total: 0, responded: 0, x: 0, o: 0, subgroupNames: [],
            }
            buckets.set(ref.code, b)
          }
          b.total++
          const r = responses.get(it.item_code)
          if (r) { b.responded++; if (r === 'X') b.x++; if (r === 'O') b.o++ }   // N 포함 — Q-19('다 봤다' 표현)
          if (ref.subgroup && !b.subgroupNames.includes(ref.subgroup)) b.subgroupNames.push(ref.subgroup)
        }
      }
      if (codes.size === 0) continue
      // S7-27 — 다중이용 입력 단일화: multiUse 고객은 STD-32(안전시설등 세부)로만 입력하고
      // MU-01(16칸 직접 입력)은 숨긴다. 별지4호 2쪽 16칸은 STD-32 롤업이 파생(22 S14).
      // 레거시로 MU 직접 응답이 이미 있는 건은 보존 — 숨기면 기존 입력이 유령이 된다.
      if (multiUse && sheet.sheet_code === 'MU-01' && ![...codes].some(c => responses.has(c))) continue

      const counts = { O: 0, X: 0, N: 0 }
      let responded = 0
      for (const code of codes) {
        const r = responses.get(code)
        if (r) { responded++; counts[r]++ }
        // 회차 합계는 코드 단위 dedup (한 코드가 두 시트에 있어도 1건)
        if (!seenCodes.has(code)) {
          seenCodes.add(code)
          tTotal++
          if (r) { tResponded++; if (r === 'X') tX++ }
        }
      }

      progress.push({
        sheetId: sheet.id, sheetCode: sheet.sheet_code, sheetName: sheet.sheet_name,
        total: codes.size, responded, counts, compBlank,
        // S7-27 노출 예외 — STD-32는 설비 맵 미등재라 multiUse 판별로 installed 취급(필터·정렬 동일 취급)
        installed: sheetMatchesFacilities(sheet.sheet_name, facilityCodes)
          || (sheet.sheet_code === 'STD-32' && multiUse),
        groups: buckets
          ? [...buckets.values()].sort((a, b) => (a.groupOrder - b.groupOrder) || a.groupCode.localeCompare(b.groupCode))
          : undefined,
      })
    }

    // 설치 설비 → 입력 진행 → 코드 순 (미입력 설비를 위로 올리지 않는다 — 목록 순서가 흔들리면 찾기 어렵다)
    progress.sort((a, b) =>
      Number(b.installed) - Number(a.installed)
      || Number(b.responded > 0) - Number(a.responded > 0)
      || a.sheetCode.localeCompare(b.sheetCode))

    overviews[insp.id] = {
      inspectionId: insp.id,
      scope,
      canEdit: canEditInspection(insp.assigned_employee_id, viewer),
      viewerId: viewer.id,
      totals: { total: tTotal, responded: tResponded, x: tX },
      sheets: progress,
      noFacilityInfo: facilityCodes.length === 0,
      ledgerSubCodes: facilityCodes.filter(c => FIRE_SUB_ITEMS.includes(c)),
      // 설비 축 — 이미 메모리에 있는 facilityCodes와 progress로만 만든다(추가 조회 0회).
      // 판정은 시트 노출 필터와 **같은 함수**(sheetMatchesFacilities)를 써야 한다. 여기서 따로 세면
      // '목록엔 있는데 덮는 시트가 없다고 나오는' 모순이 생긴다.
      ...(opts.withFacilityAxis ? {
        installedFacilityCodes: facilityCodes,
        uncoveredFacilityCodes: facilityCodes.filter(c =>
          !FIRE_SUB_ITEMS.includes(c) && !progress.some(p => sheetMatchesFacilities(p.sheetName, [c]))),
      } : {}),
    }
  }

  return { overviews }
}

/** 3층 완료 보류(소방계획서_39 S3)의 판정 축 — 이 점검의 **설치 매칭 시트**에 남은
 *  범위 내 무응답 항목 수(§0: 작동·종합 공통). `comp`는 그중 ●(종합 필수) 수 — 고지 병기용.
 *
 *  buildSheetOverviews의 per-sheet total/responded/compBlank·installed와 **같은 판정식**을 써야
 *  한다(sheetMatchesFacilities + isItemInScope + STD-32 multiUse 예외) — 축이 갈라지면 화면
 *  카운터는 N>0인데 완료는 통과하는 모순이 생긴다. 전량 빌드(6쿼리·전 시트 그룹 집계)를 피해
 *  단건 경량 경로로 다시 세는 것뿐, 판정 재료는 동일하다.
 *
 *  호출부(inspection-step-sync)가 **완료 전환이 임박했을 때만** 부른다 — 매 저장마다 돌지 않는다.
 *  자체점검이 아닌 회차(정기 등)는 시트 축 자체가 없다 — 호출부가 isSpecial로 게이트한다. */
export async function countInstalledRequiredBlanks(
  admin: Admin, inspectionId: string,
): Promise<{ required: number; comp: number }> {
  const NONE = { required: 0, comp: 0 }
  const { data: inspRaw } = await admin.from('inspections')
    .select('id, customer_id, plan_type, customer:customers(inspection_type)')
    .eq('id', inspectionId).maybeSingle()
  const insp = inspRaw as unknown as {
    id: string; customer_id: string; plan_type: string | null
    customer: { inspection_type: string } | null
  } | null
  if (!insp) return NONE
  const scope = sheetScope(insp.plan_type, insp.customer?.inspection_type ?? null)
  if (!scope.isSpecial) return NONE   // 자체점검 회차만 점검표 축이 있다

  let sheets: SheetRow[]
  let allItems: SheetCatalogItem[]
  try {
    [sheets, allItems] = await Promise.all([getSheets(), getAllSheetItems()])
  } catch {
    // 카탈로그 실패로 완료를 영구 보류시키지 않는다 — 보수적으로 0(통과). 카탈로그 장애는
    // 다른 화면이 먼저 붉어지는 축이라 여기서 이중 경보하지 않는다.
    return NONE
  }
  sheets = sheets.filter(s => s.version === scope.version)

  const [{ rows: resps }, { data: bldRaw }, { data: formRaw }] = await Promise.all([
    fetchAllRows<{ item_code: string }>(
      (from, to) => admin.from('inspection_sheet_responses')
        .select('item_code').eq('inspection_id', inspectionId).range(from, to)),
    admin.from('buildings').select('id').eq('customer_id', insp.customer_id).eq('is_active', true),
    admin.from('fire_plan_forms').select('sections').eq('customer_id', insp.customer_id).limit(1).maybeSingle(),
  ])
  const responded = new Set(resps.map(r => r.item_code))
  const bldIds = ((bldRaw ?? []) as Array<{ id: string }>).map(b => b.id)
  const { data: facRaw } = bldIds.length > 0
    ? await admin.from('fire_facilities').select('facility_code')
        .in('building_id', bldIds).eq('installed', true)
    : { data: [] }
  const facilityCodes = ((facRaw ?? []) as Array<{ facility_code: string }>).map(f => f.facility_code)
  const mu = (((formRaw as { sections: Record<string, unknown> | null } | null)?.sections)?.['multiUse'] ?? null) as
    { applicable?: boolean; categories?: Record<string, string> } | null
  const multiUse = !!mu && isMultiUseApplicable(mu) && Object.values(mu.categories ?? {}).some(c => String(c ?? '').trim())

  const itemsBySheet = new Map<string, SheetCatalogItem[]>()
  for (const it of allItems) {
    const arr = itemsBySheet.get(it.sheet_id)
    if (arr) arr.push(it)
    else itemsBySheet.set(it.sheet_id, [it])
  }
  let required = 0, comp = 0
  for (const sheet of sheets) {
    const installed = sheetMatchesFacilities(sheet.sheet_name, facilityCodes)
      || (sheet.sheet_code === 'STD-32' && multiUse)
    if (!installed) continue
    const codes = new Set<string>()
    for (const it of itemsBySheet.get(sheet.id) ?? []) {
      if (!isItemInScope(it, scope) || codes.has(it.item_code)) continue
      codes.add(it.item_code)
      if (!responded.has(it.item_code)) {
        required++
        if (it.comprehensive_only) comp++
      }
    }
  }
  return { required, comp }
}
