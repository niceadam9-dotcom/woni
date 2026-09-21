// 「기타」 3종의 두 축 — 체크는 **대장**, 결과·진행은 **점검표** (2026-09-21)
//
// 왜 생겼나: 대장(보고서 탭 「기타 점검대상」)에 ☑ 해 둔 방화문·비상구가 문서에는 빈 상자로
// 나갔다(실측 용문3). 문서가 체크까지 점검표 응답에서 뽑고 있었기 때문이다 — facility-codes.ts
// ETC_ITEMS가 이미 못박아 둔 계약(「체크 = 이 대상물에 해당한다 / 결과 = 점검표」)을 어긴 자리였다.
// 같은 화면의 진행 배지도 **시트 단위**라, 한 시트를 셋이 나눠 쓰는 탓에 방화문만 입력해도
// 비상구까지 「입력 완료」로 보였다.
//
// ⚠ 표본이 둘인 이유(중요): **작동 회차 하나로는 시트 단위/항목 단위를 구별할 수 없다.**
//   작동에서는 비상구·방염이 종합 전용(●)이라 분모에서 빠져 시트 분모가 방화문 하나와 같아지고,
//   두 방식이 같은 답을 낸다(변이 M-b가 실제로 이 표본을 통과했다). 갈라지는 건 **종합 회차**다 —
//   4항목이 전부 범위 안이고 하나만 입력했을 때, 시트 단위는 셋 다 「미입력 3」이라 말한다.
//
// 실행: npx tsx scripts/test-etc-axis.mts   (로컬 dev + 스테이징 DB)
import XLSX from 'xlsx'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'etc-axis-e2e@erp-test.com'
const DOOR = '방화문 및 방화셔터'
const EXIT = '비상구 및 피난통로'
const FLAME = '방염'
let userId = ''
const custIds: string[] = []
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

/** 고객 1명 + 건물 1동 + 대장 ETC 등록 + 회차 1건(성격 지정) + 응답 일부 */
async function fixture(name: string, planType: 'special_작동' | 'special_종합', ledger: string[], answers: string[]) {
  const customerId = await mkCustomer({ customer_name: name, created_by: userId, inspection_type: '일반관리' })
  custIds.push(customerId)
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  for (const code of ledger) {
    await raw.from('fire_facilities').insert({
      building_id: bld!.id, category: '기타', facility_code: code, installed: true,
    })
  }
  const { data: ins, error } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: planType,
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`회차 생성 실패: ${error.message}`)
  for (const code of answers) {
    await raw.from('inspection_sheet_responses').insert({ inspection_id: ins!.id, item_code: code, result: 'O' })
  }
  return { customerId, inspectionId: ins!.id as string }
}

try {
  userId = await mkUser({ email: EMAIL, name: '기타축E2E', employeeId: 'E2E-ETCAXIS' })

  // 작동 — 비상구·방염은 종합 전용(●)이라 범위 밖. 대장엔 방화문·비상구만 ☑
  const op = await fixture('기타축작동E2E', 'special_작동', [DOOR, EXIT], ['31-A-001'])
  // 종합 — 4항목 전부 범위 안. 대장 3종 ☑, 응답은 방화문 하나뿐 → 여기서 두 방식이 갈라진다
  const comp = await fixture('기타축종합E2E', 'special_종합', [DOOR, EXIT, FLAME], ['31-A-001'])

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  const badge = async (code: string) => {
    const link = page.locator(`[data-testid="etc-link-${code}"]`)
    const scope = page.locator(`[data-testid="etc-scope-${code}"]`)
    if (await scope.count()) return (await scope.first().innerText()).trim()
    if (await link.count()) return (await link.first().innerText()).trim()
    return '(배지 없음)'
  }
  const openPanel = async (customerId: string) => {
    await page.goto(`${BASE}/customers/${customerId}?tab=reports&form=etc`)
    await page.waitForSelector('text=기타 점검대상', { timeout: 60000 })
    // 배지는 서버 액션 둘을 기다린다 — 모양이 아니라 **뜻**이 확정될 때까지 폴링
    for (let i = 0; i < 60; i++) {
      if ((await badge(DOOR)) !== '(배지 없음)') return
      await page.waitForTimeout(500)
    }
  }

  // ── ① 작동 회차 — 종합 전용(●)을 화면이 말한다 ──
  await openPanel(op.customerId)
  const opDoor = await badge(DOOR), opExit = await badge(EXIT), opFlame = await badge(FLAME)
  check('① 작동 — 방화문(범위 안·입력됨) = 입력 완료', opDoor === '입력 완료', opDoor)
  check('🚨 ① 작동 — 비상구는 「입력 완료」라 말하지 않는다', opExit !== '입력 완료', opExit)
  check('① 작동 — 비상구 = 종합점검 전용(●)', opExit === '종합점검 전용', opExit)
  check('① 작동 — 방염은 대장 미체크라 배지 없음', opFlame === '(배지 없음)', opFlame)
  check('🚨 ① 작동 — 종합 전용은 링크가 아니다(입력할 칸 없는 화면으로 보내지 않는다)',
    (await page.locator(`[data-testid="etc-link-${EXIT}"]`).count()) === 0)

  // ── ② 종합 회차 — ★ 항목 단위여야만 통과한다(시트 단위면 셋 다 「미입력 3」) ──
  await openPanel(comp.customerId)
  const cDoor = await badge(DOOR), cExit = await badge(EXIT), cFlame = await badge(FLAME)
  check('★ ② 종합 — 방화문만 입력됐으므로 방화문만 완료', cDoor === '입력 완료', cDoor)
  check('★ ② 종합 — 비상구는 자기 항목 1건만 센다(시트 단위면 3)', cExit === '미입력 1', cExit)
  check('★ ② 종합 — 방염은 선·후처리 2건을 센다(시트 단위면 3)', cFlame === '미입력 2', cFlame)

  // ── ③ 문서 — 체크는 대장 축(응답과 무관), 결과는 점검표 축 ──
  const res = await page.request.get(`${BASE}/inspections/${comp.inspectionId}/workbook`)
  check('③ 워크북 생성 성공', res.ok(), String(res.status()))
  if (res.ok()) {
    const wb = XLSX.read(Buffer.from(await res.body()), { type: 'buffer' })
    const ws = wb.Sheets['현황']
    const cell = (c: string) => String((ws[c] as { v?: unknown } | undefined)?.v ?? '(빈 셀)')
    check('③ 방화문 — 대장 ☑ → 문서 체크', cell('Y27').includes('√'), cell('Y27'))
    check('🚨 ③ 비상구 — 대장 ☑ → 문서 체크(응답이 없어도)', cell('Y28').includes('√'), cell('Y28'))
    check('🚨 ③ 방염 — 대장 ☑ → 문서 체크(응답이 없어도)', cell('Y29').includes('√'), cell('Y29'))
    check('③ 결과는 점검표 축 — 응답 있는 방화문만 ○', cell('AO27') === '○', cell('AO27'))
    check('③ 결과 — 무응답은 종전대로 ／(두 축을 섞지 않는다)',
      cell('AO28') === '/' && cell('AO29') === '/', `${cell('AO28')} ${cell('AO29')}`)
  }

  // ── ④ 대조군 — 대장 미체크면 문서도 빈 상자 (작동 회차 표본의 방염) ──
  const res2 = await page.request.get(`${BASE}/inspections/${op.inspectionId}/workbook`)
  if (res2.ok()) {
    const ws2 = XLSX.read(Buffer.from(await res2.body()), { type: 'buffer' }).Sheets['현황']
    const v = String((ws2['Y29'] as { v?: unknown } | undefined)?.v ?? '')
    check('④ 대조군 — 대장 미체크(방염)는 문서도 빈 상자', !v.includes('√'), v)
  } else {
    check('④ 대조군 워크북 생성', false, String(res2.status()))
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const cid of custIds) {
    const { data: insps } = await raw.from('inspections').select('id').eq('customer_id', cid)
    for (const i of insps ?? []) {
      await raw.from('inspection_sheet_responses').delete().eq('inspection_id', i.id)
      await raw.from('inspection_defects').delete().eq('inspection_id', i.id)
    }
    const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', cid)
    for (const b of blds ?? []) await raw.from('fire_facilities').delete().eq('building_id', b.id)
    await raw.from('buildings').delete().eq('customer_id', cid)
    await cleanupCustomer(cid)
  }
  if (userId) await delUser(userId)
}
summary()
