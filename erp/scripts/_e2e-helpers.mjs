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
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if (u.email === email) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error } = await raw.auth.admin.createUser({ email, password: PW, email_confirm: true })
  if (error) throw new Error(`계정 생성 실패(${email}): ${error.message}`)
  const { error: pErr } = await raw.from('profiles').upsert({
    id: nu.user.id, name, role, is_active: true, employee_id: employeeId, email, department_id: deptId,
  })
  if (pErr) throw new Error(`프로필 생성 실패: ${pErr.message}`)
  return nu.user.id
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
  const inspIds = ((await raw.from('inspections').select('id').eq('customer_id', id)).data ?? []).map(r => r.id)
  if (inspIds.length) {
    await raw.from('inspection_logs').delete().in('inspection_id', inspIds)
    await raw.from('inspection_steps').delete().in('inspection_id', inspIds)
  }
  await raw.from('inspection_plan_items').delete().eq('customer_id', id)
  await raw.from('inspections').delete().eq('customer_id', id)
  await raw.from('activity_logs').delete().in('entity_id', [id, ...inspIds])
  await raw.from('customers').delete().eq('id', id)
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
