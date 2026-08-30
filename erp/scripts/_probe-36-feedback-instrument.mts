// 소방계획서_36 S4-4 — '화면 반영 4000ms 이내' 실패가 **제품 지연인가 계측기 오버헤드인가**
//
// 사실관계: 같은 구간(클릭 → 기록 표시)을 두 스크립트가 다르게 잰다.
//   _measure-workbench-save.mts (Playwright 대기자) → 1,923ms
//   test-step-submit-feedback.mts (250ms 폴링 + body.innerText 정규식) → 5,014ms
// body.innerText()는 이 무거운 페이지 전체 텍스트를 매 회 직렬화한다. 다만 두 스크립트가
// **다른 문자열**을 기다리므로, 같은 것을 재는지부터 증명해야 한다.
//
// 여기서는 **한 번의 클릭**을 두 방법으로 동시에 재서 차이를 계측기 탓으로 돌릴 수 있는지 본다.
// 실행: npx tsx scripts/_probe-36-feedback-instrument.mts
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const EMAIL = 'probe-fb-instrument@erp-test.com'
const PW = 'FbInst1!'
const TAG = `ZZI${Math.random().toString(36).slice(2, 6).toUpperCase()}`

let userId = '', customerId = '', inspectionId = ''
let browser: import('playwright').Browser | null = null

try {
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  userId = nu!.user!.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-계측기프로브', role: 'admin', is_active: true, employee_id: 'TEST-PFI', email: EMAIL })

  const { data: cust } = await raw.from('customers').insert({
    customer_code: `${TAG}-${Math.random().toString(36).slice(2, 7)}`, customer_name: `${TAG}계측기고객`,
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    is_active: true, created_by: userId,
  }).select('id').single()
  customerId = cust!.id
  const { data: insp } = await raw.from('inspections').insert({
    customer_id: customerId, sequence_num: 1, inspection_type: '작동', assigned_employee_id: userId,
    inspection_start_date: '2026-08-01', inspection_end_date: '2026-08-02', status: 'in_progress', created_by: userId,
  }).select('id').single()
  inspectionId = insp!.id
  await raw.from('inspection_defects').insert({
    inspection_id: inspectionId, defect_name: `${TAG}불량`, severity: '보통', action_end: '2026-08-20',
  })

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(60000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 60000 })
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.locator('text=/⑥ 이행완료/').first().waitFor()
  await page.locator('text=/⑥ 이행완료/').first().click()
  await page.waitForTimeout(1500)

  // ── body.innerText() 한 번에 얼마나 드는가 (폴링 오버헤드의 정체)
  const tIn0 = Date.now()
  for (let i = 0; i < 5; i++) await page.locator('body').innerText()
  console.log(`body.innerText() 1회 평균: ${Math.round((Date.now() - tIn0) / 5)}ms`)

  // 서버 액션 POST 왕복 단독 — 화면 반영이 이것에 갇혀 있는지 가른다
  const actionMs: number[] = []
  const started = new Map<string, number>()
  page.on('request', r => { if (r.method() === 'POST' && r.headers()['next-action']) started.set(r.url() + r.headers()['next-action'], Date.now()) })
  page.on('response', r => {
    const rq = r.request()
    if (rq.method() === 'POST' && rq.headers()['next-action']) {
      const k = rq.url() + rq.headers()['next-action']
      const t = started.get(k)
      if (t) { actionMs.push(Date.now() - t); started.delete(k) }
    }
  })

  const recordBtn = page.getByRole('button', { name: /^기록$/ }).last()
  const container = recordBtn.locator('xpath=..')
  await container.locator('input').first().fill('2026-08-18')

  // ── 한 번의 클릭을 **두 방법으로 동시에** 잰다
  const t0 = Date.now()
  // 방법 A: Playwright 대기자 — 테스트가 기다리는 **바로 그 문자열**로
  const waiterA = page.getByText('✓ 기록됨 2026-08-18 — ⑥ 완료').first()
    .waitFor({ state: 'visible' }).then(() => Date.now() - t0)
  const waiterB = page.getByText('1/6 단계').first()
    .waitFor({ state: 'visible' }).then(() => Date.now() - t0)

  await recordBtn.click()

  // 방법 B: 테스트와 **똑같은** 폴링 루프
  let pollAt: number | null = null
  const pollTask = (async () => {
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250)
      const t = await page.locator('body').innerText()
      if (/✓ 기록됨 2026-08-18 — ⑥ 완료/.test(t) && /1\/6 단계/.test(t)) { pollAt = Date.now() - t0; return }
    }
  })()

  const [aMs, bMs] = await Promise.all([waiterA, waiterB])
  await pollTask

  console.log(`\n같은 클릭 한 번을 두 방법으로:`)
  console.log(`  A 대기자 '✓ 기록됨 … ⑥ 완료' : ${aMs}ms`)
  console.log(`  A 대기자 '1/6 단계'          : ${bMs}ms`)
  console.log(`  B 테스트와 같은 폴링 루프     : ${pollAt ?? '>10000'}ms`)
  console.log(`  → 차이(계측기 오버헤드)       : ${pollAt !== null ? pollAt - Math.max(aMs, bMs) : '?'}ms`)
  console.log(`\n분해:`)
  console.log(`  서버 액션 POST 왕복 단독      : ${actionMs.join(' / ') || '-'}ms`)
  console.log(`  → 액션 이후 화면까지 남은 몫  : ${actionMs.length ? Math.max(aMs, bMs) - Math.max(...actionMs) : '?'}ms`)
} catch (e) {
  console.error('ERROR:', (e as Error).message)
} finally {
  if (browser) await browser.close()
  if (inspectionId) {
    await raw.from('inspection_defects').delete().eq('inspection_id', inspectionId)
    await raw.from('inspection_steps').delete().eq('inspection_id', inspectionId)
    await raw.from('inspections').delete().eq('id', inspectionId)
  }
  if (customerId) await raw.from('customers').delete().eq('id', customerId)
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId).catch(() => {}) }
}
