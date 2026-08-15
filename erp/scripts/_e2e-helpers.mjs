// E2E 테스트 공통 헬퍼 — 임시 계정·고객 생성/정리, 로그인 (TS-PROP 시나리오용)
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

export const raw = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
export const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'

let _pass = 0, _fail = 0
export function check(name, cond, detail = '') {
  if (cond) { _pass++; console.log(`  ✅ ${name}`) }
  else { _fail++; console.log(`  ❌ ${name} ${detail}`) }
}
export function summary() {
  console.log(`\n결과: ${_pass} 통과 / ${_fail} 실패`)
  process.exit(_fail > 0 ? 1 : 0)
}

export async function mkUser({ email, name, employeeId, role = 'admin', deptId = null }) {
  // listUsers 기본 페이지는 50명 — 전 페이지 순회로 기존 계정을 찾는다(2026-08-15 test:all 재발 교훈).
  let existing = null
  for (let page = 1; page <= 20; page++) {
    const { data: ex } = await raw.auth.admin.listUsers({ page, perPage: 1000 })
    const users = ex?.users ?? []
    for (const u of users) if (u.email === email) existing = u
    if (users.length < 1000) break
  }
  let userId = null
  if (existing) {
    const { error: dErr } = await raw.auth.admin.deleteUser(existing.id)
    if (dErr) {
      // 잔재 FK(customers.created_by 등)가 삭제를 막으면 죽지 말고 기존 계정 재사용 —
      // 비번 리셋 + 프로필 upsert로 동일 상태를 보장한다(2026-08-15 click-budget 잔재 연쇄 실측)
      await raw.auth.admin.updateUserById(existing.id, { password: PW, email_confirm: true })
      userId = existing.id
    }
  }
  if (!userId) {
    const { data: nu, error } = await raw.auth.admin.createUser({ email, password: PW, email_confirm: true })
    if (error) throw new Error(`계정 생성 실패(${email}): ${error.message}`)
    userId = nu.user.id
  }
  const { error: pErr } = await raw.from('profiles').upsert({
    id: userId, name, role, is_active: true, employee_id: employeeId, email, department_id: deptId,
  })
  if (pErr) throw new Error(`프로필 생성 실패: ${pErr.message}`)
  return userId
}
export const PW = 'E2eTest1!'

export async function delUser(id) {
  if (!id) return
  await raw.from('profiles').delete().eq('id', id)
  await raw.auth.admin.deleteUser(id).catch(() => {})
}

export async function mkCustomer(fields) {
  const { data, error } = await raw.from('customers').insert({
    customer_code: `TEST-E2E-${Math.random().toString(36).slice(2, 7)}`,
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    contract_date: '2026-01-05', is_active: true, ...fields,
  }).select('id').single()
  if (error) throw new Error(`고객 생성 실패: ${error.message}`)
  return data.id
}

export async function cleanupCustomer(id) {
  if (!id) return
  // 2회 시도 — 페이지 열람이 자동 회차 등 행을 늦게 만드는 레이스가 있어, 1차 정리 뒤에도
  // inspections가 되살아나 고객 행이 남을 수 있다(2026-08-15 click-budget 실측). 실패 시 잠깐 쉬고 재수집.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const inspIds = ((await raw.from('inspections').select('id').eq('customer_id', id)).data ?? []).map(r => r.id)
    if (inspIds.length) {
      await raw.from('inspection_sheet_responses').delete().in('inspection_id', inspIds)
      await raw.from('inspection_defects').delete().in('inspection_id', inspIds)
      await raw.from('inspection_logs').delete().in('inspection_id', inspIds)
      await raw.from('inspection_steps').delete().in('inspection_id', inspIds)
    }
    await raw.from('fire_plan_gen_jobs').delete().eq('customer_id', id)
    await raw.from('fire_plan_forms').delete().eq('customer_id', id)
    await raw.from('customer_contacts').delete().eq('customer_id', id)
    // buildings가 customers를 RESTRICT 참조 — 안 지우면 고객 행이 남아 다음 실행의 계정 삭제까지
    // 연쇄로 막는다(2026-08-15 실측: 패널저장E2E 3건이 이 경로로 잔존)
    const bldIds = ((await raw.from('buildings').select('id').eq('customer_id', id)).data ?? []).map(r => r.id)
    if (bldIds.length) {
      await raw.from('fire_facilities').delete().in('building_id', bldIds)
      await raw.from('buildings').delete().eq('customer_id', id)
    }
    await raw.from('inspection_plan_items').delete().eq('customer_id', id)
    await raw.from('inspections').delete().eq('customer_id', id)
    await raw.from('activity_logs').delete().in('entity_id', [id, ...inspIds])
    // 조용한 실패가 TEST-E2E 고객 잔재를 쌓아 왔다(2026-08-15 실측 8건) — 마지막 삭제만은 소리를 낸다
    const { error } = await raw.from('customers').delete().eq('id', id)
    if (!error) return
    if (attempt === 2) { console.error(`⚠ cleanupCustomer(${id}) 고객 행 삭제 실패: ${error.message}`); return }
    await new Promise(res => setTimeout(res, 2000))
  }
}

export async function launch() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(15000)
  return { browser, page }
}

export async function login(page, email, pw = PW) {
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', pw)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
}

/** 해당 연·월 inspection_plans id (없으면 생성, 생성 여부 반환) */
export async function ensurePlan(year, month, createdBy) {
  const { data: ep } = await raw.from('inspection_plans').select('id').eq('year', year).eq('month', month).maybeSingle()
  if (ep) return { id: ep.id, created: false }
  const { data: np } = await raw.from('inspection_plans')
    .insert({ year, month, status: 'draft', auto_generated: true, created_by: createdBy }).select('id').single()
  return { id: np.id, created: true }
}

export async function pollDb(fn, ms = 10000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const r = await fn()
    if (r) return r
    await new Promise(res => setTimeout(res, 500))
  }
  return null
}
