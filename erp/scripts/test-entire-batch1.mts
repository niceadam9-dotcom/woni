// 권한 경계 E2E — 화면 게이트 + RLS 백스톱 (2026-07-16 신설 → 2026-09-13 전면 재작성)
//
// 왜 이 검사가 있나: B안(2026-07-08)은 「업무 수행은 전 직원, 돈·삭제·담당 배정은 매니저 이상」이다.
// 그 경계는 두 겹으로 지켜진다 — ① 화면이 창구를 안 그린다 ② 그래도 직접 부르면 RLS가 막는다.
// ②가 알맹이다: 서버 액션은 공개 엔드포인트고 PostgREST는 브라우저에서 그대로 부를 수 있으므로,
// 화면만 잠그면 잠근 게 아니다.
//
// ⚠ 2026-09-13 재작성 — 종전 판은 점검확정 화면(/inspection-plans)의 슬라이드 패널을 봤는데
//   그 화면이 폐지되며(지금은 /inspections/calendar로 redirect) 검사 절반이 죽었다. 그리고
//   셋업이 `status:'planned'`로 계획 항목을 심어 **첫 insert에서 22P02로 죽었다** —
//   점검확정 폐지(마이그 161·162)로 그 enum 값 자체가 사라졌기 때문이다(전건 confirmed로 태어난다).
//
//   버린 단언과 이유:
//    · 「슬라이드 패널 담당 드롭다운 비활성 / 날짜·상태·메모 입력 활성 / 메모 저장」
//      → 패널이 있던 화면이 없다. 메모·상태 칸은 승계 화면(달력)에 대응 창구가 없다 —
//        없어진 화면의 계약이라 억지로 되살리지 않는다. 다만 **담당 배정 창구가 고객관리
//        하나뿐이고 직원에겐 잠겨 있다**는 알맹이는 살아 있어 [2][4]로 옮겨 다시 걸었다.
//    · 「직원이 계획을 planned→confirmed로 확정」 → 확정 절차 자체가 폐지됐다(계약 소멸).
//
//   살린 것: 조회 범위(B안)·고객 등록(전 직원)·RLS 3종. 그리고 **양성 짝을 새로 붙였다** —
//   종전엔 「직원이 하면 막힌다」만 물어서, 그 호출이 애초에 아무 일도 안 하는(오타난 id 등)
//   경우에도 초록이었다. 같은 호출을 관리자 세션으로 한 번 더 해서 「되는 사람은 된다」를 함께 잰다.
//
// 판정은 전부 이 실행이 심은 TAG 행으로 좁힌다. 실행: npx tsx scripts/test-entire-batch1.mts
import { createClient } from '@supabase/supabase-js'
import type { Page } from 'playwright'
import { SUPABASE_URL, ANON_KEY } from './_env.mjs'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, PW, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, ensurePlan } from './_e2e-helpers.mjs'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const TAG = `ZPM${SUF}`
const EMP = `perm.emp.${SUF}@e2e.test`
const EMP2 = `perm.emp2.${SUF}@e2e.test`
const ADM = `perm.adm.${SUF}@e2e.test`

// KST 오늘 — 달력 표시 판정을 '지연' 배지 등 다른 축에 오염시키지 않으려고 오늘로 고정한다
const now = new Date(Date.now() + 9 * 3600_000)
const Y = now.getUTCFullYear(), M = now.getUTCMonth() + 1, DAY = now.getUTCDate()
const D = `${Y}-${String(M).padStart(2, '0')}-${String(DAY).padStart(2, '0')}`

const ids = { emp: '', emp2: '', adm: '' }
const custIds: string[] = []
let custA = '', custB = '', custC = '', itemA = '', itemC = ''
let regCustomerId = ''
let todoId = ''
let planId = '', planCreated = false
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

async function seed(name: string, emp: string | null) {
  const full = `${TAG}${name}`
  const cid = await mkCustomer({
    customer_name: full, inspection_type: '일반관리', inspection_category: '일반관리',
    inspection_sub_type: '작동', created_by: ids.adm, assigned_employee_id: emp,
    plan_anchor_date: D, fire_station: '양평소방서',
  })
  custIds.push(cid)
  return { cid, full }
}
async function seedItem(cid: string, emp: string | null) {
  const { data, error } = await raw.from('inspection_plan_items').insert({
    plan_id: planId, customer_id: cid, inspection_type: '일반관리',
    inspection_category: '일반관리', inspection_sub_type: '작동',
    plan_type: 'event', sequence_num: 1,
    // 전건 confirmed로 태어난다 — 'planned'는 마이그 161·162로 enum에서 사라졌다(넣으면 22P02)
    planned_date: D, scheduled_date: D, status: 'confirmed', assigned_employee_id: emp,
  }).select('id').single()
  if (error) throw new Error(`계획 항목 시드 실패: ${error.message}`)
  return (data as { id: string }).id
}

try {
  // ── 셋업 ──────────────────────────────────────────────────────────────────
  ids.adm  = await mkUser({ email: ADM,  name: `권한관리자${SUF}`, employeeId: `PM-A${SUF}`, role: 'admin' })
  ids.emp  = await mkUser({ email: EMP,  name: `권한직원${SUF}`,   employeeId: `PM-E${SUF}`, role: 'employee' })
  ids.emp2 = await mkUser({ email: EMP2, name: `권한직원2${SUF}`,  employeeId: `PM-F${SUF}`, role: 'employee' })

  const plan = await ensurePlan(Y, M, ids.adm)
  planId = plan.id; planCreated = plan.created

  const a = await seed('고객A', ids.emp);  custA = a.cid
  const b = await seed('고객B', ids.emp2); custB = b.cid
  const c = await seed('고객C', ids.emp);  custC = c.cid    // [5] 양성 짝(관리자 삭제)용 소모품
  itemA = await seedItem(custA, ids.emp)
  await seedItem(custB, ids.emp2)
  itemC = await seedItem(custC, ids.emp)

  const { data: todo, error: tErr } = await raw.from('todos').insert({
    employee_id: ids.emp, title: `${TAG}투두`, priority: '보통', completed: false,
  }).select('id').single()
  if (tErr) throw new Error(`투두 시드 실패: ${tErr.message}`)
  todoId = (todo as { id: string }).id

  const l = await launch(); browser = l.browser
  const page: Page = l.page
  page.setDefaultTimeout(20000)
  let lastAlert = ''
  page.on('dialog', d => { lastAlert = d.message(); d.accept().catch(() => {}) })
  void lastAlert

  const openCalendar = async () => {
    await page.goto(`${BASE}/inspections/calendar`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(600)
    await page.getByTestId('cal-customer-search').fill(TAG)
    await page.waitForTimeout(500)
    // 일반(event) 탭 — 시드가 전부 event다. 탭을 고정해야 남의 정기 건이 섞이지 않는다
    await page.getByRole('button', { name: '일반', exact: true }).click()
    await page.waitForTimeout(600)
  }
  const seen = async (name: string) => await page.locator(`text=${name}`).count()

  await login(page, EMP, PW)

  // ══ [1] 조회 범위(B안) — 직원도 전 범위를 볼 수 있지만, **기본은 본인 담당만** ══════════
  //   client :370 — role==='employee'이면 selectedEmployeeIds 초깃값이 본인 하나다.
  //   이 두 줄이 한 쌍이어야 의미가 있다: 「전부 보인다」만 재면 기본값 규약이 죽어도 초록이고,
  //   「본인 것만 보인다」만 재면 조회 자체가 막혀 있어도 초록이다.
  console.log('\n[1] 직원 세션 — 계획 조회 범위')
  await openCalendar()
  const aSeen = await seen(a.full)
  check('전제: 이 실행의 시드가 달력에 실렸다(본인 담당 A)', aSeen > 0, `A=${aSeen}`)
  check('[음성] 기본 상태에서 타직원(emp2) 담당 B는 안 보인다 — 기본은 본인 담당',
    await seen(b.full) === 0)
  // 필터 팝오버의 [전체] — ⚠ 화면에 「전체」 버튼이 둘이다(계획유형 탭 + 직원 필터).
  //   직원 필터의 것은 [해제] 바로 앞 형제 버튼이라 그것으로 특정한다.
  await page.getByRole('button', { name: '필터' }).click()
  await page.waitForTimeout(300)
  await page.locator('button:has-text("해제")').locator('xpath=preceding-sibling::button[1]').click()
  await page.waitForTimeout(700)
  check('★ [전체]로 넓히면 타직원 담당 B도 보인다 — 조회는 전 범위(B안)', await seen(b.full) > 0)
  check('본인 담당 A는 그대로 남는다', await seen(a.full) > 0)

  // ══ [2] 담당 배정 창구는 고객관리 하나뿐 — 직원에겐 잠겨 있다 ═════════════════════
  //   종전엔 점검확정 패널에 「담당 select 없음 + '고객관리에서 변경' 안내」로 걸려 있던 축이다.
  //   그 화면이 사라졌으니 원래의 단일 창구(assign-employee-inline)에서 같은 것을 묻는다.
  //   ⚠ 「감춘다」가 아니라 「잠근다」이다 — 이름은 보여야 한다(누가 담당인지는 알아야 일한다).
  console.log('\n[2] 직원 세션 — 담당 배정·삭제 창구')
  await page.goto(`${BASE}/customers/${custA}`)
  await page.getByText('담당직원').first().waitFor()
  const empSelects = await page.locator('select').filter({ has: page.locator('option:text-is("미배정")') }).count()
  check('[음성] 직원에게는 담당 배정 드롭다운이 없다', empSelects === 0, `select=${empSelects}`)
  check('담당 이름은 읽기 전용으로 보인다(감춘 게 아니라 잠갔다)',
    await page.getByText(`권한직원${SUF}`, { exact: false }).count() > 0)

  await page.goto(`${BASE}/customers?q=${encodeURIComponent(TAG)}&active=all`)
  const rowA = page.locator('tr', { has: page.getByText(a.full) }).first()
  await rowA.waitFor()
  check('[음성] 직원에게는 [삭제] 버튼이 없다', await page.locator(`button[title="${a.full} 삭제"]`).count() === 0)

  // ══ [3] 고객 등록은 전 직원 (customer_manage) ═════════════════════════════════
  console.log('\n[3] 직원 세션 — 고객 등록')
  const REG_NAME = `${TAG}신규`
  await page.goto(`${BASE}/customers/new`)
  await page.locator('input[placeholder="주소 검색 후 동/호수 등 추가 입력"]').fill('경기도 양평군 양평읍 테스트로 1')
  await page.locator('input[placeholder="주소 검색 시 자동입력 또는 직접 입력"]').fill(REG_NAME)
  // 날짜 칸은 **id로** 잡는다 — 2026-09-23 등록 화면 재배치로 순서가 사용승인일·점검일자로 바뀌었고
  // 계약일은 접힌 ④ 안이라 안 그려진다(순번으로 잡으면 조용히 엉뚱한 칸을 채운다)
  await page.locator('#new-anchor-date').fill(D)
  await page.locator('#new-use-approval').fill('2015-05-20')
  await page.locator('#contact-대표-name').fill('배치대표')
  const regBtn = page.getByRole('button', { name: /고객 등록|고객코드 생성 중|필수 항목을 채워주세요/ }).first()
  await regBtn.waitFor()
  // 고객코드 자동생성이 끝나야 버튼이 열린다
  for (let i = 0; i < 20 && await regBtn.isDisabled(); i++) await page.waitForTimeout(500)
  const regEnabled = !(await regBtn.isDisabled())
  check('필수 입력이 다 차면 [고객 등록]이 열린다', regEnabled, await regBtn.innerText())
  if (regEnabled) {
    await regBtn.click()
    await page.waitForURL(u => /\/customers\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 25000 }).catch(() => {})
  }
  await page.waitForTimeout(1500)
  const { data: reg } = await raw.from('customers')
    .select('id, created_by').eq('customer_name', REG_NAME).maybeSingle()
  const regRow = reg as { id: string; created_by: string } | null
  if (regRow) { regCustomerId = regRow.id; custIds.push(regRow.id) }
  check('★ 직원이 등록한 고객이 DB에 남고 created_by=그 직원', !!regRow && regRow.created_by === ids.emp,
    `created_by=${regRow?.created_by ?? '(행 없음)'}`)

  // ══ [4] ToDo 완료 ↔ 해제 (본인 것) ══════════════════════════════════════════
  console.log('\n[4] 직원 세션 — 내 할 일 토글')
  await page.goto(`${BASE}/my/todos`)
  await page.getByText(`${TAG}투두`).waitFor()
  const todoRow = () => page.getByText(`${TAG}투두`).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
  await todoRow().getByRole('button').first().click()
  await page.waitForTimeout(2000)
  const t1 = await raw.from('todos').select('completed').eq('id', todoId).single()
  check('완료 토글 → completed=true', (t1.data as { completed: boolean } | null)?.completed === true)
  await page.getByRole('button', { name: '완료', exact: true }).click()
  await page.getByText(`${TAG}투두`).waitFor()
  await todoRow().getByRole('button').first().click()
  await page.waitForTimeout(2000)
  const t2 = await raw.from('todos').select('completed').eq('id', todoId).single()
  check('[음성] 해제 토글 → completed=false (편도가 아니다)',
    (t2.data as { completed: boolean } | null)?.completed === false)

  // ══ [5] 관리자 세션 — 같은 자리의 양성 짝 ═══════════════════════════════════
  //   [1][2]가 「직원에겐 없다」만 재면, 그 자리가 **아무에게도 없는**(=기능이 통째로 삭제된)
  //   상태에서도 전부 초록이다. 그래서 같은 화면을 관리자로 한 번 더 연다.
  console.log('\n[5] 관리자 세션 — 양성 짝')
  await page.context().clearCookies()   // 로그아웃 라우트는 없다 — 세션 쿠키를 버리고 다시 로그인한다
  await login(page, ADM, PW)

  await openCalendar()
  check('[양성] 관리자는 기본 상태에서 전 직원 담당이 보인다(A·B 둘 다)',
    await seen(a.full) > 0 && await seen(b.full) > 0)

  await page.goto(`${BASE}/customers/${custA}`)
  await page.getByText('담당직원').first().waitFor()
  const admSelects = await page.locator('select').filter({ has: page.locator('option:text-is("미배정")') }).count()
  check('[양성] 관리자에게는 담당 배정 드롭다운이 있다', admSelects > 0, `select=${admSelects}`)

  await page.goto(`${BASE}/customers?q=${encodeURIComponent(TAG)}&active=all`)
  await page.locator('tr', { has: page.getByText(a.full) }).first().waitFor()
  check('[양성] 관리자에게는 [삭제] 버튼이 있다', await page.locator(`button[title="${a.full} 삭제"]`).count() > 0)

  await browser.close(); browser = null

  // ══ [6] RLS 백스톱 — 화면을 거치지 않고 직접 부른다 ══════════════════════════
  //   이 파일의 알맹이. 화면 게이트는 우회할 수 있고(서버 액션·PostgREST는 공개 엔드포인트),
  //   그때 남는 유일한 방어선이 여기다.
  //   ⚠ PostgREST의 RLS 거절은 **오류가 아니라 0행 영향**으로 오는 경우가 많다(UPDATE/DELETE).
  //     그래서 반환 error가 아니라 **DB 실측**으로 판정한다.
  console.log('\n[6] RLS 백스톱 — 직접 호출')
  const empCli = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signErr } = await empCli.auth.signInWithPassword({ email: EMP, password: PW })
  check('전제: 직원 인증 세션을 얻었다(익명이 아니라 로그인한 직원으로 시험한다)', !signErr, signErr?.message ?? '')

  await empCli.from('customers').update({ assigned_employee_id: ids.emp2 }).eq('id', custA)
  const assignee = ((await raw.from('customers').select('assigned_employee_id').eq('id', custA).single())
    .data as { assigned_employee_id: string | null }).assigned_employee_id
  check('[음성] 직원의 담당 배정 직접 UPDATE 거부 (customer_assign)', assignee === ids.emp, `assignee=${assignee}`)

  await empCli.from('customers').delete().eq('id', custB)
  check('[음성] 직원의 고객 DELETE 거부 (customer_delete)',
    !!(await raw.from('customers').select('id').eq('id', custB).maybeSingle()).data)

  await empCli.from('inspection_plan_items').delete().eq('id', itemA)
  check('[음성] 직원의 계획항목 DELETE 거부',
    !!(await raw.from('inspection_plan_items').select('id').eq('id', itemA).maybeSingle()).data)
  await empCli.auth.signOut()

  // 양성 짝 — 같은 호출이 관리자 세션에서는 통한다.
  // 이게 없으면 위 셋은 「요청이 애초에 아무 데도 안 닿았다」와 구별되지 않는다.
  const admCli = createClient(SUPABASE_URL, ANON_KEY)
  const { error: aSignErr } = await admCli.auth.signInWithPassword({ email: ADM, password: PW })
  check('전제: 관리자 인증 세션을 얻었다', !aSignErr, aSignErr?.message ?? '')

  await admCli.from('customers').update({ assigned_employee_id: ids.emp2 }).eq('id', custA)
  const assignee2 = ((await raw.from('customers').select('assigned_employee_id').eq('id', custA).single())
    .data as { assigned_employee_id: string | null }).assigned_employee_id
  check('[양성] 관리자의 담당 배정 직접 UPDATE는 통한다', assignee2 === ids.emp2, `assignee=${assignee2}`)
  await raw.from('customers').update({ assigned_employee_id: ids.emp }).eq('id', custA)

  await admCli.from('inspection_plan_items').delete().eq('id', itemC)
  check('[양성] 관리자의 계획항목 DELETE는 통한다',
    !(await raw.from('inspection_plan_items').select('id').eq('id', itemC).maybeSingle()).data)

  await admCli.from('customers').delete().eq('id', custC)
  check('[양성] 관리자의 고객 DELETE는 통한다',
    !(await raw.from('customers').select('id').eq('id', custC).maybeSingle()).data)
  await admCli.auth.signOut()
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (todoId) await raw.from('todos').delete().eq('id', todoId)
  for (const cid of custIds) if (cid) await cleanupCustomer(cid)
  if (planCreated && planId) await raw.from('inspection_plans').delete().eq('id', planId)
  for (const id of [ids.emp, ids.emp2, ids.adm]) if (id) await delUser(id)
  void regCustomerId
}
summary()
