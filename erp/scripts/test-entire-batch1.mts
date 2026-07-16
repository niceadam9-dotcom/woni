/** Victory10_entire 자동화 배치1 — PERM-6/PERM-1/PERM-12/AUTH-7/FIRE-S6/MY-2/PERM-5 실측 검증 (2026-07-16)
 *  대상: staging.sjfire.co.kr (운영 금지). DB: .env.local 스테이징 Supabase.
 *  실행: npx tsx scripts/test-entire-batch1.mts
 *  패턴: 서비스롤로 테스트 계정(admin/emp/emp2)+고객+계획 시딩 → UI 로그인/조작 → DB 검증 → finally 전량 삭제
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium, type Page, type Browser } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const raw = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY!)

const BASE = process.env.TEST_BASE_URL || 'https://staging.sjfire.co.kr'
const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth() + 1
// 당월 15일 (계획 목록에 노출되는 예정일)
const SCHED = `${YEAR}-${String(MONTH).padStart(2, '0')}-15`

const PW = 'BatchTest1!'
const EMP = 'test-batch-emp@erp-test.com'
const EMP2 = 'test-batch-emp2@erp-test.com'
const ADM = 'test-batch-adm@erp-test.com'

// 결과 집계 — 시나리오별
const results: Record<string, { verdict: string; evidence: string }> = {}
function record(id: string, verdict: string, evidence: string) {
  results[id] = { verdict, evidence }
  console.log(`\n[${id}] ${verdict} — ${evidence}`)
}
let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
  return cond
}

const ids = { emp: '', emp2: '', adm: '' }
let planId = ''
let custA = '', custB = '', itemA = '', itemB = ''
let todoId = ''
let regCustomerId = ''  // PERM-1로 생성될 고객
let browser: Browser | null = null

async function ensureUser(email: string, role: string, name: string, empCode: string) {
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === email) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error } = await raw.auth.admin.createUser({ email, password: PW, email_confirm: true })
  if (error || !nu?.user) throw new Error(`계정 생성 실패(${email}): ${error?.message}`)
  await raw.from('profiles').upsert({ id: nu.user.id, name, role, is_active: true, is_system: false, employee_id: empCode, email })
  return nu.user.id
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })
}

async function getItem(id: string) {
  const { data } = await raw.from('inspection_plan_items')
    .select('id, status, notes, scheduled_date, assigned_employee_id').eq('id', id).single()
  return data as { id: string; status: string; notes: string | null; scheduled_date: string | null; assigned_employee_id: string | null } | null
}

try {
  console.log(`\n[환경] BASE=${BASE}  DB=${URL_}`)

  // ── 셋업: 계정 ──
  console.log('\n[셋업] 계정 3종')
  ids.adm = await ensureUser(ADM, 'admin', 'TEST-배치관리자', 'TB-ADM')
  ids.emp = await ensureUser(EMP, 'employee', 'TEST-배치직원', 'TB-EMP')
  ids.emp2 = await ensureUser(EMP2, 'employee', 'TEST-배치직원2', 'TB-EMP2')

  // ── 셋업: 고객 2 + 계획 헤더 + 항목 2 ──
  console.log('[셋업] 고객·계획 시딩')
  const mk = async (name: string, emp: string) => {
    const { data, error } = await raw.from('customers').insert({
      customer_code: `TB-${Math.random().toString(36).slice(2, 8)}`,
      customer_name: name, inspection_type: '작동', inspection_category: '소방안전관리',
      inspection_sub_type: '작동', plan_anchor_date: SCHED, assigned_employee_id: emp,
      is_active: true, created_by: ids.adm,
    }).select('id').single()
    if (error) throw new Error(`고객 생성 실패: ${error.message}`)
    return (data as { id: string }).id
  }
  custA = await mk('TEST-배치-고객A', ids.emp)
  custB = await mk('TEST-배치-고객B', ids.emp2)

  const { data: plan, error: pErr } = await raw.from('inspection_plans')
    .upsert({ year: YEAR, month: MONTH, status: 'draft', auto_generated: false, created_by: ids.adm }, { onConflict: 'year,month' })
    .select('id').single()
  // upsert가 기존 헤더를 반환할 수 있음 — 없으면 조회
  if (pErr || !plan) {
    const { data: p2 } = await raw.from('inspection_plans').select('id').eq('year', YEAR).eq('month', MONTH).single()
    planId = (p2 as { id: string }).id
  } else planId = (plan as { id: string }).id

  const mkItem = async (cust: string, emp: string) => {
    const { data, error } = await raw.from('inspection_plan_items').insert({
      plan_id: planId, customer_id: cust, inspection_type: '작동', sequence_num: 1,
      scheduled_date: SCHED, planned_date: SCHED, plan_type: 'monthly', status: 'planned',
      assigned_employee_id: emp, notes: null,
    }).select('id').single()
    if (error) throw new Error(`항목 생성 실패: ${error.message}`)
    return (data as { id: string }).id
  }
  itemA = await mkItem(custA, ids.emp)
  itemB = await mkItem(custB, ids.emp2)
  console.log(`  planId=${planId} itemA=${itemA} itemB=${itemB}`)

  // ── 셋업: MY-2용 ToDo ──
  const { data: todo } = await raw.from('todos').insert({
    employee_id: ids.emp, title: 'TEST-배치-투두', priority: '보통', completed: false,
  }).select('id').single()
  todoId = (todo as { id: string }).id

  // ── 브라우저: 직원 로그인 ──
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(20000)
  let lastAlert = ''
  page.on('dialog', d => { lastAlert = d.message(); d.accept().catch(() => {}) })
  await login(page, EMP)

  // ══════════════════════════════════════════════════════════════
  // PERM-6: 슬라이드 패널 수정 (직원)
  // ══════════════════════════════════════════════════════════════
  console.log('\n===== PERM-6 =====')
  await page.goto(`${BASE}/inspection-plans?year=${YEAR}&month=${MONTH}`)
  const rowA = page.locator('tr', { has: page.getByText('TEST-배치-고객A') }).first()
  const rowVisible = await rowA.waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  if (check('계획 목록에 시딩 항목 노출 (테이블 행 존재)', rowVisible)) {
    await rowA.click()
    // 패널 컨테이너
    const panel = page.locator('div.w-80.shadow-2xl').first()
    await panel.waitFor({ timeout: 10000 })
    await panel.getByText('메모').waitFor()

    // 담당 드롭다운 비활성: 패널 내 select는 상태 1개뿐(담당 select 없음) + '고객관리에서 변경' 안내
    const selCount = await panel.locator('select').count()
    const noAssignDropdown = await panel.getByText('고객관리에서 변경').count() > 0
    check('담당 드롭다운 비활성 (담당 select 없음 + 안내문)', selCount === 1 && noAssignDropdown, `select=${selCount}`)

    // 날짜·상태·메모 입력 활성
    const dateInput = panel.locator('input[placeholder="YYYY-MM-DD"]').first()
    const statusSel = panel.locator('select').first()
    const notesArea = panel.locator('textarea').first()
    const dateEnabled = await dateInput.isEnabled()
    const statusEnabled = await statusSel.isEnabled()
    const notesEnabled = await notesArea.isEnabled()
    check('날짜 입력 활성', dateEnabled)
    check('상태 드롭다운 활성', statusEnabled)
    check('메모 입력 활성', notesEnabled)

    // 메모 실제 수정 → 저장 → DB 반영
    const marker = `배치메모-${Date.now()}`
    await notesArea.fill(marker)
    await panel.getByRole('button', { name: '저장' }).click()
    await page.waitForTimeout(2500)
    const a1 = await getItem(itemA)
    const saved = a1?.notes === marker
    check('메모 저장 DB 반영', saved, `notes=${a1?.notes}`)

    const ok = rowVisible && dateEnabled && statusEnabled && notesEnabled && saved && (selCount === 1)
    record('PERM-6', ok ? 'PASS' : 'FAIL',
      `행노출=${rowVisible}, 담당select=${selCount}(안내문 ${noAssignDropdown}), 날짜/상태/메모활성=${dateEnabled}/${statusEnabled}/${notesEnabled}, 메모저장='${a1?.notes}'`)
  } else {
    record('PERM-6', 'FAIL', '계획 목록에 테이블 행이 노출되지 않음')
  }

  // ══════════════════════════════════════════════════════════════
  // PERM-5: 계획 전체 범위 + 확정 (직원)
  // ══════════════════════════════════════════════════════════════
  console.log('\n===== PERM-5 =====')
  await page.goto(`${BASE}/inspection-plans?year=${YEAR}&month=${MONTH}`)
  await page.locator('tr', { has: page.getByText('TEST-배치-고객A') }).first().waitFor({ timeout: 20000 })
  const seesA = await page.getByText('TEST-배치-고객A').count() > 0
  const seesB = await page.getByText('TEST-배치-고객B').count() > 0  // 타 직원(emp2) 담당 항목
  check('직원이 본인+타직원 항목 모두 조회 (전체 범위)', seesA && seesB, `A=${seesA} B=${seesB}`)

  // 타직원(B) 항목 체크박스 선택 → 하단 확정바 → 확정
  const rowB = page.locator('tr', { has: page.getByText('TEST-배치-고객B') }).first()
  await rowB.locator('input[type=checkbox]').click()
  const confirmBtn = page.getByRole('button', { name: /확정$/ }).last()
  await confirmBtn.waitFor({ timeout: 5000 })
  await confirmBtn.click()
  await page.waitForTimeout(2500)
  const b1 = await getItem(itemB)
  const confirmed = b1?.status === 'confirmed'
  check('직원이 계획 확정 (planned→confirmed)', confirmed, `status=${b1?.status}`)
  record('PERM-5', (seesA && seesB && confirmed) ? 'PASS' : 'FAIL',
    `전체범위 조회 A=${seesA}/B=${seesB}, 확정 결과 status=${b1?.status}`)

  // ══════════════════════════════════════════════════════════════
  // MY-2: ToDo 완료 → 해제 토글 (직원)
  // ══════════════════════════════════════════════════════════════
  console.log('\n===== MY-2 =====')
  await page.goto(`${BASE}/my/todos`)
  await page.getByText('TEST-배치-투두').waitFor({ timeout: 20000 })
  // 완료 토글 — 항목 컨테이너의 첫 버튼(원형 체크)
  const todoRow = page.getByText('TEST-배치-투두').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
  await todoRow.getByRole('button').first().click()
  await page.waitForTimeout(2000)
  const t1 = await raw.from('todos').select('completed').eq('id', todoId).single()
  const doneOk = (t1.data as { completed: boolean } | null)?.completed === true
  check('완료 토글 → completed=true', doneOk)

  // 해제: '완료' 필터로 전환 후 다시 토글
  await page.getByRole('button', { name: '완료', exact: true }).click()
  await page.getByText('TEST-배치-투두').waitFor({ timeout: 10000 })
  const todoRow2 = page.getByText('TEST-배치-투두').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
  await todoRow2.getByRole('button').first().click()
  await page.waitForTimeout(2000)
  const t2 = await raw.from('todos').select('completed, completed_at').eq('id', todoId).single()
  const undoneOk = (t2.data as { completed: boolean } | null)?.completed === false
  check('해제 토글 → completed=false', undoneOk)
  record('MY-2', (doneOk && undoneOk) ? 'PASS' : 'FAIL', `완료토글=${doneOk}, 해제토글=${undoneOk}`)

  // ══════════════════════════════════════════════════════════════
  // PERM-1: 직원 고객 등록 실제 저장
  // ══════════════════════════════════════════════════════════════
  console.log('\n===== PERM-1 =====')
  const REG_NAME = `TEST-배치-신규고객-${Date.now().toString().slice(-6)}`
  await page.goto(`${BASE}/customers/new`)
  await page.locator('input[placeholder="주소 검색 후 동/호수 등 추가 입력"]').fill('경기도 양평군 양평읍 테스트로 1')
  await page.locator('input[placeholder="주소 검색 시 자동입력 또는 직접 입력"]').fill(REG_NAME)
  await page.locator('input[placeholder="YYYY-MM-DD"]').first().fill(SCHED)
  await page.locator('#contact-대표-name').fill('배치대표')
  const regBtn = page.getByRole('button', { name: '등록', exact: true }).first()
  // 고객코드 자동생성 완료까지 버튼 활성 대기
  await regBtn.waitFor()
  for (let i = 0; i < 20 && await regBtn.isDisabled(); i++) await page.waitForTimeout(500)
  const regEnabled = !(await regBtn.isDisabled())
  check('필수 입력 후 등록 버튼 활성', regEnabled)
  if (regEnabled) {
    await regBtn.click()
    await page.waitForURL(u => /\/customers\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 20000 }).catch(() => {})
  }
  await page.waitForTimeout(1500)
  const { data: reg } = await raw.from('customers').select('id, created_by, customer_name').eq('customer_name', REG_NAME).maybeSingle()
  const regRow = reg as { id: string; created_by: string; customer_name: string } | null
  if (regRow) regCustomerId = regRow.id
  const savedByEmp = !!regRow && regRow.created_by === ids.emp
  check('고객 DB 저장 + created_by=직원', savedByEmp, `created_by=${regRow?.created_by}`)
  record('PERM-1', savedByEmp ? 'PASS' : 'FAIL',
    `등록버튼활성=${regEnabled}, DB저장=${!!regRow}, created_by=직원=${savedByEmp}`)

  await browser.close(); browser = null

  // ══════════════════════════════════════════════════════════════
  // PERM-12 / AUTH-7: 배정·삭제 직접 호출 거부 (RLS 백스톱, 인증 직원 JWT)
  // ══════════════════════════════════════════════════════════════
  console.log('\n===== PERM-12 / AUTH-7 (RLS 백스톱) =====')
  const empCli = createClient(URL_, ANON)
  const { error: signErr } = await empCli.auth.signInWithPassword({ email: EMP, password: PW })
  check('직원 인증 세션 획득', !signErr, signErr?.message ?? '')

  // (1) 배정 거부 — customers.assigned_employee_id 직접 UPDATE (customer_assign, manager/admin 전용)
  await empCli.from('customers').update({ assigned_employee_id: ids.emp2 }).eq('id', custA)
  const { data: cAfter } = await raw.from('customers').select('assigned_employee_id').eq('id', custA).single()
  const assignBlocked = (cAfter as { assigned_employee_id: string | null }).assigned_employee_id === ids.emp
  check('배정 직접 호출 거부 (담당 미변경)', assignBlocked, `assignee=${(cAfter as { assigned_employee_id: string | null }).assigned_employee_id}`)

  // (2) 고객 삭제 거부 — customers 직접 DELETE (customer_delete, manager/admin 전용)
  await empCli.from('customers').delete().eq('id', custB)
  const { data: bStill } = await raw.from('customers').select('id').eq('id', custB).maybeSingle()
  const custDelBlocked = !!bStill
  check('고객 삭제 직접 호출 거부 (행 잔존)', custDelBlocked)

  // (3) 계획항목 삭제 거부 — inspection_plan_items 직접 DELETE (manager/admin 전용)
  await empCli.from('inspection_plan_items').delete().eq('id', itemA)
  const { data: iStill } = await raw.from('inspection_plan_items').select('id').eq('id', itemA).maybeSingle()
  const itemDelBlocked = !!iStill
  check('계획항목 삭제 직접 호출 거부 (행 잔존)', itemDelBlocked)

  await empCli.auth.signOut()

  record('PERM-12', (custDelBlocked && itemDelBlocked) ? 'PASS' : 'FAIL',
    `고객삭제거부=${custDelBlocked}, 계획삭제거부=${itemDelBlocked} (RLS FOR ALL manager/admin)`)
  record('AUTH-7', (assignBlocked && custDelBlocked && itemDelBlocked) ? 'PASS' : 'FAIL',
    `배정거부=${assignBlocked}, 삭제거부(고객/계획)=${custDelBlocked}/${itemDelBlocked}`)

  // ══════════════════════════════════════════════════════════════
  // FIRE-S6: B안 권한 경계 미검증분 (고객/계획 저장 + 담당 드롭다운 비활성)
  // ══════════════════════════════════════════════════════════════
  const s6ok = (results['PERM-1']?.verdict === 'PASS') && (results['PERM-6']?.verdict === 'PASS') && (results['PERM-5']?.verdict === 'PASS')
  record('FIRE-S6', s6ok ? 'PASS' : 'PARTIAL',
    `미검증분: 고객저장(PERM-1 ${results['PERM-1']?.verdict}), 계획저장/확정(PERM-5 ${results['PERM-5']?.verdict}), 담당드롭다운 비활성(PERM-6 ${results['PERM-6']?.verdict})`)

} catch (e) {
  fail++
  console.error('\nERROR:', e instanceof Error ? e.message : e)
} finally {
  if (browser) await browser.close()
  console.log('\n[정리] 테스트 데이터 삭제')
  // 계획/항목 (custA/B 및 PERM-1 신규 고객 링크 포함)
  for (const c of [custA, custB, regCustomerId].filter(Boolean)) {
    await raw.from('inspection_plan_items').delete().eq('customer_id', c)
    await raw.from('activity_logs').delete().eq('entity_id', c)
    await raw.from('customer_contacts').delete().eq('customer_id', c)
    await raw.from('buildings').delete().eq('customer_id', c)
    await raw.from('customers').delete().eq('id', c)
  }
  if (planId) {
    // 시딩으로 새로 만든 헤더면 삭제 시도(다른 항목 있으면 FK로 남음 — 무해)
    await raw.from('inspection_plans').delete().eq('id', planId).eq('created_by', ids.adm)
  }
  if (todoId) await raw.from('todos').delete().eq('id', todoId)
  for (const id of [ids.emp, ids.emp2, ids.adm].filter(Boolean)) {
    await raw.from('profiles').delete().eq('id', id)
    await raw.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log('[정리] 완료')

  console.log('\n══════════ 요약 ══════════')
  for (const [id, r] of Object.entries(results)) {
    console.log(`  ${id.padEnd(9)} ${r.verdict.padEnd(8)} ${r.evidence}`)
  }
  console.log(`\n체크: ${pass} PASS / ${fail} FAIL`)
  process.exit(0)
}
