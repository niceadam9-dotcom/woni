// B4 1단계 E2E — 점검 작업대 ④ 칸 「소민터용 한글파일」 → 실제 내려받은 HWPX의 zip·자리표시자·고지.
// 라우트는 읽기 전용이라 스테이징 기존 자체점검 1건을 쓴다(심는 것은 검증 사용자 하나, 끝에 지운다).
// 실행: npx tsx scripts/test-somin-hwpx-e2e.mts   (dev 서버 기동 상태, BASE=localhost:3000)
import { readFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import JSZip from 'jszip'
import { raw, BASE, check, summary, mkUser, delUser, launch, login, pollDb } from './_e2e-helpers.mjs'

const email = `e2e-b4-${Date.now()}@test.local`
let userId: string | null = null
let browser: { close: () => Promise<void> } | null = null
// [3]이 바꾼 소민터 등록 두 열 — 끝에 원래 값으로 되돌린다(실데이터를 남기지 않는다)
let savedSomin: { id: string; somin_name: string | null; somin_address: string | null } | null = null
try {
  // 대상 — 자체점검(작동·종합) 최신 1건. 이름은 파일명·본문 대조에 쓴다
  const { data: insp, error } = await raw.from('inspections')
    .select('id, year, customer_id, customers:customer_id(customer_name)')
    .like('plan_type', 'special_%').order('inspection_start_date', { ascending: false }).limit(1).single()
  if (error || !insp) throw new Error(`대상 점검 조회 실패: ${error?.message}`)
  const target = insp as unknown as { id: string; year: number; customer_id: string; customers: { customer_name: string } | null }
  const custName = target.customers?.customer_name ?? ''
  console.log(`대상: ${target.id} ${custName}`)

  console.log('\n[1] 무인증 — 라우트가 직접 막는다')
  const anon = await fetch(`${BASE}/inspections/${target.id}/hwpx`, { redirect: 'manual' })
  check('1-1 로그인 없으면 401(또는 로그인으로 돌림)', anon.status === 401 || (anon.status >= 300 && anon.status < 400), String(anon.status))

  userId = await mkUser({ email, name: 'B4 검증', employeeId: `B4-${Date.now() % 100000}`, role: 'admin' })
  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, email)
  await page.goto(`${BASE}/inspections/${target.id}`, { waitUntil: 'networkidle' })

  console.log('\n[2] ④ 칸 버튼 → 내려받기')
  // ④는 법정 의무라 단계 막대에 늘 있다 — 칩을 눌러 그 칸을 연다
  await page.getByTestId('workbench-stepbar').getByRole('button', { name: /소방서 제출/ }).click()
  const btn = page.getByTestId('somin-hwpx')
  await btn.waitFor({ timeout: 15000 }).catch(() => {})
  check('2-1 버튼이 소방민원센터 입구 옆에 있다', await btn.count() === 1 && await page.getByTestId('somin-link').count() === 1)
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), btn.click()])
  const name = dl.suggestedFilename()
  check('2-2 파일 이름 = 고객명_별지9호_소민터_연도.hwpx', name === `${custName}_별지9호_소민터_${target.year}.hwpx`, name)
  const path = join(mkdtempSync(join(tmpdir(), 'hwpx-')), 'f.hwpx'); await dl.saveAs(path)
  const z = await JSZip.loadAsync(readFileSync(path))
  const names = Object.keys(z.files)
  check('2-3 HWPX 구조(mimetype 첫 항목·section0 존재)', names[0] === 'mimetype' && !!z.file('Contents/section0.xml'))
  check('2-4 mimetype = application/hwp+zip', (await z.file('mimetype')!.async('string')) === 'application/hwp+zip')
  const xml = await z.file('Contents/section0.xml')!.async('string')
  check('2-5 남은 자리표시자 0', !/\{\{[a-z0-9_]+\}\}/.test(xml))
  const esc = custName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  check('2-6 본문에 대상물 명칭', !!custName && xml.includes(esc))
  const notice = page.getByTestId('somin-hwpx-notice')
  await notice.waitFor({ timeout: 10000 })
  const nt = (await notice.textContent()) ?? ''
  check('2-7 고지 — 명칭·소재지 일치 주의가 맨 앞', nt.includes('한글파일 고지: 소민터에 등록된 대상물 명칭·소재지'), nt.slice(0, 80))
  check('2-8 고지 — 4~7쪽 빈 서식 안내', nt.includes('4~7쪽'), nt.slice(0, 200))
  check('2-9 오류 문구 없음', await page.getByTestId('somin-hwpx-error').count() === 0)

  console.log('\n[3] 175 소민터 등록 명칭·소재지 — 고객 정보에서 적으면 한글파일만 그 값으로')
  const { data: before } = await raw.from('customers').select('somin_name, somin_address, customer_name, address').eq('id', target.customer_id).single()
  savedSomin = { id: target.customer_id, ...(before as { somin_name: string | null; somin_address: string | null }) }
  const SN = `소민터등록명-${Date.now() % 100000}`, SA = '경기도 양평군 양평읍 소민터로 1'
  await page.goto(`${BASE}/customers/${target.customer_id}`, { waitUntil: 'networkidle' })
  const row = page.getByTestId('info-somin-registered')
  check('3-1 고객 정보에 「소민터 등록」 줄', await row.count() === 1)
  await page.locator('#cf-somin-name').fill(SN)
  await page.locator('#cf-somin-address').fill(SA)
  await page.getByTestId('info-save').click()
  const saved = await pollDb(async () => {
    const { data } = await raw.from('customers').select('somin_name, somin_address').eq('id', target.customer_id).single()
    const r = data as { somin_name: string | null; somin_address: string | null }
    return r.somin_name === SN && r.somin_address === SA ? r : null
  })
  check('3-2 저장 → DB 두 열', !!saved)
  const { data: after } = await raw.from('customers').select('customer_name, address').eq('id', target.customer_id).single()
  check('3-3 고객명·주소는 그대로', JSON.stringify(after) === JSON.stringify({ customer_name: (before as { customer_name: string }).customer_name, address: (before as { address: string }).address }))
  await page.goto(`${BASE}/inspections/${target.id}`, { waitUntil: 'networkidle' })
  await page.getByTestId('workbench-stepbar').getByRole('button', { name: /소방서 제출/ }).click()
  await page.getByTestId('somin-hwpx').waitFor({ timeout: 15000 })
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByTestId('somin-hwpx').click()])
  check('3-4 파일 이름은 사내 고객명 그대로', dl2.suggestedFilename() === name, dl2.suggestedFilename())
  const path2 = join(mkdtempSync(join(tmpdir(), 'hwpx-')), 'g.hwpx'); await dl2.saveAs(path2)
  const xml2 = await (await JSZip.loadAsync(readFileSync(path2))).file('Contents/section0.xml')!.async('string')
  check('3-5 명칭·소재지 칸 = 소민터 등록값', xml2.includes(SN) && xml2.includes(SA))
  check('3-6 사내 고객명은 명칭 칸에서 빠짐', !xml2.includes(`>${esc}<`) && !xml2.includes(`${esc}</hp:t>`), esc)
  await page.getByTestId('somin-hwpx-notice').waitFor({ timeout: 10000 })
  const nt2 = (await page.getByTestId('somin-hwpx-notice').textContent()) ?? ''
  check('3-7 고지 — 소민터 등록값으로 인쇄', nt2.includes(`소민터 등록값으로 인쇄: 명칭 「${SN}」·소재지 「${SA}」`), nt2.slice(0, 120))
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  await browser?.close()
  if (savedSomin) {
    const { error } = await raw.from('customers').update({ somin_name: savedSomin.somin_name, somin_address: savedSomin.somin_address }).eq('id', savedSomin.id)
    check('정리 — 소민터 등록 두 열 원래 값으로', !error, error?.message)
  }
  if (userId) await delUser(userId)
}
summary()
