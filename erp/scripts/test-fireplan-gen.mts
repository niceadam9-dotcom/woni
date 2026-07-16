/** 소방계획서 표준양식 생성 E2E — 생성 버튼 → 모달 자동 채움(서식 1.2 포함) → 사진 업로드 →
 *  PDF 생성·보관함 저장 → 편집·재생성(개정 2) → 데이터 시트 다운로드 (2026-07-15)
 *  실행: $env:TEST_BASE_URL='https://staging.sjfire.co.kr'; npx tsx scripts/test-fireplan-gen.mts
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
const NAME = 'TEST-FIREPLAN-빌딩'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

let userId = '', customerId = ''
let browser: import('playwright').Browser | null = null

try {
  console.log('\n[셋업]')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`계정 생성 실패: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-계획서관리자', role: 'admin', is_active: true, employee_id: 'TEST-FPL', email: EMAIL })

  const { data: cust, error: cErr } = await raw.from('customers').insert({
    customer_code: `TEST-FPL-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: NAME, inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    plan_anchor_date: '2026-09-10', address: '경기 양평군 테스트로 9', fire_station: '양평소방서',
    is_active: true, created_by: userId,
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  customerId = (cust as { id: string }).id
  check('셋업 완료', true)

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(20000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
  check('로그인 성공', true)

  // ── 생성 모달 열기 (자동 채움 확인) — 탭 개편: 소방계획서 카드는 plan 탭 (2026-07-16) ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan`)
  await page.getByRole('button', { name: '표준양식 생성' }).click()
  await page.getByText('소방계획서 표준양식 생성').waitFor()
  check('생성 모달 표시', true)
  const nameInput = page.locator('section', { hasText: '서식 1.1' }).locator('input').first()
  check('대상물 명칭 자동 채움', (await nameInput.inputValue()) === NAME, await nameInput.inputValue())
  check('서식 1.2 화재취약장소 프리셋 (보일러실 등)', await page.locator('input[value="보일러실"]').count() === 1)

  // ── 사진 업로드 (건물 전경) ──
  const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await page.locator('input[type=file][accept=".jpg,.jpeg,.png,.webp"]').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PNG_1PX })
  await page.locator('input[placeholder="사진 설명 (캡션)"]').first().waitFor({ timeout: 20000 })
  check('사진 업로드 → 목록 표시', true)

  // ── PDF 생성 (Gotenberg 변환 포함 — 여유 대기) ──
  await page.getByRole('button', { name: /PDF 생성/ }).click()
  try {
    await page.getByText('소방계획서 표준양식 생성').waitFor({ state: 'hidden', timeout: 60000 })
  } catch (waitErr) {
    // 진단: 모달이 안 닫히면 화면의 오류 문구를 출력 (Gotenberg 미기동 등 환경 원인 식별)
    const errText = await page.locator('.text-red-500, .text-red-600, [class*="text-red"]').allInnerTexts().catch(() => [])
    console.log(`  ⚠ 모달 미닫힘 — 화면 오류: ${JSON.stringify(errText)}`)
    throw waitErr
  }
  check('생성 완료 (모달 닫힘)', true)

  // ── DB·스토리지 검증 ──
  const { data: plans } = await raw.from('fire_plans')
    .select('id, year, pdf_path, pdf_name, note, revision').eq('customer_id', customerId)
  const plan = (plans ?? [])[0] as { id: string; year: number; pdf_path: string; pdf_name: string; note: string | null; revision: number } | undefined
  check('fire_plans 행 생성', !!plan && plan.note === '표준양식 자동 생성', JSON.stringify(plan))
  check('생성분 경로 규약 (generated_)', !!plan && plan.pdf_path.includes('generated_'))
  if (plan) {
    const { data: pdfFile } = await raw.storage.from('fire-plans').download(plan.pdf_path)
    const pdfBytes = pdfFile ? new Uint8Array(await pdfFile.arrayBuffer()) : new Uint8Array()
    check('PDF 파일 존재 + PDF 시그니처', pdfBytes.length > 5000 && String.fromCharCode(...pdfBytes.slice(0, 4)) === '%PDF', `${pdfBytes.length} bytes`)
    const { data: jsonFile } = await raw.storage.from('fire-plans').download(plan.pdf_path.replace(/\.pdf$/, '.form.json'))
    check('.form.json 함께 저장', !!jsonFile)
    if (jsonFile) {
      const form = JSON.parse(await jsonFile.text()) as { photos?: Array<{ kind: string }>; hazards?: unknown[] }
      check('form.json에 사진·서식1.2 데이터 포함',
        (form.photos?.length ?? 0) === 1 && form.photos?.[0].kind === 'building' && (form.hazards?.length ?? 0) >= 3,
        JSON.stringify({ photos: form.photos?.length, hazards: form.hazards?.length }))
    }
  }

  // ── 편집 버튼 → 데이터 재로드 → 재생성 = 개정 2 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan`)
  await page.getByRole('button', { name: '편집' }).first().click()
  await page.getByText('소방계획서 표준양식 생성').waitFor()
  const nameInput2 = page.locator('section', { hasText: '서식 1.1' }).locator('input').first()
  check('편집: 저장된 양식 데이터 재로드', (await nameInput2.inputValue()) === NAME)
  check('편집: 업로드한 사진 유지', await page.locator('input[placeholder="사진 설명 (캡션)"]').count() === 1)
  await page.getByRole('button', { name: /PDF 생성/ }).click()
  await page.getByText('소방계획서 표준양식 생성').waitFor({ state: 'hidden', timeout: 60000 })
  const { data: plans2 } = await raw.from('fire_plans')
    .select('revision').eq('customer_id', customerId).order('revision', { ascending: false })
  check('재생성 = 개정 차수 2', ((plans2 ?? [])[0] as { revision: number } | undefined)?.revision === 2, JSON.stringify(plans2))

  // ── 데이터 시트 다운로드 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan`)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.getByRole('button', { name: '데이터 시트' }).click(),
  ])
  check('데이터 시트 PDF 다운로드', (download.suggestedFilename() ?? '').includes('데이터시트'), download.suggestedFilename())

  await browser.close(); browser = null
} catch (e) {
  fail++
  console.error('\n❌ 테스트 중단:', (e as Error).message)
} finally {
  if (browser) await browser.close()
  if (customerId) {
    const { data: plans } = await raw.from('fire_plans').select('pdf_path').eq('customer_id', customerId)
    const paths = ((plans ?? []) as { pdf_path: string }[]).flatMap(p => [p.pdf_path, p.pdf_path.replace(/\.pdf$/, '.form.json')])
    if (paths.length) await raw.storage.from('fire-plans').remove(paths)
    const { data: assets } = await raw.storage.from('fire-plans').list(`${customerId}/gen-assets`)
    const assetPaths = ((assets ?? []) as Array<{ name: string }>).map(a => `${customerId}/gen-assets/${a.name}`)
    if (assetPaths.length) await raw.storage.from('fire-plans').remove(assetPaths)
    await raw.from('fire_plans').delete().eq('customer_id', customerId)
    await raw.from('activity_logs').delete().eq('entity_id', customerId)
    await raw.from('customers').delete().eq('id', customerId)
    console.log('\n[정리] 고객·계획서·파일 삭제 완료')
  }
  if (userId) {
    await raw.from('profiles').delete().eq('id', userId)
    await raw.auth.admin.deleteUser(userId).catch(() => {})
    console.log('[정리] 테스트 계정 삭제 완료')
  }
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
