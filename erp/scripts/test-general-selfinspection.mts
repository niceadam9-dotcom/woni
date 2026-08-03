/** 소방계획서_6 W-24: 일반관리 자체점검 통주행 E2E —
 *  고객 등록 → 연간 계획 생성(정기 없음 확인) → UI 점검일 확정 → 자동 시작(6단계) → 별지 9호 어포던스 → 타임라인 ①~⑥.
 *  실행: (dev 기동 후) npx tsx scripts/test-general-selfinspection.mts
 *  전제: 스테이징 DB에 마이그레이션 110(백필)·111(트리거 개정) 적용
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium, type Page } from 'playwright'
import gen from '../src/lib/inspection-plan-generator.ts'
const { generateYearlyPlanItems, loadHolidaySet } = gen as unknown as typeof import('../src/lib/inspection-plan-generator.ts')

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const admin = raw as never as Parameters<typeof generateYearlyPlanItems>[0]

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const YEAR = new Date().getFullYear()
const NAME = 'TEST-일반자체통주행'
const NAME2 = 'TEST-일반자체종합'
const EMAIL = 'general-self-e2e@erp-test.com'
const PW = 'GeneralSelf1!'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

let userId = ''
const custIds: string[] = []
let browser: import('playwright').Browser | null = null

async function itemsOf(cid: string) {
  const { data } = await raw.from('inspection_plan_items')
    .select('id, status, plan_type, inspection_type, inspection_sub_type, sequence_num, planned_date, scheduled_date, inspection_id')
    .eq('customer_id', cid).order('created_at')
  return (data ?? []) as Array<{ id: string; status: string; plan_type: string | null; inspection_type: string; inspection_sub_type: string | null; sequence_num: number; planned_date: string | null; scheduled_date: string | null; inspection_id: string | null }>
}
async function waitFor<T>(get: () => Promise<T>, cond: (v: T) => boolean, ms = 20000): Promise<T> {
  const start = Date.now()
  let last: T = await get()
  while (Date.now() - start < ms) {
    if (cond(last)) return last
    await new Promise(r => setTimeout(r, 500))
    last = await get()
  }
  return last
}

async function mkGeneralCustomer(name: string, sub: '종합' | '작동', anchor: string) {
  const { data, error } = await raw.from('customers').insert({
    customer_code: `TEST-GS-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: name, inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: sub,
    plan_anchor_date: anchor, is_active: true, created_by: userId, assigned_employee_id: userId,
  }).select('id').single()
  if (error) throw new Error(`고객 생성 실패: ${error.message}`)
  custIds.push(data!.id)
  return data!.id as string
}

try {
  console.log('\n[셋업] 관리자 계정 + 일반관리 고객(작동·종합) — 등록 경로와 동일한 컬럼 구성')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`계정 생성 실패: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST일반자체', role: 'admin', is_active: true, employee_id: 'E2E-GS', email: EMAIL })

  const now = new Date()
  const month = now.getMonth() + 1
  const anchor = `${YEAR}-${String(month).padStart(2, '0')}-10`
  const custA = await mkGeneralCustomer(NAME, '작동', anchor)
  const custB = await mkGeneralCustomer(NAME2, '종합', anchor)

  // ── 1) 계획 생성: 일반관리 = 자체점검만, 정기(monthly) 없음 (D-1) ──
  const hdSet = await loadHolidaySet(admin, YEAR)
  await generateYearlyPlanItems(admin,
    { id: custA, inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: '작동', plan_anchor_date: anchor, assigned_employee_id: userId },
    YEAR, userId, hdSet)
  await generateYearlyPlanItems(admin,
    { id: custB, inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: '종합', plan_anchor_date: anchor, assigned_employee_id: userId },
    YEAR, userId, hdSet)

  const a0 = await itemsOf(custA)
  check('작동: special_작동 1건 생성 (planned)',
    a0.length === 1 && a0[0].plan_type === 'special_작동' && a0[0].status === 'planned',
    JSON.stringify(a0.map(i => [i.plan_type, i.status])))
  check('작동: 정기(monthly)·event 0건', !a0.some(i => i.plan_type === 'monthly' || i.plan_type === 'event'))
  const b0 = await itemsOf(custB)
  const b0Special = b0.filter(i => i.plan_type === 'special_종합')
  check('종합: special_종합 1~2건(연내 2차는 +6개월) + 정기 0건',
    b0Special.length >= 1 && b0Special.length === b0.length && !b0.some(i => i.plan_type === 'monthly' || i.plan_type === 'event'),
    JSON.stringify(b0.map(i => [i.plan_type, i.sequence_num])))
  check('생성 항목 sub_type 저장(작동/종합)',
    a0.every(i => i.inspection_sub_type === '작동') && b0.every(i => i.inspection_sub_type === '종합'))

  // ── 2) UI: 점검확정 화면에서 점검일 확정 → 자체점검 자동 시작 ──
  browser = await chromium.launch()
  const page: Page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
  page.setDefaultTimeout(20000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
  check('로그인 성공', true)

  await page.goto(`${BASE}/inspection-plans`)
  const rowA = page.locator('tr', { has: page.getByText(NAME) }).first()
  await rowA.waitFor()
  await rowA.getByText('점검일 확정').click()
  // 미니 달력 팝업에서 예정일(10일 부근 영업일) 클릭 — planned_date의 '일'을 그대로 선택
  const plannedDay = Number((a0[0].planned_date ?? anchor).slice(8))
  await page.locator('div.z-\\[9999\\] button', { hasText: new RegExp(`^${plannedDay}$`) }).first().click()

  const a1 = await waitFor(() => itemsOf(custA), list => !!list[0]?.inspection_id)
  check('확정 → 자체점검 자동 시작 (inspection 연결·항목 completed)',
    !!a1[0]?.inspection_id && a1[0].status === 'completed', JSON.stringify(a1))
  const inspId = a1[0].inspection_id!

  // ── 3) 데이터: plan_type 전파 + 트리거 111 = 6단계 ──
  const { data: insp } = await raw.from('inspections').select('status, plan_type, inspection_type').eq('id', inspId).single()
  check('inspections: plan_type=special_작동·in_progress',
    insp?.plan_type === 'special_작동' && insp?.status === 'in_progress', JSON.stringify(insp))
  const { data: steps } = await raw.from('inspection_steps').select('step_num').eq('inspection_id', inspId).order('step_num')
  check('일반관리 자체점검 = 6단계 생성(트리거 111)', (steps ?? []).length === 6, `steps=${(steps ?? []).length}`)

  // ── 4) UI: 점검 상세 — 소방시설등점검표·별지 9호·타임라인 ①~⑥ ──
  await page.goto(`${BASE}/inspections/${inspId}`)
  await page.waitForSelector('text=문서 타임라인')
  check('점검표 라벨 = 작동점검 (소방시설등점검표 축)', await page.isVisible('text=작동점검 (○항목)'))
  check('별지 9호 생성 어포던스 노출', await page.isVisible('text=별지 9호 생성'))
  check('외관점검표 렌더 아님', !(await page.isVisible('text=외관점검 (별지 6호)')))
  check('타임라인 ① 점검표', await page.isVisible('text=① 점검표'))
  check('타임라인 ④ 소방서 제출(9호)', await page.isVisible('text=④ 소방서 제출'))
  check('타임라인 ⑥ 이행완료(별지 11호)', await page.isVisible('text=⑥ 이행완료 (별지 11호)'))

  await browser.close(); browser = null
} catch (e) {
  fail++
  console.error('\n❌ 테스트 중단:', (e as Error).message)
} finally {
  if (browser) await browser.close()
  for (const cid of custIds) {
    const inspIds = ((await raw.from('inspections').select('id').eq('customer_id', cid)).data ?? []).map(r => r.id)
    if (inspIds.length) {
      for (const t of ['inspection_sheet_responses', 'inspection_defects', 'inspection_status_log', 'inspection_steps', 'inspection_logs']) {
        await raw.from(t).delete().in('inspection_id', inspIds)
      }
    }
    await raw.from('inspection_plan_items').delete().eq('customer_id', cid)
    await raw.from('inspections').delete().eq('customer_id', cid)
    await raw.from('activity_logs').delete().in('entity_id', [cid, ...inspIds])
    await raw.from('customers').delete().eq('id', cid)
  }
  if (userId) {
    await raw.from('profiles').delete().eq('id', userId)
    await raw.auth.admin.deleteUser(userId).catch(() => {})
  }
  console.log('\n[정리] 완료')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
