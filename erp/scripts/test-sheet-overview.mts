// 점검표 진행률 집계 엔진 검증 (소방계획서_16 S2) — buildSheetOverviews를 직접 호출해
// 독립 재계산(다른 코드 경로로 구한 기대값)과 대조한다. UI 없이 분모·집계 정확도를 고정하는 목적.
// 실행: npx tsx --conditions=react-server scripts/test-sheet-overview.mts   (스테이징 DB)
//   ※ --conditions=react-server 없으면 'server-only' 패키지가 import 단계에서 예외를 던진다.
// @ts-expect-error mjs 헬퍼
import { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer } from './_e2e-helpers.mjs'
const { buildSheetOverviews } = await import('../src/lib/sheet-overview.ts')

const EMAIL = 'sheet-overview-e2e@erp-test.com'
let userId = ''
let otherId = ''
let custId = ''
let inspId = ''
let compInspId = ''

try {
  userId = await mkUser({ email: EMAIL, name: '집계E2E', employeeId: 'E2E-OV' })
  otherId = await mkUser({ email: 'sheet-overview-other@erp-test.com', name: '비담당E2E', employeeId: 'E2E-OV2', role: 'employee' })
  // 일반관리 + special_작동 = 축 판정이 걸리는 조합 (S1 K-1과 같은 케이스)
  custId = await mkCustomer({ customer_name: '집계E2E고객', created_by: userId, inspection_type: '일반관리' })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: custId, building_name: '집계동', is_active: true, created_by: userId }).select('id').single()
  await raw.from('fire_facilities').insert([
    { building_id: bld!.id, facility_code: '소화기구 및 자동소화장치', category: '소화설비', installed: true },
  ])
  const { data: insp } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', plan_type: 'special_작동', sequence_num: 1,
    inspection_start_date: '2026-08-10', status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = insp!.id

  // ── 독립 재계산: STD-01 시트의 작동 범위 항목 코드 집합 ──
  const { data: s1 } = await raw.from('inspection_sheets')
    .select('id, sheet_name').eq('version', 'v2025').eq('sheet_code', 'STD-01').single()
  const { data: s1items } = await raw.from('inspection_sheet_items')
    .select('item_code, comprehensive_only').eq('sheet_id', s1!.id)
  const s1Codes = [...new Set(((s1items ?? []) as Array<{ item_code: string; comprehensive_only: boolean }>)
    .filter(i => !i.comprehensive_only).map(i => i.item_code))].sort()
  check('셋업: STD-01 작동 범위 항목 존재', s1Codes.length >= 4, `${s1Codes.length}개`)

  // 응답 4건 주입 (O 3 · X 1)
  const picked = s1Codes.slice(0, 4)
  await raw.from('inspection_sheet_responses').insert(picked.map((c, i) => ({
    inspection_id: inspId, item_code: c, result: i === 3 ? 'X' : 'O', updated_by: userId,
  })))

  // ── 엔진 호출 ──
  const { overviews, error } = await buildSheetOverviews(
    raw as never, [inspId], { id: userId, role: 'admin' })
  check('엔진 오류 없음', !error, error ?? '')
  const ov = overviews[inspId]
  check('회차 overview 반환', !!ov)

  // 1) 범위 판정 — 일반관리 관리유형이어도 plan_type=special_작동이면 v2025·작동
  check('scope = v2025 작동', ov.scope.version === 'v2025' && ov.scope.isOperational === true,
    JSON.stringify(ov.scope))

  // 2) 시트별 분모·분자·집계
  const p1 = ov.sheets.find(s => s.sheetCode === 'STD-01')
  check('STD-01 행 존재', !!p1)
  check('STD-01 분모 = 작동 범위 코드 Set 크기', p1!.total === s1Codes.length, `engine=${p1?.total} expect=${s1Codes.length}`)
  check('STD-01 분자 = 주입한 4건', p1!.responded === 4, `engine=${p1?.responded}`)
  check('STD-01 O/X 집계', p1!.counts.O === 3 && p1!.counts.X === 1 && p1!.counts.N === 0, JSON.stringify(p1?.counts))
  check('STD-01 installed=true (설치 시설 매칭)', p1!.installed === true)

  // 3) 종합전용(●) 항목은 작동 범위 분모에서 제외 — 종합점검과 분모가 달라야 필터가 실제로 도는 것
  const allCodes = new Set(((s1items ?? []) as Array<{ item_code: string }>).map(i => i.item_code))
  const hasCompOnly = allCodes.size > s1Codes.length
  check('셋업: STD-01에 종합전용 항목 존재(차등 검증 전제)', hasCompOnly, `all=${allCodes.size} op=${s1Codes.length}`)
  check('작동 분모 < 전체 항목 수', p1!.total < allCodes.size, `total=${p1?.total} all=${allCodes.size}`)

  // 3b) 같은 고객·같은 시트라도 종합점검이면 분모가 전체가 된다 (범위 필터 차등 확인)
  const { data: inspComp } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '종합', plan_type: 'special_종합', sequence_num: 2,
    inspection_start_date: '2026-08-11', status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  compInspId = inspComp!.id
  const { overviews: ovC } = await buildSheetOverviews(raw as never, [compInspId], { id: userId, role: 'admin' })
  const pc = ovC[compInspId].sheets.find((s: { sheetCode: string }) => s.sheetCode === 'STD-01')
  check('종합점검 분모 = 전체 항목 수', pc.total === allCodes.size, `comp=${pc?.total} all=${allCodes.size}`)
  check('작동/종합 분모가 서로 다름', pc.total !== p1!.total, `comp=${pc?.total} op=${p1?.total}`)

  // 4) 미설치 시트는 installed=false, 응답 0
  const other = ov.sheets.find(s => s.sheetCode !== 'STD-01' && s.sheetCode.startsWith('STD-'))
  check('미설치 시트 installed=false·미입력', !!other && other.installed === false && other.responded === 0,
    JSON.stringify(other && { c: other.sheetCode, i: other.installed, r: other.responded }))

  // 5) 정렬 — 설치 설비가 맨 앞
  check('정렬: 설치 설비 우선', ov.sheets[0].installed === true, ov.sheets[0].sheetCode)

  // 6) 회차 합계 — 코드 dedup 기준. 시트별 total 단순합보다 작거나 같아야 한다
  const sumOfSheets = ov.sheets.reduce((a, s) => a + s.total, 0)
  check('totals.total ≤ 시트별 합 (코드 dedup)', ov.totals.total <= sumOfSheets,
    `totals=${ov.totals.total} sum=${sumOfSheets}`)
  check('totals 분자·불량 = 주입값', ov.totals.responded === 4 && ov.totals.x === 1, JSON.stringify(ov.totals))

  // 7) v2022(EXT) 시트가 섞이지 않았는지 — 축 위반 감지
  check('EXT 시트 미포함', !ov.sheets.some(s => s.sheetCode.startsWith('EXT-')),
    JSON.stringify(ov.sheets.filter(s => s.sheetCode.startsWith('EXT-')).map(s => s.sheetCode)))

  // 8) 권한 축 — 담당자/관리자는 편집 가능, 비담당 employee는 불가
  const { overviews: ov2 } = await buildSheetOverviews(raw as never, [inspId], { id: otherId, role: 'employee' })
  check('canEdit: 담당자 true', ov.canEdit === true)
  check('canEdit: 비담당 employee false', ov2[inspId].canEdit === false)

  // 9) 설치 시설이 없는 고객은 noFacilityInfo 신호
  await raw.from('fire_facilities').delete().eq('building_id', bld!.id)
  const { overviews: ov3 } = await buildSheetOverviews(raw as never, [inspId], { id: userId, role: 'admin' })
  check('noFacilityInfo — 시설 0건일 때 true', ov3[inspId].noFacilityInfo === true)
  check('noFacilityInfo 시에도 시트는 반환', ov3[inspId].sheets.length > 0)

  // 10) 존재하지 않는 회차 id는 조용히 제외
  const { overviews: ov4 } = await buildSheetOverviews(
    raw as never, ['00000000-0000-0000-0000-000000000000'], { id: userId, role: 'admin' })
  check('없는 회차 → 빈 결과', Object.keys(ov4).length === 0)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  for (const id of [inspId, compInspId].filter(Boolean)) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', id)
    await raw.from('inspection_defects').delete().eq('inspection_id', id)
  }
  if (custId) {
    const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', custId)
    for (const b of blds ?? []) await raw.from('fire_facilities').delete().eq('building_id', b.id)
    await raw.from('buildings').delete().eq('customer_id', custId)
    await cleanupCustomer(custId)
  }
  if (userId) await delUser(userId)
  if (otherId) await delUser(otherId)
}
summary()
