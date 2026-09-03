/** 1.4 「기타」 블록 라이브 검증 (2026-09-03 사용자 지시) — 체크 → 저장 → 점검표 딥링크.
 *
 *  이 축의 계약: **1.4 체크는 '해당한다'는 사실이고, 결과(○/×/／)는 점검표에서 받는다.**
 *  체크가 STD-31·EXT-10~14의 설치 축이 되므로 체크하는 순간 39의 필수 입력 강제가 붙는다.
 *
 *  대상: 별그리다(추모공원) — 진행 중 자체점검 회차가 있어 링크(canInputResult)가 그려진다.
 *  ⚠ 쓰기 검사다(fire_facilities). 원상 복구를 finally에서 **DB로 직접** 되돌린다 —
 *     화면 조작으로 되돌리면 그 조작이 실패했을 때 잔재가 남는다.
 *
 *  실행: npx tsx scripts/_probe-form14-etc.mts  (dev 서버 필요) */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'

for (const line of readFileSync(path.join(import.meta.dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const raw = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const EMAIL = 'form14-etc-e2e@erp-test.com'
const PW = 'EtcAxis39!'
const ETC7 = ['방화문 및 방화셔터', '비상구 및 피난통로', '방염',
  '위험물 저장·취급시설', '화기시설', '가연성 가스시설', '전기시설']
const TARGET = '방염'   // 짧은 어휘 = 퍼지 폴백에 가장 취약했던 코드를 일부러 고른다

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`); ok ? pass++ : fail++
}

let browser: Browser | null = null
let userId = ''
let buildingId = ''
try {
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`계정 생성 실패: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST기타39', role: 'admin', is_active: true, employee_id: 'E2E-ETC', email: EMAIL })

  const { data: custs, error: cErr } = await raw.from('customers').select('id').eq('customer_name', '별그리다(추모공원)')
  if (cErr || (custs ?? []).length !== 1) throw new Error(`대상 고객 조회 실패: ${cErr?.message}`)
  const custId = (custs as Array<{ id: string }>)[0].id

  // 기준선 — 이 건물의 기타 행이 원래 없어야 한다(있으면 이 검사가 무의미하고 복구도 위험)
  const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', custId).eq('is_active', true)
  buildingId = ((blds ?? []) as Array<{ id: string }>)[0]?.id ?? ''
  const { data: pre } = await raw.from('fire_facilities').select('facility_code').eq('building_id', buildingId).in('facility_code', ETC7)
  check('기준선 — 기타 행 0건(체크 전)', (pre ?? []).length === 0, `${(pre ?? []).length}건`)

  browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
  page.setDefaultTimeout(30_000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(x => !x.pathname.includes('/login'))

  await page.goto(`${BASE}/customers/${custId}`)
  await page.click('text=소방계획서')
  await page.click('button:has-text("1.4 소방시설")')
  await page.waitForSelector('text=서식 1.4 소방시설 현황')

  // ── ① 블록·체크박스 실재 ────────────────────────────────────────────────
  const block = page.locator('[data-testid="form14-etc"]')
  await block.waitFor({ timeout: 15_000 })
  check('「기타」 블록이 1.4 하단에 있다', await block.isVisible())
  for (const code of ETC7) {
    check(`체크박스 '${code}'`, await block.locator(`[data-testid="form14-check-${code}"]`).count() === 1)
  }
  const txt = (await block.textContent()) ?? ''
  check('안내가 "결과는 점검표에서"를 말한다', txt.includes('점검 결과') && txt.includes('점검표에서'))

  // ── ② 음성 대조 — 미체크면 입력 링크가 없다 ──────────────────────────────
  check(`미체크 상태에선 '${TARGET}' 링크 없음`,
    await page.locator(`[data-testid="form14-etc-link-${TARGET}"]`).count() === 0)

  // ── ③ 체크 → 링크 등장 → 딥링크 계약 ────────────────────────────────────
  await block.locator(`[data-testid="form14-check-${TARGET}"]`).click()
  const link = page.locator(`[data-testid="form14-etc-link-${TARGET}"]`)
  await link.waitFor({ timeout: 15_000 })
  const href = await link.getAttribute('href')
  check('체크하면 점검표 링크가 생긴다', !!href, href ?? '(없음)')
  check('딥링크 계약 — /sheet?facility=&from=',
    !!href && /\/inspections\/[0-9a-f-]+\/sheet\?facility=/.test(href) && href.includes('from='), href ?? '')

  // ── ④ 저장 → DB 영속 ───────────────────────────────────────────────────
  // 「기타」 체크는 설비 대장 패널을 열지 않아야 한다 — 세부제원 섹션이 없을뿐더러 그 패널이
  // 전면 오버레이(fixed inset-0 z-40)라 [저장]을 가려 **저장 자체가 막힌다**(수리 전 실측).
  // ⚠ 패널 컨테이너는 **항상 마운트**돼 있다(plan-form14.tsx:378 주석) — count로 재면 늘 1이라
  //    닫힘/열림을 구별하지 못한다. 패널 안의 버튼이 실제로 보이는지로 판정한다.
  check('기타 체크가 설비 대장 패널을 열지 않는다',
    !(await page.locator('[data-testid="specs-save"]').isVisible()))

  // ⚠ 'button:has-text("저장")'은 이 화면에서 5개를 잡고 첫 번째가 숨은 다른 폼의 버튼이다(실측).
  //    testid로 특정한다 — 문자열 셀렉터는 화면이 커질수록 조용히 남의 버튼을 누른다.
  await page.locator('[data-testid="form14-save"]').click()
  await page.waitForSelector('text=/저장(했습니다|되었습니다|완료)|확인일/', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const { data: post } = await raw.from('fire_facilities')
    .select('facility_code, category, installed').eq('building_id', buildingId).in('facility_code', ETC7)
  const row = ((post ?? []) as Array<{ facility_code: string; category: string; installed: boolean }>)
    .find(r => r.facility_code === TARGET)
  check('저장 후 DB에 기타 행이 있다', !!row, JSON.stringify(post ?? []))
  check("category='기타'로 저장된다", row?.category === '기타', row?.category ?? '(없음)')
  check('installed=true', row?.installed === true)
  check('체크 안 한 6종은 저장되지 않는다(미설치는 행을 만들지 않는 종전 규약)',
    (post ?? []).length === 1, `${(post ?? []).length}건`)

  // ── ⑤ 링크 이동 — 지목한 점검표가 열린 채 도착하는가 ─────────────────────
  await page.goto(`${BASE}${href!}`)
  await page.waitForURL(/\/inspections\/[0-9a-f-]+\/sheet/, { timeout: 20_000 })
  await page.waitForSelector('text=점검표 입력 —', { timeout: 20_000 })
  const body = (await page.locator('body').textContent()) ?? ''
  check('「기타사항」 점검표가 열린 채 도착한다', body.includes('기타사항'),
    body.slice(0, 160).replace(/\s+/g, ' '))
  // 항목은 지연 로드다 — body를 즉시 읽으면 시트 제목만 있고 항목이 없다(공허 실패)
  const flame = page.locator('text=방염대상물품').first()
  const shown = await flame.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
  check('방염 항목(31-B-*)이 열린 시트에 있다', shown,
    shown ? '' : ((await page.locator('body').textContent()) ?? '').slice(0, 200).replace(/\s+/g, ' '))
} catch (e) {
  check(`예외: ${(e as Error).message}`, false)
} finally {
  // 원상 복구 — 화면이 아니라 DB로 되돌린다(조작 실패 시 잔재가 남지 않게)
  if (buildingId) {
    const { error } = await raw.from('fire_facilities').delete().eq('building_id', buildingId).in('facility_code', ETC7)
    const { data: left } = await raw.from('fire_facilities').select('facility_code').eq('building_id', buildingId).in('facility_code', ETC7)
    check('정리 — 기타 행 0건 복구', !error && (left ?? []).length === 0, `${(left ?? []).length}건 ${error?.message ?? ''}`)
  }
  if (userId) await raw.auth.admin.deleteUser(userId).catch(() => {})
  await browser?.close()
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
