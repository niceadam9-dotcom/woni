// 미배정 계획 표면화 E2E (2026-09-07)
//
// 왜 만들었나: 계획 항목은 고객의 담당을 물려받아 태어난다 — 고객이 미배정이면 일반(종합)·
// 일반(작동) 계획도 미배정으로 남고, '누구의 일도 아닌' 채 시기가 지나간다(운영 실사례 규현빌라).
// 사용자 결정(자동 배정 없음)에 따라 **보이게만** 했다: 계획 화면 배지 + 미배정 필터 + 행 강조.
//
// 이 검사가 지키는 것: '배지가 뜬다'가 아니라 **배지 숫자가 DB 사실과 같고, 필터가 그 집합을
// 정확히 남긴다**이다. 건수 단언은 스테이징 잡음(기존 미배정 535건+)에 안 흔들리게 UI ↔ DB
// 동일 규칙 대조로 한다(0건 공허 통과 방지 — 대조군도 DB 기대치와 양방향 비교).
//
// 실행: npx tsx scripts/test-unassigned-surface.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, ensurePlan } from './_e2e-helpers.mjs'

const EMAIL = 'unassigned-surface-e2e@erp-test.com'
let userId = ''
let custU = ''   // 미배정 일반관리(작동) — 배지·필터 표적
let custA = ''   // 배정됨 대조군 — 미배정 필터에서 사라져야 함
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const BANNER = '[data-testid="unassigned-plan-banner"]'
const now = new Date(Date.now() + 9 * 3600_000)
const Y = now.getFullYear(), M = now.getMonth() + 1
const MD = `${Y}-${String(M).padStart(2, '0')}-15`

/** 클라이언트 unassignedTypeLabel과 같은 규칙(테스트 복제본) — 갈라지면 이 검사가 잡는다 */
function labelOf(i: { plan_type: string | null; inspection_type: string | null; inspection_sub_type: string | null }): string {
  const pt = i.plan_type
    ?? (i.inspection_type === '종합' ? 'special_종합'
      : i.inspection_type === '작동' ? 'special_작동'
        : i.inspection_type === '일반관리' ? (i.inspection_sub_type === '종합' ? 'special_종합' : 'special_작동')
          : 'monthly')
  if (pt === 'monthly') return '정기'
  if (pt === 'event') return '일반'
  const sub = pt === 'special_종합' ? '종합' : '작동'
  return i.inspection_type === '일반관리' ? `일반(${sub})` : sub
}

/** 화면과 같은 규칙으로 DB에서 기대치 산출(활성 고객·계획/확정·미배정). 1000행 상한 회피 페이징 */
async function dbExpected(year: number, month: number): Promise<{ total: number; byLabel: Record<string, number> }> {
  const { data: plan } = await raw.from('inspection_plans').select('id').eq('year', year).eq('month', month).maybeSingle()
  if (!plan) return { total: 0, byLabel: {} }
  const rows: Array<{ plan_type: string | null; inspection_type: string | null; inspection_sub_type: string | null; status: string; assigned_employee_id: string | null; customers: { is_active: boolean | null } | null }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await raw.from('inspection_plan_items')
      .select('plan_type, inspection_type, inspection_sub_type, status, assigned_employee_id, customers:customer_id!inner(is_active)')
      .eq('plan_id', plan.id).range(from, from + 999)
    if (error) throw new Error(`기대치 조회 실패: ${error.message}`)
    rows.push(...((data ?? []) as unknown as typeof rows))
    if (!data || data.length < 1000) break
  }
  const target = rows.filter(r => r.customers?.is_active !== false
    && !r.assigned_employee_id && (r.status === 'planned' || r.status === 'confirmed'))
  const byLabel: Record<string, number> = {}
  for (const r of target) { const l = labelOf(r); byLabel[l] = (byLabel[l] ?? 0) + 1 }
  return { total: target.length, byLabel }
}

try {
  userId = await mkUser({ email: EMAIL, name: '미배정표면E2E', employeeId: 'E2E-UNAS' })

  // ── 시드: 미배정 일반관리(작동) 1건 + 배정된 대조군 1건 — 같은 달 ──
  custU = await mkCustomer({ customer_name: '미배정표면U고객', inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: '작동', created_by: userId })
  custA = await mkCustomer({ customer_name: '미배정표면A고객', inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: '작동', assigned_employee_id: userId, created_by: userId })
  const { id: planId } = await ensurePlan(Y, M, userId)
  const mkItem = (cid: string, emp: string | null) => raw.from('inspection_plan_items').insert({
    plan_id: planId, customer_id: cid, inspection_type: '일반관리', inspection_category: '일반관리',
    inspection_sub_type: '작동', plan_type: 'special_작동', sequence_num: 1,
    planned_date: MD, status: 'planned', assigned_employee_id: emp,
  })
  for (const [cid, emp] of [[custU, null], [custA, userId]] as const) {
    const { error } = await mkItem(cid, emp)
    if (error) throw new Error(`계획 항목 시드 실패: ${error.message}`)
  }

  const expected = await dbExpected(Y, M)
  check('시드 — 이 달 미배정 기대치에 시드 반영', expected.total >= 1 && (expected.byLabel['일반(작동)'] ?? 0) >= 1,
    JSON.stringify(expected.byLabel))

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)

  // ── [1] 배지 — 건수·라벨이 DB 기대치와 정확히 일치 ──
  console.log('\n[1] 미배정 배지')
  await page.goto(`${BASE}/inspection-plans?year=${Y}&month=${M}`)
  await page.waitForSelector(BANNER)
  const bannerText = (await page.locator(BANNER).innerText()).replace(/\s+/g, ' ')
  const mTotal = bannerText.match(/담당 미배정 (\d+)건/)
  check('배지 — 총건수 = DB 기대치', !!mTotal && Number(mTotal[1]) === expected.total,
    `배지 ${mTotal?.[1] ?? '?'} vs DB ${expected.total} -- ${bannerText}`)
  for (const [label, n] of Object.entries(expected.byLabel)) {
    check(`배지 — ${label} ${n}건 표기`, bannerText.includes(`${label} ${n}건`), bannerText)
  }
  check('배지 — 일반(작동) 라벨 형식', /일반\(작동\) \d+건/.test(bannerText), bannerText)
  const labelSum = Object.values(expected.byLabel).reduce((a, b) => a + b, 0)
  check('배지 — 라벨 합 = 총건수(누락 라벨 없음)', labelSum === expected.total, `${labelSum} vs ${expected.total}`)

  // ── [2] 미배정만 보기 — 필터·URL·행 강조 ──
  console.log('\n[2] 미배정 필터')
  await page.click(`${BANNER} >> text=미배정만 보기`)
  await page.waitForFunction(() => window.location.search.includes('emp=unassigned'))
  check('클릭 → URL emp=unassigned', true)
  check('담당자 셀렉트 = 미배정', await page.locator('select').first().inputValue() === 'unassigned')
  await page.waitForSelector('text=미배정표면U고객')
  check('미배정 고객 행 표시', await page.locator('tbody tr', { hasText: '미배정표면U고객' }).count() === 1)
  check('배정된 대조군 행 부재', await page.locator('tbody tr', { hasText: '미배정표면A고객' }).count() === 0)
  const rowCount = await page.locator('tbody tr').count()
  const redCount = await page.locator('tbody tr >> span.text-red-500', { hasText: '미배정' }).count()
  check('전 행 담당칸 「미배정」 빨강 — 정체 판정(0행 아님)', rowCount >= 1 && redCount >= rowCount,
    `rows=${rowCount} red=${redCount}`)
  check('버튼 라벨 전환(전체 보기)', (await page.locator(BANNER).innerText()).includes('전체 보기'))

  // ── [3] URL 왕복 — 새로고침에도 미배정 필터 유지 ──
  console.log('\n[3] URL 왕복')
  await page.goto(`${BASE}/inspection-plans?year=${Y}&month=${M}&emp=unassigned`)
  await page.waitForSelector('text=미배정표면U고객')
  check('재진입 — 셀렉트 = 미배정', await page.locator('select').first().inputValue() === 'unassigned')
  check('재진입 — 대조군 부재 유지', await page.locator('tbody tr', { hasText: '미배정표면A고객' }).count() === 0)

  // ── [4] 대조군 — 미배정 0건인 조회 범위에서 배지 미렌더(양방향: DB 기대치로 판정) ──
  console.log('\n[4] 대조군(빈 달)')
  const ctrl = await dbExpected(2020, 1)
  check('대조군 달 DB 기대치 0건(전제 단언)', ctrl.total === 0, `DB ${ctrl.total}건`)
  await page.goto(`${BASE}/inspection-plans?year=2020&month=1`)
  await page.waitForSelector('text=현황')
  check('배지 미렌더', await page.locator(BANNER).count() === 0)

  // ── [5] 셀렉트 옵션 — 「미배정 (N)」 건수 일치 ──
  console.log('\n[5] 셀렉트 옵션')
  await page.goto(`${BASE}/inspection-plans?year=${Y}&month=${M}`)
  await page.waitForSelector(BANNER)
  const optText = await page.locator('select >> option[value="unassigned"]').first().innerText()
  check('옵션 「미배정 (N)」 = DB 기대치', optText.includes(`(${expected.total})`), `${optText} vs ${expected.total}`)
} finally {
  for (const cid of [custU, custA]) if (cid) await cleanupCustomer(cid)
  await delUser(userId)
  if (browser) await browser.close()
}
summary()
