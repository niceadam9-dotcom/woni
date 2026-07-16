/** 점검표 삭제 버튼 E2E — 삭제 성공 + 응답 참조 시 차단 (2026-07-16)
 *  실행: npx tsx scripts/test-sheet-delete.mts  (dev 서버 localhost:3000 또는 TEST_BASE_URL)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const EMAIL = 'test-sheetdel-admin@erp-test.com'
const PW = 'SheetDel1!'

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

let userId = '', customerId = '', inspectionId = ''
const sheetIds: string[] = []
let browser: import('playwright').Browser | null = null

try {
  console.log('[셋업]')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  userId = nu!.user!.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-시트삭제관리자', role: 'admin', is_active: true, employee_id: 'TEST-SDL', email: EMAIL })

  // 삭제 가능 시트 (응답 없음)
  const { data: s1 } = await raw.from('inspection_sheets').insert({
    sheet_code: 'TEST-DEL-1', sheet_name: 'TEST-삭제가능시트', version: 'v1', created_by: userId,
  }).select('id').single()
  sheetIds.push(s1!.id)
  await raw.from('inspection_sheet_items').insert({ sheet_id: s1!.id, item_code: 'TDEL-1-001', item_name: '테스트항목', order_num: 1 })

  // 차단 시트 (응답이 item_code 참조)
  const { data: s2 } = await raw.from('inspection_sheets').insert({
    sheet_code: 'TEST-DEL-2', sheet_name: 'TEST-차단시트', version: 'v1', created_by: userId,
  }).select('id').single()
  sheetIds.push(s2!.id)
  await raw.from('inspection_sheet_items').insert({ sheet_id: s2!.id, item_code: 'TDEL-2-001', item_name: '참조항목', order_num: 1 })

  const { data: cust } = await raw.from('customers').insert({
    customer_code: `TEST-SDL-${Math.random().toString(36).slice(2, 8)}`, customer_name: 'TEST-시트삭제고객',
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동', is_active: true, created_by: userId,
  }).select('id').single()
  customerId = cust!.id
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: customerId, sequence_num: 1, inspection_type: '작동', assigned_employee_id: userId,
    inspection_start_date: '2026-07-16', status: 'in_progress', created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspectionId = insp!.id
  await raw.from('inspection_sheet_responses').insert({ inspection_id: inspectionId, item_code: 'TDEL-2-001', result: 'O' })
  console.log('  셋업 완료')

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(20000)
  const dialogs: string[] = []
  page.on('dialog', d => { dialogs.push(`${d.type()}: ${d.message().slice(0, 60)}`); d.accept().catch(() => {}) })
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

  console.log('[1] 삭제 성공 경로')
  await page.goto(`${BASE}/inspection-sheets?q=TEST-삭제가능시트&active=all`)
  const row1 = page.locator('tr', { hasText: 'TEST-삭제가능시트' })
  await row1.waitFor()
  check('삭제 버튼 노출', await row1.getByRole('button', { name: '삭제' }).count() === 1)
  await row1.getByRole('button', { name: '삭제' }).click()
  await page.waitForTimeout(2000)
  check('confirm 표시', dialogs.some(d => d.startsWith('confirm')), JSON.stringify(dialogs))
  const { data: gone } = await raw.from('inspection_sheets').select('id').eq('id', sheetIds[0])
  check('DB에서 시트 삭제됨', (gone ?? []).length === 0)
  const { data: goneItems } = await raw.from('inspection_sheet_items').select('id').eq('sheet_id', sheetIds[0])
  check('항목 CASCADE 삭제됨', (goneItems ?? []).length === 0)

  console.log('[2/probe] 응답 참조 시 차단 경로')
  dialogs.length = 0
  await page.goto(`${BASE}/inspection-sheets?q=TEST-차단시트&active=all`)
  const row2 = page.locator('tr', { hasText: 'TEST-차단시트' })
  await row2.waitFor()
  await row2.getByRole('button', { name: '삭제' }).click()
  await page.waitForTimeout(2500)
  check('차단 알림 표시', dialogs.some(d => d.includes('삭제할 수 없습니다') || d.includes('비활성화')), JSON.stringify(dialogs))
  const { data: kept } = await raw.from('inspection_sheets').select('id').eq('id', sheetIds[1])
  check('차단 시트 DB 잔존', (kept ?? []).length === 1)
} catch (e) {
  fail++
  console.error('ERROR:', e instanceof Error ? e.message : e)
} finally {
  if (browser) await browser.close()
  console.log('[정리]')
  if (inspectionId) await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspectionId)
  if (inspectionId) { await raw.from('inspection_steps').delete().eq('inspection_id', inspectionId); await raw.from('inspections').delete().eq('id', inspectionId) }
  if (customerId) await raw.from('customers').delete().eq('id', customerId)
  for (const id of sheetIds) { await raw.from('inspection_sheet_items').delete().eq('sheet_id', id); await raw.from('inspection_sheets').delete().eq('id', id) }
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId).catch(() => {}) }
  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`)
  process.exit(fail > 0 ? 1 : 0)
}
