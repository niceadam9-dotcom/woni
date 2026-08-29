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

  // 2b) 머더 버킷 (소방계획서_23 S5-5~S5-8, withGroups=true) — 분모 보존이 핵심 불변식
  check('withGroups 기본 false — groups 미포함', p1!.groups === undefined)
  const { overviews: ovG } = await buildSheetOverviews(raw as never, [inspId], { id: userId, role: 'admin' }, { withGroups: true })
  const pg = ovG[inspId].sheets.find((s: { sheetCode: string }) => s.sheetCode === 'STD-01')
  check('withGroups: 머더 버킷 반환(≥2 — 1-A·1-B)', (pg?.groups?.length ?? 0) >= 2, String(pg?.groups?.length))
  const gSum = (pg?.groups ?? []).reduce((a: number, g: { total: number }) => a + g.total, 0)
  check('머더 total 합 == 시트 total', gSum === pg!.total, `sum=${gSum} sheet=${pg?.total}`)
  const gResp = (pg?.groups ?? []).reduce((a: number, g: { responded: number }) => a + g.responded, 0)
  check('머더 responded 합 == 시트 responded', gResp === pg!.responded, `sum=${gResp} sheet=${pg?.responded}`)

  // 2c) Q-19 — ／(N)도 responded에 포함된다('이 머더는 다 봤다'의 표현, S7-21)
  if (s1Codes.length >= 5) {
    await raw.from('inspection_sheet_responses').insert({
      inspection_id: inspId, item_code: s1Codes[4], result: 'N', updated_by: userId,
    })
    const { overviews: ovN } = await buildSheetOverviews(raw as never, [inspId], { id: userId, role: 'admin' }, { withGroups: true })
    const pn = ovN[inspId].sheets.find((s: { sheetCode: string }) => s.sheetCode === 'STD-01')
    const nSum = (pn!.groups ?? []).reduce((a: number, g: { responded: number }) => a + g.responded, 0)
    check('N 포함 responded — 시트·머더 합 동일 반영', pn!.responded === 5 && pn!.counts.N === 1 && nSum === 5,
      JSON.stringify({ responded: pn?.responded, N: pn?.counts.N, nSum }))
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId).eq('item_code', s1Codes[4])
  }

  // 3) 종합전용(●) 항목은 작동 범위 분모에서 제외 — 종합점검과 분모가 달라야 필터가 실제로 도는 것
  const allCodes = new Set(((s1items ?? []) as Array<{ item_code: string }>).map(i => i.item_code))
  const hasCompOnly = allCodes.size > s1Codes.length
  check('셋업: STD-01에 종합전용 항목 존재(차등 검증 전제)', hasCompOnly, `all=${allCodes.size} op=${s1Codes.length}`)
  check('작동 분모 < 전체 항목 수', p1!.total < allCodes.size, `total=${p1?.total} all=${allCodes.size}`)

  // 3b) 같은 고객·같은 시트라도 종합점검이면 분모가 전체가 된다 (범위 필터 차등 확인)
  // ⚠ 이 행은 종전에 sequence_num=2 였다. 소방계획서_33 이후 **2차 종합은 만들 수 없다** —
  //   153 트리거는 종합 대상 고객만 2차를 허용하고(이 픽스처는 일반관리),
  //   INV-D12a는 seq2 special_종합 자체를 위반으로 잡는다.
  //   차수는 이 테스트의 관심사가 아니었다(유니크 회피용이었다) — **연도**를 갈라 seq1로 만든다.
  //   uq_inspections_special_year_seq가 (customer_id, year, sequence_num)이라 연도가 다르면 충돌하지 않는다.
  const { data: inspComp } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '종합', plan_type: 'special_종합', sequence_num: 1,
    inspection_start_date: '2025-08-11', status: 'in_progress',
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

  // 11) S7-27 — 다중이용 입력 단일화 노출 규칙 (22 Q-10·S14-4/5 위임분)
  //     multiUse 업종 ≥1 → STD-32 installed 취급(설비 맵 미등재 예외) + MU-01 숨김(레거시 응답은 보존)
  {
    // 사전: multiUse 아님 — MU-01 노출·STD-32는 미설치 취급
    const pre = ov3[inspId]
    check('S7-27 사전 — multiUse 아님: MU-01 포함', pre.sheets.some(s => s.sheetCode === 'MU-01'))
    check('S7-27 사전 — STD-32 installed=false', pre.sheets.find(s => s.sheetCode === 'STD-32')?.installed === false)

    await raw.from('fire_plan_forms').insert({
      customer_id: custId, sections: { multiUse: { applicable: true, categories: { '노래연습장업': '2' } } },
    })
    const { overviews: ovMu } = await buildSheetOverviews(raw as never, [inspId], { id: userId, role: 'admin' })
    const mu = ovMu[inspId]
    check('S7-27 — multiUse: STD-32 installed=true(노출 예외)', mu.sheets.find(s => s.sheetCode === 'STD-32')?.installed === true)
    check('S7-27 — multiUse: MU-01 숨김', !mu.sheets.some(s => s.sheetCode === 'MU-01'),
      JSON.stringify(mu.sheets.filter(s => s.sheetCode === 'MU-01').map(s => s.sheetCode)))
    check('S7-27 — 입력 화면 다중이용 시트 1개(합격선 22 S14-5)',
      mu.sheets.filter(s => s.sheetCode === 'STD-32' || s.sheetCode === 'MU-01').length === 1)

    // 레거시 보존 — MU 직접 응답이 이미 있으면 숨기지 않는다
    await raw.from('inspection_sheet_responses').insert({
      inspection_id: inspId, item_code: 'MU-001', result: 'O', updated_by: userId,
    })
    const { overviews: ovLg } = await buildSheetOverviews(raw as never, [inspId], { id: userId, role: 'admin' })
    const lg = ovLg[inspId].sheets.find(s => s.sheetCode === 'MU-01')
    check('S7-27 — 레거시 MU 응답 보존: MU-01 재노출·responded 반영', !!lg && lg.responded === 1,
      JSON.stringify(lg && { r: lg.responded }))
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId).eq('item_code', 'MU-001')
    await raw.from('fire_plan_forms').delete().eq('customer_id', custId)
  }
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
