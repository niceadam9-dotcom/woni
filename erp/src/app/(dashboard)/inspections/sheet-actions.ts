'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { sheetMatchesFacilities } from '@/lib/sheet-facility-map'
import { sheetScope, isItemInScope, sheetItemGroup } from '@/lib/sheet-scope'
import { syncInspectionSteps } from '@/lib/inspection-step-sync'
import { syncStepsAndRevalidate } from './step-revalidate'
import { CURRENT_SHEET_PROTOCOL } from '@/lib/annex-regen-policy'
import { buildSheetOverviews, canEditInspection, type SheetOverview } from '@/lib/sheet-overview'
import { getAllSheetItems, getSheetItems, getSheets } from '@/lib/sheet-catalog'
import type { UserRole } from '@/types'

/** 점검 건의 시트 범위 판정에 필요한 축 조회 — plan_type 우선, 관리유형은 레거시 폴백용 (sheet-scope.ts) */
async function loadScope(admin: ReturnType<typeof createAdminClient>, inspectionId: string) {
  const { data } = await admin.from('inspections')
    .select('customer_id, plan_type, assigned_employee_id, customer:customers(inspection_type)')
    .eq('id', inspectionId).maybeSingle()
  if (!data) return null
  const row = data as unknown as {
    customer_id: string; plan_type: string | null
    assigned_employee_id: string | null; customer: { inspection_type: string } | null
  }
  return {
    customerId: row.customer_id,
    assignedEmployeeId: row.assigned_employee_id,
    scope: sheetScope(row.plan_type, row.customer?.inspection_type ?? null),
  }
}

/** S9-1(2026-08-21) — 첫 점검표 입력이 규약을 확정한다. 규약 미상(NULL, 149 도입 전 생성) 회차에
 *  이 파일의 쓰기 액션이 손을 대는 순간 현재 규약을 스탬프한다 — 규약은 점검 실시일이 아니라
 *  **입력 행위**의 속성이라는 원칙. WHERE ... IS NULL이라 확정된 값(legacy_na 포함)은 절대 안 덮는다.
 *  ⚠ syncInspectionSteps 안에 넣지 않는 이유: 그 함수는 파일 업로드·발송 경로에서도 돌아서,
 *  점검표에 손대지 않은 회차까지 스탬프하게 된다. */
async function stampSheetProtocol(admin: ReturnType<typeof createAdminClient>, inspectionId: string) {
  await admin.from('inspections').update({ sheet_protocol: CURRENT_SHEET_PROTOCOL })
    .eq('id', inspectionId).is('sheet_protocol', null)
}

/** 회차별 작성·조회 트리의 설비별 요약 행 — 회차(들)의 시트별 진행률 일괄 조회.
 *  집계는 sheet-overview.ts 단일 소스(점검 상세 배지와 같은 값). 남용 방지로 한 번에 8회차까지.
 *
 *  `withGroups`는 기본 false다(트리 8회차 payload 비대화 방지 — 23 S5-7). 켜는 곳은 1.4 대장의
 *  설비별 결과 배지 하나뿐인데, 그 배지는 중분류 단위 롤업이 있어야 문서와 같은 마크가 나온다
 *  (2026-09-01 유도등 사고 — 시트 단위로 접으면 형제 설비 칸까지 같은 마크가 칠해진다). */
export async function getInspectionSheetOverviewAction(inspectionIds: string[], opts?: { withGroups?: boolean }): Promise<{
  error?: string
  overviews?: Record<string, SheetOverview>
}> {
  const profile = await requirePermission('inspection_register')
  if (inspectionIds.length === 0) return { overviews: {} }
  if (inspectionIds.length > 8) return { error: '한 번에 조회할 수 있는 회차는 8건까지입니다.' }
  const { overviews, error } = await buildSheetOverviews(
    createAdminClient(), inspectionIds, { id: profile.id, role: profile.role as UserRole },
    { withGroups: opts?.withGroups ?? false })
  if (error) return { error }
  return { overviews }
}

// 시트 항목 카탈로그(3층 축 + 42703 폴백 + 4축 정렬)는 lib/sheet-catalog.ts로 옮겼다(2026-08-20).
// 종전 loadSheetCatalog는 **시트를 열 때마다** DB를 다시 읽었다 — 이제 캐시에서 메모리 필터다.
// ⚠ 캐시 로더는 조회 실패 시 throw한다(종전은 빈 배열을 조용히 돌려줬다). 항목 0개로 보이는
//    가짜 성공보다 낫다 — 폴백까지 실패하는 상황은 DB 자체가 죽은 때뿐이다.

/** 시트 스냅샷 1왕복 (소방계획서_23 S6-2 — Q-5 시트 전체 로드) — 항목(범위 필터 서버 적용) + 응답 + 편집 권한.
 *  현행 open()의 2왕복(항목 로드 → 외관 월별 응답)을 1회로 접는다. month는 외관(X%) 항목의 연간 축(EX-4). */
export async function loadSheetSnapshotAction(inspectionId: string, sheetId: string, month = 0): Promise<{
  error?: string
  items?: Array<{
    item_code: string; item_name: string; comprehensive_only: boolean; group: string
    group_code?: string | null; group_name?: string | null; subgroup_name?: string | null
    /** 작동 회차의 종합 전용(●) — 표시만 하고 입력·집계에서 제외, 문서엔 ／ 자동 (2026-09-02) */
    outOfScope?: boolean
  }>
  responses?: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }>
  canEdit?: boolean
}> {
  const profile = await requirePermission('inspection_register')
  if (!Number.isInteger(month) || month < 0 || month > 12) return { error: '점검 월 값을 확인해주세요.' }
  const admin = createAdminClient()

  const [insp, catalog] = await Promise.all([
    loadScope(admin, inspectionId),
    getSheetItems(sheetId),
  ])
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }

  // 범위 밖(작동 회차의 종합 전용 ●) 항목도 **보이되 입력 불가**로 싣는다 (2026-09-02 사용자 확정
  // — "ERP 화면에서도 반영"). 문서에는 ／로 자동 인쇄되므로 화면도 같은 사실을 보여야 한다.
  // 입력·집계 축은 outOfScope=false만 쓴다(호출부 분모·／일괄·저장 가드가 같은 축).
  const items = catalog
    .map(i => ({
      item_code: i.item_code, item_name: i.item_name, comprehensive_only: i.comprehensive_only,
      group: sheetItemGroup(i.item_code, i.facility_type, i.group_name),
      group_code: i.group_code, group_name: i.group_name, subgroup_name: i.subgroup_name,
      outOfScope: !isItemInScope(i, insp.scope),
    }))

  const responses: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }> = {}
  if (items.length > 0) {
    const { data: respRaw } = await admin.from('inspection_sheet_responses')
      .select('item_code, result, memo, month')
      .eq('inspection_id', inspectionId).in('item_code', items.map(i => i.item_code))
    for (const r of (respRaw ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo: string | null; month: number | null }>) {
      // 외관(X…)만 월 축 — 저장 규칙(saveSheetResponsesAction)과 같은 판정이어야 다른 달 값이 새지 않는다
      const want = r.item_code.startsWith('X') ? month : 0
      if ((r.month ?? 0) === want) responses[r.item_code] = { result: r.result, memo: r.memo }
    }
  }
  const canEdit = canEditInspection(insp.assignedEmployeeId, { id: profile.id, role: profile.role as UserRole })
  return { items, responses, canEdit }
}

/** 시트(대분류) 단위 ／ 일괄 (소방계획서_23 Q-20 = S6-6) — bulkAllGoodAction 패턴 미러.
 *  apply = 그 시트의 **공란 항목에만** N 기록(Q-21 — 기존 ○/✕/N 절대 무변경)
 *  release = 그 시트의 N만 삭제(O/X 보존) — 토글 해제 경로.
 *  범위 필터(작동=종합전용 ● 제외)를 동일 적용해 범위 밖 항목에 N을 만들지 않는다. */
export async function bulkSheetNAAction(
  inspectionId: string, sheetId: string, month = 0, mode: 'apply' | 'release' = 'apply',
): Promise<{ error?: string; applied?: number; released?: number; total?: number }> {
  const profile = await requirePermission('inspection_register')
  if (!Number.isInteger(month) || month < 0 || month > 12) return { error: '점검 월 값을 확인해주세요.' }
  const admin = createAdminClient()

  const [insp, catalog] = await Promise.all([
    loadScope(admin, inspectionId),
    getSheetItems(sheetId),
  ])
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }

  const seen = new Set<string>()
  const codes = catalog
    .filter(i => isItemInScope(i, insp.scope))
    .filter(i => !seen.has(i.item_code) && (seen.add(i.item_code), true))
    .map(i => i.item_code)
  if (codes.length === 0) return { error: '이 시트에 입력 대상 항목이 없습니다.' }
  const monthOf = (code: string) => (code.startsWith('X') ? month : 0)

  if (mode === 'release') {
    const { data: nRows } = await admin.from('inspection_sheet_responses')
      .select('item_code, month').eq('inspection_id', inspectionId).eq('result', 'N').in('item_code', codes)
    const target = ((nRows ?? []) as Array<{ item_code: string; month: number | null }>)
      .filter(r => (r.month ?? 0) === monthOf(r.item_code))
    if (target.length > 0) {
      // 저장과 같은 월 축으로 지운다 — 외관은 그 달의 N만, 일반은 month=0만
      const std = target.filter(r => !r.item_code.startsWith('X')).map(r => r.item_code)
      const extC = target.filter(r => r.item_code.startsWith('X')).map(r => r.item_code)
      if (std.length > 0) {
        const { error } = await admin.from('inspection_sheet_responses').delete()
          .eq('inspection_id', inspectionId).eq('result', 'N').eq('month', 0).in('item_code', std)
        if (error) return { error: `해제 실패: ${error.message}` }
      }
      if (extC.length > 0) {
        const { error } = await admin.from('inspection_sheet_responses').delete()
          .eq('inspection_id', inspectionId).eq('result', 'N').eq('month', month).in('item_code', extC)
        if (error) return { error: `해제 실패: ${error.message}` }
      }
    }
    await stampSheetProtocol(admin, inspectionId)   // ／ 해제도 입력 행위다 (S9-1)
    await syncInspectionSteps(admin, inspectionId, profile.id)
    revalidatePath(`/inspections/${inspectionId}`)
    revalidatePath('/inspections')
    return { released: target.length, total: codes.length }
  }

  // apply — 이미 응답이 있는 항목(그 달 축)은 건드리지 않는다 (bulkAllGoodAction과 동일 판정)
  const { data: resp } = await admin.from('inspection_sheet_responses')
    .select('item_code, month').eq('inspection_id', inspectionId).in('item_code', codes)
  const have = new Set(((resp ?? []) as Array<{ item_code: string; month: number | null }>)
    .map(r => `${r.item_code}@${r.month ?? 0}`))
  const payload = codes
    .filter(c => !have.has(`${c}@${monthOf(c)}`))
    .map(c => ({
      inspection_id: inspectionId, item_code: c, result: 'N', month: monthOf(c),
      updated_by: profile.id, updated_at: new Date().toISOString(),
    }))
  if (payload.length > 0) {
    const { error } = await admin.from('inspection_sheet_responses').insert(payload as Record<string, unknown>[])
    if (error) return { error: `일괄 저장 실패: ${error.message}` }
  }
  await stampSheetProtocol(admin, inspectionId)   // 첫 입력이 규약을 확정한다 (S9-1)
  await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return { applied: payload.length, total: codes.length }
}

/** 시트(대분류) 단위 ○ 일괄 (소방계획서_26 S3) — bulkSheetNAAction apply 분기의 거울.
 *  그 시트의 **공란 항목에만** O 기록 — 기존 ○/✕/／ 절대 무변경(bulkAllGood·bulkSheetNA와 같은 규약).
 *  release 모드는 없다: ○ 일괄 해제는 요구 밖이고, 잘못 눌렀으면 항목 단위로 고치는 것이 맞다.
 *  1.4 설비별 결과 입력 패널이 쓴다 — 호출부는 반드시 개수·형제 설비를 고지하는 확인창을 거친다. */
export async function bulkSheetGoodAction(
  inspectionId: string, sheetId: string, month = 0,
): Promise<{ error?: string; applied?: number; kept?: number; total?: number }> {
  const profile = await requirePermission('inspection_register')
  if (!Number.isInteger(month) || month < 0 || month > 12) return { error: '점검 월 값을 확인해주세요.' }
  const admin = createAdminClient()

  const [insp, catalog] = await Promise.all([
    loadScope(admin, inspectionId),
    getSheetItems(sheetId),
  ])
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }

  const seen = new Set<string>()
  const codes = catalog
    .filter(i => isItemInScope(i, insp.scope))
    .filter(i => !seen.has(i.item_code) && (seen.add(i.item_code), true))
    .map(i => i.item_code)
  if (codes.length === 0) return { error: '이 시트에 입력 대상 항목이 없습니다.' }
  const monthOf = (code: string) => (code.startsWith('X') ? month : 0)

  const { data: resp } = await admin.from('inspection_sheet_responses')
    .select('item_code, month').eq('inspection_id', inspectionId).in('item_code', codes)
  const have = new Set(((resp ?? []) as Array<{ item_code: string; month: number | null }>)
    .map(r => `${r.item_code}@${r.month ?? 0}`))
  const payload = codes
    .filter(c => !have.has(`${c}@${monthOf(c)}`))
    .map(c => ({
      inspection_id: inspectionId, item_code: c, result: 'O', month: monthOf(c),
      updated_by: profile.id, updated_at: new Date().toISOString(),
    }))
  if (payload.length > 0) {
    const { error } = await admin.from('inspection_sheet_responses').insert(payload as Record<string, unknown>[])
    if (error) return { error: `일괄 저장 실패: ${error.message}` }
  }
  await stampSheetProtocol(admin, inspectionId)   // 첫 입력이 규약을 확정한다 (S9-1)
  await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return { applied: payload.length, kept: codes.length - payload.length, total: codes.length }
}

/** 트리 인라인 확장 — 한 시트의 항목 + 현재 응답을 지연 로드.
 *  loadSheetItemsAction과 달리 이 점검 건의 범위(작동=종합전용 제외)를 서버에서 적용해 내려준다. */
export async function loadSheetEditorAction(inspectionId: string, sheetId: string): Promise<{
  error?: string
  items?: Array<{ item_code: string; item_name: string; comprehensive_only: boolean; group: string }>
  responses?: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }>
  canEdit?: boolean
}> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const [insp, catalog] = await Promise.all([
    loadScope(admin, inspectionId),
    getSheetItems(sheetId),
  ])
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }

  // group_name(134)이 있으면 헤더가 '2-H' → '2-H. 제어반'으로 자동 개선된다(23 Q-9 — 트리는 배선 무변경)
  const items = catalog
    .filter(i => isItemInScope(i, insp.scope))
    .map(i => ({
      item_code: i.item_code, item_name: i.item_name, comprehensive_only: i.comprehensive_only,
      group: sheetItemGroup(i.item_code, i.facility_type, i.group_name),
    }))

  const responses: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }> = {}
  if (items.length > 0) {
    const { data: respRaw } = await admin.from('inspection_sheet_responses')
      .select('item_code, result, memo').eq('inspection_id', inspectionId).in('item_code', items.map(i => i.item_code))
    for (const r of (respRaw ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo: string | null }>) {
      responses[r.item_code] = { result: r.result, memo: r.memo }
    }
  }
  const canEdit = canEditInspection(insp.assignedEmployeeId, { id: profile.id, role: profile.role as UserRole })
  return { items, responses, canEdit }
}

/** 선택한 설비 점검표의 표준 항목 로드 (P34-2, 지연 로드) — 3층 축 필드 동반(23 S6-1, group은 하위호환) */
export async function loadSheetItemsAction(sheetId: string): Promise<{
  items: Array<{
    item_code: string; item_name: string; comprehensive_only: boolean; group: string
    group_code?: string | null; group_name?: string | null; subgroup_name?: string | null
  }>
}> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const catalog = await getSheetItems(sheetId)
  const items = catalog.map(i => ({
    item_code: i.item_code, item_name: i.item_name, comprehensive_only: i.comprehensive_only,
    group: sheetItemGroup(i.item_code, i.facility_type, i.group_name),
    group_code: i.group_code, group_name: i.group_name, subgroup_name: i.subgroup_name,
  }))
  return { items }
}

/** EX-4(소방계획서_19, 125): 외관점검표 특정 월의 응답만 로드 — 연간 누적본 입력용.
 *  month=0이면 '월 무관'(레거시 저장분)을 돌려준다. 화면은 월을 바꿀 때마다 이 값으로 다시 초기화한다. */
export async function loadExteriorMonthResponsesAction(
  inspectionId: string, month: number,
): Promise<{ responses: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }>; error?: string }> {
  await requirePermission('inspection_register')
  if (!Number.isInteger(month) || month < 0 || month > 12) return { responses: {}, error: '점검 월 값을 확인해주세요.' }
  const admin = createAdminClient()
  const { data, error } = await admin.from('inspection_sheet_responses')
    .select('item_code, result, memo')
    .eq('inspection_id', inspectionId).eq('month', month).like('item_code', 'X%')
  if (error) return { responses: {}, error: `조회 실패: ${error.message}` }
  const responses: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }> = {}
  for (const r of (data ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo: string | null }>) {
    responses[r.item_code] = { result: r.result, memo: r.memo }
  }
  return { responses }
}

/** 점검표 응답 저장 (P34-2) — 해당 항목들 upsert
 *  EX-4(소방계획서_19, 125): month는 **외관점검표(X% 항목)의 연간 누적 축**이다.
 *  0 = 월 무관(일반 점검표 전부, 기본값) / 1~12 = 그 달의 외관점검 실적.
 *  월을 넘기지 않으면 종전과 완전히 동일하게 동작한다. */
export async function saveSheetResponsesAction(
  inspectionId: string,
  rows: Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo?: string | null }>,
  month = 0,
  /** 해당없음(기본)으로 되돌릴 항목 — 종전 O/X 행을 **지운다**.
   *  2026-08-13 기본값이 ／(해당없음)이 되면서 필요해졌다. upsert만으로는 해제가 반영되지 않아
   *  화면에서는 풀렸는데 DB에는 O가 남는다(문서에도 그대로 인쇄된다). */
  clearCodes: string[] = [],
): Promise<{ error?: string; stepsChanged?: boolean }> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()
  if (!Number.isInteger(month) || month < 0 || month > 12) return { error: '점검 월 값을 확인해주세요.' }

  // 범위 가드(2026-09-02) — 작동 회차의 종합 전용(●) 항목은 저장을 거른다. 화면은 비활성이지만
  // 'use server' 액션은 공개 엔드포인트라 서버에서도 같은 축으로 막아야 한다(문서엔 ／ 자동).
  {
    const insp = await loadScope(admin, inspectionId)
    if (insp?.scope.isOperational && rows.length > 0) {
      const comp = new Set((await getAllSheetItems()).filter(i => i.comprehensive_only).map(i => i.item_code))
      rows = rows.filter(r => !comp.has(r.item_code))
    }
  }

  // 저장속도 개선(2026-08-15) — 실측: 저장 1회 완전 종료 5.8초. 지배 요인은 DB가 아니라
  // revalidatePath가 액션 응답에 실어 보내는 상세 페이지 RSC 재렌더(+클라이언트의 중복 refresh)였다.
  // ① 삭제 2종·upsert는 서로소 집합이라 병렬 ② revalidate는 단계 상태가 실제로 바뀐 저장에만.
  // 화면 신선도는 드로어 로컬 상태 + 보드 오버레이(23 S7-24)가 이미 책임진다 — 페이지 서버 props의
  // 응답 사본은 재방문·Realtime(원격 변경)에서 갱신되므로 이 세션에서 낡아도 소비처가 없다.
  const rowCodes = new Set(rows.map(r => r.item_code))
  const clears = clearCodes.filter(c => !rowCodes.has(c))   // 겹치면 값 저장(rows)이 이긴다 — 병렬 안전 보장
  // 외관(X…)만 월 축을 쓴다 — 저장과 같은 규칙으로 지워야 엉뚱한 달이 남지 않는다
  const clrExt = clears.filter(c => c.startsWith('X'))
  const clrStd = clears.filter(c => !c.startsWith('X'))
  const payload = rows.map(r => ({
    inspection_id: inspectionId, item_code: r.item_code, result: r.result,
    // 외관 항목만 월 축을 쓴다 — 일반 점검표에 월이 섞이면 유니크가 갈라져 중복 응답이 생긴다
    month: r.item_code.startsWith('X') ? month : 0,
    memo: r.memo?.trim() || null, updated_by: profile.id, updated_at: new Date().toISOString(),
  }))

  const ops: Array<{ label: string; run: PromiseLike<{ error: { message: string } | null }> }> = []
  if (clrStd.length > 0) ops.push({
    label: '해제 반영', run: admin.from('inspection_sheet_responses').delete()
      .eq('inspection_id', inspectionId).eq('month', 0).in('item_code', clrStd),
  })
  if (clrExt.length > 0) ops.push({
    label: '해제 반영', run: admin.from('inspection_sheet_responses').delete()
      .eq('inspection_id', inspectionId).eq('month', month).in('item_code', clrExt),
  })
  if (payload.length > 0) ops.push({
    label: '저장', run: admin.from('inspection_sheet_responses')
      .upsert(payload as Record<string, unknown>[], { onConflict: 'inspection_id,item_code,month' }),
  })
  if (ops.length === 0) return {}
  const results = await Promise.all(ops.map(o => o.run))
  const bad = results.findIndex(r => r.error)
  if (bad >= 0) return { error: `${ops[bad].label} 실패: ${results[bad].error!.message}` }

  // R4-6: ① 점검표 응답이 곧 근거 — 저장 즉시 단계가 스스로 완료된다(버튼 불필요).
  // 해제만 있어도 근거가 줄었으므로 동기화는 항상 돈다.
  await stampSheetProtocol(admin, inspectionId)   // 첫 입력이 규약을 확정한다 (S9-1)
  // 36 S2-2 — 가드째로 헬퍼에 위임. alsoChanged 생략 = 단계가 바뀐 저장에만 무효화(종전과 동일).
  // 이 경로만 가드를 쓸 수 있는 이유는 위 :319-320 주석이 밝힌 전제 때문이다(소비처가 없다).
  const { stepsChanged } = await syncStepsAndRevalidate(admin, inspectionId, profile.id)
  return { stepsChanged }
}

/** §9-4 A안: 설치 설비 전체 양호 — 설치 시설(fire_facilities)과 매칭되는 시트의 '미입력' 항목만 ○로 일괄 채움.
 *  기존 응답(O/X/N)은 절대 덮어쓰지 않는다 — 불량 먼저 태깅 후 눌러도, 누른 뒤 태깅해도 안전. */
export async function bulkAllGoodAction(inspectionId: string, month = 0): Promise<{
  error?: string; filled?: number; sheetCount?: number; kept?: number
}> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const insp = await loadScope(admin, inspectionId)
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }
  const { scope } = insp

  // 설치 시설 코드 → 시트 매칭 (명시 매핑 — sheet-facility-map.ts, 실전 검증에서 퍼지 매칭 결함 확인)
  const { data: blds } = await admin.from('buildings').select('id')
    .eq('customer_id', insp.customerId).eq('is_active', true)
  const bldIds = ((blds ?? []) as Array<{ id: string }>).map(b => b.id)
  const { data: facs } = bldIds.length > 0
    ? await admin.from('fire_facilities').select('facility_code').in('building_id', bldIds).eq('installed', true)
    : { data: [] }
  const codes = ((facs ?? []) as Array<{ facility_code: string }>).map(f => f.facility_code)
  if (codes.length === 0) return { error: '설치 시설 정보가 없습니다 — 소방계획서 탭 > 1.4 소방시설에서 설치 시설을 먼저 등록해주세요.' }

  const sheets = (await getSheets(scope.version))
    .filter(s => sheetMatchesFacilities(s.sheet_name, codes))
  if (sheets.length === 0) return { error: '설치 시설과 매칭되는 점검표 시트가 없습니다.' }

  // 카탈로그는 캐시에서(sheet-catalog.ts) — 종전엔 [전체 양호]를 누를 때마다 전건 페이징을 다시 읽었다
  const sheetIds = new Set(sheets.map(s => s.id))
  const items = (await getAllSheetItems())
    .filter(i => sheetIds.has(i.sheet_id) && isItemInScope(i, scope))

  // EX-4(125): 외관 항목은 **그 달에 이미 입력했는지**로 판정해야 한다 — 월을 접어 보면
  // 3월에 채운 항목이 7월엔 영영 안 채워진다(독립 검증 지적). 일반 점검표는 종전대로 month=0 한 축.
  const { data: resp } = await admin.from('inspection_sheet_responses')
    .select('item_code, month').eq('inspection_id', inspectionId)
  const respRows = (resp ?? []) as Array<{ item_code: string; month: number }>
  const monthOf = (code: string) => (code.startsWith('X') ? month : 0)
  const have = new Set(respRows.map(r => `${r.item_code}@${r.month}`))
  const filled = (code: string) => have.has(`${code}@${monthOf(code)}`)
  const seen = new Set<string>() // 시드 중복 방어 — 같은 코드 2행이면 1건만
  const payload = items.filter(i => !filled(i.item_code) && !seen.has(i.item_code) && (seen.add(i.item_code), true)).map(i => ({
    inspection_id: inspectionId, item_code: i.item_code, result: 'O',
    month: monthOf(i.item_code),
    updated_by: profile.id, updated_at: new Date().toISOString(),
  }))
  if (payload.length > 0) {
    const { error } = await admin.from('inspection_sheet_responses').insert(payload as Record<string, unknown>[])
    if (error) return { error: `일괄 저장 실패: ${error.message}` }
  }
  await stampSheetProtocol(admin, inspectionId)                // 첫 입력이 규약을 확정한다 (S9-1)
  await syncInspectionSteps(admin, inspectionId, profile.id)   // R4-6: ①
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return { filled: payload.length, sheetCount: sheets.length, kept: items.filter(i => filled(i.item_code)).length }
}

/** 지난 회차 결과 불러오기 (소방계획서_20 S4-9).
 *
 *  ⚠ 이 기능은 실제 점검을 대체하지 않는다. 자체점검 결과를 확인 없이 베끼면 허위 기재가 된다.
 *  그래서 설계상 안전장치를 서버에도 건다(S4-10):
 *   ① 미입력 항목에만 채운다 — 이번 회차에 이미 입력한 값은 절대 덮어쓰지 않는다(bulkAllGood와 같은 규약).
 *   ② X(불량)를 복사해도 불량내역 자동 등록은 하지 않는다 — 현장 확인 후 사용자가 직접 등록해야 한다.
 *   ③ 실행을 activity_logs에 남긴다(무엇을 몇 건 복사했는지).
 *   ④ 호출부는 확인 다이얼로그로 ①②를 고지하고, 복사 후 검토를 유도한다.
 *
 *  출처는 같은 고객의 직전 완료 회차 1건이다(연도·차수 desc). */
export async function copyPreviousRoundResponsesAction(inspectionId: string): Promise<{
  error?: string; filled?: number; skipped?: number; sourceLabel?: string; copiedX?: number
}> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const insp = await loadScope(admin, inspectionId)
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }

  // 직전 완료 회차 — 같은 고객, 이 건보다 앞선 회차 중 가장 최근
  const { data: cur } = await admin.from('inspections')
    .select('year, sequence_num').eq('id', inspectionId).maybeSingle()
  if (!cur) return { error: '점검 건을 찾을 수 없습니다.' }
  const c = cur as { year: number; sequence_num: number }

  const { data: prevRaw } = await admin.from('inspections')
    .select('id, year, sequence_num')
    .eq('customer_id', insp.customerId).eq('status', 'completed').neq('id', inspectionId)
    .order('year', { ascending: false }).order('sequence_num', { ascending: false })
    .limit(24)
  const prev = ((prevRaw ?? []) as Array<{ id: string; year: number; sequence_num: number }>)
    .find(p => p.year < c.year || (p.year === c.year && p.sequence_num < c.sequence_num))
  if (!prev) return { error: '불러올 지난 완료 회차가 없습니다.' }

  const [{ data: srcRaw }, { data: haveRaw }] = await Promise.all([
    admin.from('inspection_sheet_responses')
      .select('item_code, result, memo, month').eq('inspection_id', prev.id),
    admin.from('inspection_sheet_responses')
      .select('item_code').eq('inspection_id', inspectionId),
  ])
  const src = (srcRaw ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo: string | null; month: number | null }>
  if (src.length === 0) return { error: `${prev.year}년 ${prev.sequence_num}차에 저장된 점검표 응답이 없습니다.` }
  const have = new Set(((haveRaw ?? []) as Array<{ item_code: string }>).map(r => r.item_code))

  // ① 미입력 항목만 — 이번 회차 입력값 보존
  const seen = new Set<string>()
  const target = src.filter(r => !have.has(r.item_code) && !seen.has(r.item_code) && (seen.add(r.item_code), true))
  const payload = target.map(r => ({
    inspection_id: inspectionId, item_code: r.item_code, result: r.result,
    month: r.month ?? 0, memo: r.memo,
    updated_by: profile.id, updated_at: new Date().toISOString(),
  }))
  if (payload.length > 0) {
    const { error } = await admin.from('inspection_sheet_responses').insert(payload as Record<string, unknown>[])
    if (error) return { error: `불러오기 실패: ${error.message}` }
  }

  // ③ 감사 — 되돌리기가 없는 대량 입력이라 무엇을 베꼈는지 남긴다. ② 불량내역 자동 등록은 하지 않는다.
  const copiedX = target.filter(r => r.result === 'X').length
  await admin.from('activity_logs').insert({
    action: 'sheet_copy_previous', entity_type: 'inspection', entity_id: inspectionId, actor_id: profile.id,
    metadata: {
      source_inspection_id: prev.id, source_label: `${prev.year}년 ${prev.sequence_num}차`,
      filled: payload.length, skipped: src.length - target.length, copied_x: copiedX,
    },
  } as Record<string, unknown>)

  // R4-6(독립 검증 D4): 응답을 대량으로 넣는 경로인데 동기화가 빠져 있었다 —
  // ①이 완료로 올라가는 시점이 다음 상세 진입까지 미뤄졌다(R4-7이 늦게 맞추는 지연 정합)
  if (payload.length > 0) {
    await stampSheetProtocol(admin, inspectionId)   // 복사도 입력 행위다 — 사용자 검토 전제 (S9-1)
    await syncInspectionSteps(admin, inspectionId, profile.id)
  }

  revalidatePath(`/inspections/${inspectionId}`)
  return {
    filled: payload.length, skipped: src.length - target.length, copiedX,
    sourceLabel: `${prev.year}년 ${prev.sequence_num}차`,
  }
}

/** §9-4 A안: 불량 빠른 태깅용 항목 검색 — 코드·명칭 부분 일치, 점검 유형에 맞는 버전 시트만 (최대 20건) */
export async function searchQuickItemsAction(inspectionId: string, q: string): Promise<{
  error?: string
  items?: Array<{ item_code: string; item_name: string; sheet_name: string; current: 'O' | 'X' | 'N' | null }>
}> {
  await requirePermission('inspection_register')
  const query = q.trim()
  if (query.length < 2) return { items: [] }
  const admin = createAdminClient()

  const insp = await loadScope(admin, inspectionId)
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }
  const { scope } = insp

  const sheetName = new Map((await getSheets(scope.version)).map(s => [s.id, s.sheet_name]))

  // 캐시 위 메모리 검색 — 종전엔 300ms 디바운스마다 ilike 쿼리가 DB로 나갔다(sheet-catalog.ts).
  // 종전은 DB에서 20건을 먼저 자른 뒤 범위(scope) 필터를 걸어, 범위 밖 항목이 섞이면 결과가
  // 20건보다 적게 나왔다. 이제 범위 필터를 **먼저** 걸고 20건을 자른다 — 검색이 덜 잘린다.
  const needle = query.toLowerCase()
  const items = (await getAllSheetItems())
    .filter(i => sheetName.has(i.sheet_id) && isItemInScope(i, scope)
      && (i.item_name.toLowerCase().includes(needle) || i.item_code.toLowerCase().includes(needle)))
    .sort((a, b) => a.item_code.localeCompare(b.item_code))
    .slice(0, 20)

  const { data: resp } = items.length > 0
    ? await admin.from('inspection_sheet_responses').select('item_code, result')
        .eq('inspection_id', inspectionId).in('item_code', items.map(i => i.item_code))
    : { data: [] }
  const cur = new Map(((resp ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N' }>).map(r => [r.item_code, r.result]))

  return {
    items: items.map(i => ({
      item_code: i.item_code, item_name: i.item_name,
      sheet_name: sheetName.get(i.sheet_id) ?? '', current: cur.get(i.item_code) ?? null,
    })),
  }
}

/** X(불량) 응답 → 불량내역 자동 등록 (P34-3) — defect_catalog 표준 문구, 중복 코드 제외 */
export async function createDefectsFromXAction(
  inspectionId: string
): Promise<{ error?: string; added?: number }> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const { data: xs } = await admin.from('inspection_sheet_responses')
    .select('item_code, memo').eq('inspection_id', inspectionId).eq('result', 'X')
  const xRows = (xs ?? []) as Array<{ item_code: string; memo: string | null }>
  if (xRows.length === 0) return { added: 0 }

  const codes = xRows.map(r => r.item_code)
  const [{ data: cat }, { data: existing }, allItems] = await Promise.all([
    admin.from('defect_catalog').select('code, equipment, description').in('code', codes),
    admin.from('inspection_defects').select('defect_code').eq('inspection_id', inspectionId),
    getAllSheetItems(),
  ])
  const catMap = new Map(((cat ?? []) as Array<{ code: string; equipment: string; description: string }>).map(c => [c.code, c]))
  const have = new Set(((existing ?? []) as Array<{ defect_code: string | null }>).map(e => e.defect_code).filter(Boolean))
  // 폴백 사슬(2026-09-02): 카탈로그 문구 → **점검표 항목명** → 코드. 종전엔 카탈로그에 없는 코드가
  // 이름=코드로 등록돼 별지 8쪽·갑지 현5의 「불량내용」에 점검번호가 두 번 찍혔다(서림사 실사고).
  const itemName = new Map(allItems.map(i => [i.item_code, i.item_name]))

  const toInsert = xRows.filter(r => !have.has(r.item_code)).map(r => {
    const c = catMap.get(r.item_code)
    return {
      inspection_id: inspectionId,
      defect_code: r.item_code,
      defect_name: c?.description ?? itemName.get(r.item_code) ?? r.item_code,
      defect_detail: r.memo ?? null,
      severity: '보통',
    }
  })
  if (toInsert.length === 0) return { added: 0 }
  const { error } = await admin.from('inspection_defects').insert(toInsert as Record<string, unknown>[])
  if (error) return { error: `불량 등록 실패: ${error.message}` }
  // R4-6: ⑤ 불량이 생기면 분모가 6으로 늘고 ⑤가 미완료로 열린다
  await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return { added: toInsert.length }
}

/** S9-1(2026-08-21) — 규약 미상(NULL) 회차를 관리자가 '신규약으로 입력된 회차'로 확정한다.
 *
 *  미상 + 응답 있음은 재생성이 차단되는데(isRegenBlocked — 구규약 입력이면 재생성이 표기를
 *  바꾸므로), 실제로 신규약 하에 입력됐음을 **아는 사람**이 해제하는 통로다. 자동 추정(응답
 *  updated_at 등)을 쓰지 않는 이유: 사실 확인은 사람 몫이고, 추정이 틀리면 법정 문서 표기가
 *  바뀐다. 확정은 activity_logs에 남는다 — 누가 언제 무엇을 근거로 열었는지 추적 가능해야 한다.
 *  legacy_na로 이미 확정된 건은 건드리지 않는다(WHERE IS NULL). */
export async function confirmSheetProtocolAction(inspectionId: string): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  if (profile.role !== 'admin') return { error: '관리자만 확정할 수 있습니다.' }
  const admin = createAdminClient()
  const { data, error } = await admin.from('inspections')
    .update({ sheet_protocol: CURRENT_SHEET_PROTOCOL })
    .eq('id', inspectionId).is('sheet_protocol', null)
    .select('id')
  if (error) return { error: `확정 실패: ${error.message}` }
  if (!data || data.length === 0) return { error: '이미 규약이 확정된 회차입니다 — 새로고침해주세요.' }
  await admin.from('activity_logs').insert({
    user_id: profile.id, action: 'SHEET_PROTOCOL_CONFIRM', entity_type: 'inspection', entity_id: inspectionId,
    details: { to: CURRENT_SHEET_PROTOCOL, reason: '관리자 확정 — 신규약 입력 회차로 판단(재생성 차단 해제)' },
  } as Record<string, unknown>)
  revalidatePath(`/inspections/${inspectionId}`)
  return {}
}
