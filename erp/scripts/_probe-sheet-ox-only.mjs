/** 점검표 O/X 전용 + 해제 시 DB 행 삭제 실측 (dev :3000 필요)
 *  실행: node scripts/_probe-sheet-ox-only.mjs
 *
 *  2026-08-13 사용자 확정: "선택은 O와 X만"(개별 ／ 버튼 없음).
 *  ⚠ 의미 개정(소방계획서_23 Q-19, 2026-08-14): 미선택 = **미점검(공란)** — 종전 '기본값 ／'가 아니다.
 *  ／는 그룹 일괄 버튼으로만 기록되고, 미선택·해제 항목은 표식 없이 비어 보인다.
 *  화면에서 ／ 버튼이 사라진 것만으로는 부족하다 — **해제가 DB에 반영돼야** 공란이 참이 된다.
 *  saveSheetResponsesAction이 upsert 전용이던 시절엔 화면에서만 풀리고 O 행이 남아 별지에 그대로 인쇄됐다.
 *  그 경로(선택 → 저장 → 해제 → 저장 → 행 삭제)를 UI로 끝까지 밟는다.
 *  (시트 UI는 23에서 머더 보드 + 드로어로 개편 — 저장 후 드로어가 닫히지 않고 유지된다)
 */
import { chromium } from 'playwright'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? (pass++, console.log(`  ✅ ${n}${d ? ` — ${d}` : ''}`)) : (fail++, console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`)) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 조건이 참이 될 때까지 DB를 다시 읽는다 — 저장은 서버 왕복이라 클릭 직후엔 아직 없다 */
async function pollRow(inspId, code, want, ms = 20000) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const { data } = await s.from('inspection_sheet_responses')
      .select('result').eq('inspection_id', inspId).eq('item_code', code)
    const got = (data ?? [])[0]?.result ?? null
    if (want === null ? got === null : got === want) return got
    await sleep(700)
  }
  const { data } = await s.from('inspection_sheet_responses')
    .select('result').eq('inspection_id', inspId).eq('item_code', code)
  return (data ?? [])[0]?.result ?? null
}

/** [저장] 클릭 — 드로어 푸터의 저장. 못 찾으면 화면에 남은 버튼을 그대로 뱉는다(원인 추측 대신 실물 확인) */
async function clickSave(page, where) {
  const btn = page.locator('[data-testid="sheet-drawer"] button:has-text("저장")')
  try {
    await btn.click({ timeout: 20000 })
  } catch (e) {
    const texts = (await page.locator('button').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
    throw new Error(`[${where}] 저장 버튼 없음. 남은 버튼: ${JSON.stringify(texts.slice(0, 25))}`)
  }
}

/** 저장 완료 대기 — 23 개편으로 저장 후 드로어가 **닫히지 않고 유지**된다(base=local 갱신).
 *  종전의 '편집기 닫힘(detached)' 대기는 30초 타임아웃 오탐이 되므로, 완료 알림 텍스트를 기다린다. */
async function waitSaved(page) {
  await page.waitForSelector('[data-testid="sheet-drawer"] >> text=저장했습니다', { timeout: 30000 })
  await page.waitForLoadState('networkidle')
}

const EMAIL = 'sheet-ox-probe@erp-test.com'
const PW = 'E2eTest1!'
let userId = null, custId = null, inspId = null, browser = null

try {
  const { data: created, error } = await s.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  if (created?.user) {
    userId = created.user.id
    await s.from('profiles').upsert({
      id: userId, email: EMAIL, name: 'OX프로브', employee_id: 'E2E-SOX',
      role: 'admin', is_active: true, is_system: false,
    })
  } else {
    const { data: p } = await s.from('profiles').select('id').eq('email', EMAIL).maybeSingle()
    userId = p?.id
  }

  const { data: c, error: cErr } = await s.from('customers').insert({
    customer_code: `TEST-OX-${Math.random().toString(36).slice(2, 7)}`,
    customer_name: 'OX프로브고객', created_by: userId,
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    contract_date: '2026-01-05', is_active: true,
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  custId = c.id
  const { data: insp, error: iErr } = await s.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: '2026-07-01', status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = insp.id

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  page.setDefaultTimeout(45000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

  await page.goto(`${BASE}/inspections/${inspId}`)
  await page.waitForSelector('button:has-text("안전시설등(다중이용업소)")')
  await page.click('button:has-text("안전시설등(다중이용업소)")')
  await page.waitForSelector('text=소화기 또는 자동확산소화기')

  // ── 1. 고를 수 있는 값이 O·X 둘뿐인가 ────────────────────────────────────────
  // 항목 버튼은 aria-label="<코드> <값>" — 값 축으로만 센다(메모 [등록] 등과 섞이지 않게)
  const nBtns = await page.locator('button[aria-label$=" N"]').count()
  const oBtns = await page.locator('button[aria-label$=" O"]').count()
  const xBtns = await page.locator('button[aria-label$=" X"]').count()
  check('★ ／(N) 버튼이 없다', nBtns === 0, `N ${nBtns}개`)
  check('O·X 버튼은 항목마다 있다', oBtns >= 16 && oBtns === xBtns, `O ${oBtns} / X ${xBtns}`)

  // ── 2. 미선택 항목은 공란 — ／ 표식이 없다 (Q-19: 미선택 = 미점검) ──────────
  const row = page.locator('div.border-b:has(span:text-matches("^MU-"))').first()
  const code = ((await row.locator('span').first().textContent()) ?? '').trim()
  check('★ 미선택 항목은 공란(／ 표식 없음 — Q-19)', await row.locator('[data-na-mark]').count() === 0, code)

  // ── 3. 선택 → 저장 → DB에 O (저장 후 드로어 유지) ─────────────────────────
  await row.locator(`button[aria-label="${code} O"]`).click()
  await clickSave(page, '선택 저장')
  await waitSaved(page)
  check('★ 저장 후 드로어 유지(닫히지 않음)', await page.locator('[data-testid="sheet-drawer"]').isVisible())
  const afterSave = await pollRow(inspId, code, 'O')
  check('선택 저장 — DB에 O', afterSave === 'O', String(afterSave))

  // ── 4. 같은 값을 다시 눌러 해제 → 저장 → **행이 사라진다** ─────────────────
  const row2 = page.locator(`div.border-b:has(span:text("${code}"))`).first()
  await row2.locator(`button[aria-label="${code} O"]`).click()
  check('★ 같은 값 재클릭 = 해제 → 공란 복귀(／ 아님 — Q-19)',
    await row2.locator(`button[aria-label="${code} O"].bg-green-500`).count() === 0
    && await row2.locator('[data-na-mark]').count() === 0)
  await clickSave(page, '해제 저장')
  const afterClear = await pollRow(inspId, code, null)
  check('★★ 해제 저장 — DB 행이 삭제된다 (화면만 풀리지 않는다)',
    afterClear === null, afterClear === null ? '' : `남은 값 ${afterClear}`)

  // ── 5. 해제가 다른 항목까지 지우지 않는가 ─────────────────────────────────
  const rows = page.locator('div.border-b:has(span:text-matches("^MU-"))')
  const codeA = ((await rows.nth(0).locator('span').first().textContent()) ?? '').trim()
  const codeB = ((await rows.nth(1).locator('span').first().textContent()) ?? '').trim()
  await rows.nth(0).locator(`button[aria-label="${codeA} O"]`).click()
  await rows.nth(1).locator(`button[aria-label="${codeB} O"]`).click()
  await clickSave(page, '2건 저장')
  await pollRow(inspId, codeB, 'O')
  await page.locator(`div.border-b:has(span:text("${codeA}"))`).first()
    .locator(`button[aria-label="${codeA} O"]`).click()
  await clickSave(page, '1건만 해제 저장')
  const goneA = await pollRow(inspId, codeA, null)
  const keptB = await pollRow(inspId, codeB, 'O')
  check('★ 해제는 그 항목만 지운다', goneA === null && keptB === 'O', `${codeA}=${goneA} / ${codeB}=${keptB}`)

} catch (e) {
  check('예외 없음', false, String(e).slice(0, 400))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (inspId) {
    await s.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await s.from('inspection_defects').delete().eq('inspection_id', inspId)
    await s.from('inspection_steps').delete().eq('inspection_id', inspId)
    await s.from('inspections').delete().eq('id', inspId)
  }
  if (custId) await s.from('customers').delete().eq('id', custId)
  if (userId) {
    await s.from('profiles').delete().eq('id', userId)
    await s.auth.admin.deleteUser(userId).catch(() => {})
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
  process.exit(fail === 0 ? 0 : 1)
}
