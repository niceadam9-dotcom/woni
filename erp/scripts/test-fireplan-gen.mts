/** ?뚮갑怨꾪쉷???쒖??묒떇 ?앹꽦 E2E ???앹꽦 踰꾪듉 ??紐⑤떖 ?먮룞 梨꾩? ??PDF ?앹꽦쨌蹂닿?????????몄쭛 踰꾪듉 (2026-07-14)
 *  ?ㅽ뻾: $env:TEST_BASE_URL='https://staging.sjfire.co.kr'; npx tsx scripts/test-fireplan-gen.mts
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
const EMAIL = 'test-fireplan-admin@erp-test.com'
const PW = 'FirePlanTest1!'
const NAME = 'TEST-FIREPLAN-鍮뚮뵫'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ??${name}`) }
  else { fail++; console.log(`  ??${name} ${detail}`) }
}

let userId = '', customerId = ''
let browser: import('playwright').Browser | null = null

try {
  console.log('\n[?뗭뾽]')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`怨꾩젙 ?앹꽦 ?ㅽ뙣: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-怨꾪쉷?쒓?由ъ옄', role: 'admin', is_active: true, employee_id: 'TEST-FPL', email: EMAIL })

  const { data: cust, error: cErr } = await raw.from('customers').insert({
    customer_code: `TEST-FPL-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: NAME, inspection_type: '?묐룞', inspection_category: '?뚮갑?덉쟾愿由?, inspection_sub_type: '?묐룞',
    plan_anchor_date: '2026-09-10', address: '寃쎄린 ?묓룊援??뚯뒪?몃줈 9', fire_station: '?묓룊?뚮갑??,
    is_active: true, created_by: userId,
  }).select('id').single()
  if (cErr) throw new Error(`怨좉컼 ?앹꽦 ?ㅽ뙣: ${cErr.message}`)
  customerId = (cust as { id: string }).id
  check('?뗭뾽 ?꾨즺', true)

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(20000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
  check('濡쒓렇???깃났', true)

  // ?? ?앹꽦 紐⑤떖 ?닿린 (?먮룞 梨꾩? ?뺤씤) ??
  await page.goto(`${BASE}/customers/${customerId}`)
  await page.getByRole('button', { name: '?쒖??묒떇 ?앹꽦' }).click()
  await page.getByText('?뚮갑怨꾪쉷???쒖??묒떇 ?앹꽦').waitFor()
  check('?앹꽦 紐⑤떖 ?쒖떆', true)
  const nameInput = page.locator('section', { hasText: '?쒖떇 1.1' }).locator('input').first()
  check('??곷Ъ 紐낆묶 ?먮룞 梨꾩?', (await nameInput.inputValue()) === NAME, await nameInput.inputValue())

  // ?? PDF ?앹꽦 (Gotenberg 蹂???ы븿 ???ъ쑀 ?湲? ??
  await page.getByRole('button', { name: /PDF ?앹꽦/ }).click()
  await page.getByText('?뚮갑怨꾪쉷???쒖??묒떇 ?앹꽦').waitFor({ state: 'hidden', timeout: 60000 })
  check('?앹꽦 ?꾨즺 (紐⑤떖 ?ロ옒)', true)

  // ?? DB쨌?ㅽ넗由ъ? 寃利???
  const { data: plans } = await raw.from('fire_plans')
    .select('id, year, pdf_path, pdf_name, note, revision').eq('customer_id', customerId)
  const plan = (plans ?? [])[0] as { id: string; year: number; pdf_path: string; pdf_name: string; note: string | null; revision: number } | undefined
  check('fire_plans ???앹꽦', !!plan && plan.note === '?쒖??묒떇 ?먮룞 ?앹꽦', JSON.stringify(plan))
  check('?앹꽦遺?寃쎈줈 洹쒖빟 (generated_)', !!plan && plan.pdf_path.includes('generated_'))
  if (plan) {
    const { data: pdfFile } = await raw.storage.from('fire-plans').download(plan.pdf_path)
    const pdfBytes = pdfFile ? new Uint8Array(await pdfFile.arrayBuffer()) : new Uint8Array()
    check('PDF ?뚯씪 議댁옱 + PDF ?쒓렇?덉쿂', pdfBytes.length > 5000 && String.fromCharCode(...pdfBytes.slice(0, 4)) === '%PDF', `${pdfBytes.length} bytes`)
    const { data: jsonFile } = await raw.storage.from('fire-plans').download(plan.pdf_path.replace(/\.pdf$/, '.form.json'))
    check('.form.json ?④퍡 ???, !!jsonFile)
  }

  // ?? ?몄쭛 踰꾪듉 ???곗씠???щ줈?????ъ깮??= 媛쒖젙 2 ??
  await page.goto(`${BASE}/customers/${customerId}`)
  await page.getByRole('button', { name: '?몄쭛' }).first().click()
  await page.getByText('?뚮갑怨꾪쉷???쒖??묒떇 ?앹꽦').waitFor()
  const nameInput2 = page.locator('section', { hasText: '?쒖떇 1.1' }).locator('input').first()
  check('?몄쭛: ??λ맂 ?묒떇 ?곗씠???щ줈??, (await nameInput2.inputValue()) === NAME)
  await page.getByRole('button', { name: /PDF ?앹꽦/ }).click()
  await page.getByText('?뚮갑怨꾪쉷???쒖??묒떇 ?앹꽦').waitFor({ state: 'hidden', timeout: 60000 })
  const { data: plans2 } = await raw.from('fire_plans')
    .select('revision').eq('customer_id', customerId).order('revision', { ascending: false })
  check('?ъ깮??= 媛쒖젙 李⑥닔 2', ((plans2 ?? [])[0] as { revision: number } | undefined)?.revision === 2, JSON.stringify(plans2))

  await browser.close(); browser = null
} catch (e) {
  fail++
  console.error('\n???뚯뒪??以묐떒:', (e as Error).message)
} finally {
  if (browser) await browser.close()
  if (customerId) {
    const { data: plans } = await raw.from('fire_plans').select('pdf_path').eq('customer_id', customerId)
    const paths = ((plans ?? []) as { pdf_path: string }[]).flatMap(p => [p.pdf_path, p.pdf_path.replace(/\.pdf$/, '.form.json')])
    if (paths.length) await raw.storage.from('fire-plans').remove(paths)
    await raw.from('fire_plans').delete().eq('customer_id', customerId)
    await raw.from('activity_logs').delete().eq('entity_id', customerId)
    await raw.from('customers').delete().eq('id', customerId)
    console.log('\n[?뺣━] 怨좉컼쨌怨꾪쉷?쑣룻뙆????젣 ?꾨즺')
  }
  if (userId) {
    await raw.from('profiles').delete().eq('id', userId)
    await raw.auth.admin.deleteUser(userId).catch(() => {})
    console.log('[?뺣━] ?뚯뒪??怨꾩젙 ??젣 ?꾨즺')
  }
}

console.log(`\n寃곌낵: ${pass} ?듦낵 / ${fail} ?ㅽ뙣`)
process.exit(fail > 0 ? 1 : 0)
