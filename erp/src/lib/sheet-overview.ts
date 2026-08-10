import 'server-only'

import type { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/types'
import { sheetScope, isItemInScope, type SheetScope } from '@/lib/sheet-scope'
import { sheetMatchesFacilities } from '@/lib/sheet-facility-map'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

/** 점검표 진행률 집계 — 회차별 작성·조회 트리의 설비별 요약 행과 점검 상세 배지의 공용 소스.
 *
 *  기존에는 item_code 접두 문자열 파싱(page.tsx의 응답→버킷, inspection-sheet-client의 시트→버킷)이
 *  두 파일에서 각자 재구현돼 있었고, 시드 코드 규약에 우연히 맞아떨어져 동작했다. 그 방식으로는
 *  분모(시트 항목 수)·O/X/N 집계·comprehensive_only 범위를 구할 수 없고 MU 시트 다수를 한 버킷으로 뭉갠다.
 *  여기서는 inspection_sheet_items.sheet_id 조인으로 대체한다.
 *
 *  쿼리는 점검 N건·시트 M개와 무관하게 고정 6회 — 이후 전부 in-memory 집계(N+1 없음). */

export type SheetResult = 'O' | 'X' | 'N'

export type SheetProgress = {
  sheetId: string
  sheetCode: string
  sheetName: string
  /** 분모 = 이 시트에서 이 점검이 채워야 할 항목 수 (item_code 중복 제거) */
  total: number
  /** 분자 = 그중 응답이 있는 항목 수 */
  responded: number
  counts: { O: number; X: number; N: number }
  /** 이 고객에 설치된 설비와 매칭되는 시트인지 — 정렬·[설치 설비만 보기] 필터용 */
  installed: boolean
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

  // ② 시트 카탈로그 — 등장하는 버전만 1회
  const { data: sheetRaw, error: sheetErr } = await admin.from('inspection_sheets')
    .select('id, sheet_code, sheet_name, version').in('version', versions).order('sheet_code')
  if (sheetErr) return { overviews: {}, error: `점검표 조회 실패: ${sheetErr.message}` }
  const sheets = (sheetRaw ?? []) as Array<{ id: string; sheet_code: string; sheet_name: string; version: string }>

  // ③ 항목 카탈로그 — 1000행을 넘으므로 페이징 필수 (fetch-all.ts)
  const { rows: items, error: itemErr } = await fetchAllRows<{ sheet_id: string; item_code: string; comprehensive_only: boolean }>(
    (from, to) => admin.from('inspection_sheet_items')
      .select('sheet_id, item_code, comprehensive_only').in('sheet_id', sheets.map(s => s.id)).range(from, to))
  if (itemErr) return { overviews: {}, error: `항목 조회 실패: ${itemErr}` }
  const itemsBySheet = new Map<string, Array<{ item_code: string; comprehensive_only: boolean }>>()
  for (const it of items) {
    const arr = itemsBySheet.get(it.sheet_id)
    if (arr) arr.push(it)
    else itemsBySheet.set(it.sheet_id, [it])
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

  // ── in-memory 집계 ──
  const overviews: Record<string, SheetOverview> = {}
  for (const insp of insps) {
    const scope = scopeById.get(insp.id)!
    const responses = respByInsp.get(insp.id) ?? new Map<string, SheetResult>()
    const facilityCodes = facByCustomer.get(insp.customer_id) ?? []

    const progress: SheetProgress[] = []
    const seenCodes = new Set<string>()   // 회차 합계용 — 시트 간 중복 코드 이중 계상 방지
    let tTotal = 0, tResponded = 0, tX = 0

    for (const sheet of sheets) {
      if (sheet.version !== scope.version) continue
      // 분모는 item_code Set 크기 — 시드에 같은 코드가 2행 있어도 1건 (bulkAllGoodAction의 중복 방어와 동일 이유)
      const codes = new Set<string>()
      for (const it of itemsBySheet.get(sheet.id) ?? []) {
        if (isItemInScope(it, scope)) codes.add(it.item_code)
      }
      if (codes.size === 0) continue

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
        total: codes.size, responded, counts,
        installed: sheetMatchesFacilities(sheet.sheet_name, facilityCodes),
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
    }
  }

  return { overviews }
}
