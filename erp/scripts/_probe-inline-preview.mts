/** 인라인 사용승인일 수정에서 **미리보기 팝업이 실제로 뜨는가** — dev 서버 필요.
 *  실행: npx tsx scripts/_probe-inline-preview.mts
 *  ⚠ 팝업만 확인하고 **취소**한다 — 저장하지 않으므로 DB는 무변경(끝에 값이 그대로인지 단언). */
// @ts-expect-error — .mjs 헬퍼에 타입 선언이 없다(다른 검사들도 같은 방식)
import { raw, BASE, launch, login, mkUser, delUser } from './_e2e-helpers.mjs'

const EMAIL = 'inline-preview-probe@erp-test.com'
let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${n}${ok || !d ? '' : ` — ${d}`}`) }

const { data: c } = await raw.from('customers')
  .select('id, customer_code, customer_name, use_approval_date, inspection_type, inspection_sub_type')
  .eq('customer_code', 'C330').single()
console.log(`대상: ${c.customer_code} ${c.customer_name} · 사용승인 ${c.use_approval_date}\n`)
const ORIGINAL = c.use_approval_date

let userId: string | null = null
let browser: { close(): Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '인라인프로브', employeeId: 'E2E-INLINE' })
  const l = await launch(); browser = l.browser
  const page = l.page
  const errs: string[] = []; const alerts: string[] = []
  page.on('pageerror', (e: Error) => errs.push(String(e.message)))
  page.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('dialog', async (d: { message(): string; dismiss(): Promise<void> }) => { alerts.push(d.message()); await d.dismiss() })
  await login(page, EMAIL)

  // 고객 목록에서 그 고객 행의 **사용승인일 칸**을 직접 지목한다(셀 텍스트 추측 금지)
  // ⚠ 사용승인일 열은 `cols=full`에서만 그려진다(page.tsx:240) — 기본 목록엔 아예 없다
  await page.goto(`${BASE}/customers?q=${encodeURIComponent(c.customer_name)}&active=all&cols=full`)
  const row = page.locator('tr', { has: page.getByText(c.customer_name, { exact: false }) }).first()
  await row.waitFor({ timeout: 20_000 })
  const view = row.locator('[data-testid="inline-use_approval_date"]')
  await view.waitFor({ timeout: 15_000 })
  check('[대조군] 조회 상태엔 미리보기가 없다', await page.locator('text=저장하면 이렇게 바뀝니다').count() === 0)
  await view.click()                                   // 클릭하여 편집 진입
  const edit = row.locator('[data-testid="inline-use_approval_date-edit"]')
  await edit.waitFor({ timeout: 10_000 })
  // DateInput은 텍스트칸 + 숨은 native date picker 두 개다 — 보이는 쪽만 채운다
  await edit.locator('input[type="text"]').fill('2026-08-23')   // 재건축 시나리오
  // ⚠ DateInput 안에 달력 버튼이 있어 `.first()`는 저장이 아니다 — 저장 버튼을 명시로 지목
  await edit.locator('[data-testid="inline-save"]').click()

  const dlg = page.locator('text=저장하면 이렇게 바뀝니다')
  await dlg.waitFor({ timeout: 20_000 })
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check('미리보기 팝업이 뜬다', await dlg.count() > 0)
  check('법정 점검 시기 변화를 보여준다', /법정 점검 시기/.test(body))
  check('최초점검 기한을 알린다(2026-10-22)', /최초점검/.test(body) && /2026-10-22/.test(body),
    body.slice(body.indexOf('최초점검'), body.indexOf('최초점검') + 80))
  check('계획 변화를 보여준다', /계획 변화/.test(body))

  // 취소 — 저장하지 않는다
  await page.getByRole('button', { name: /취소 \(변경하지 않음\)/ }).click()
  await page.waitForTimeout(1500)
  const { data: after } = await raw.from('customers').select('use_approval_date').eq('id', c.id).single()
  check('취소하면 저장되지 않는다(DB 무변경)', after.use_approval_date === ORIGINAL,
    `${ORIGINAL} → ${after.use_approval_date}`)

  // --- 2) 점검종류 인라인 변경(작동↔종합)도 같은 팝업이 떠야 한다 ---
  console.log('\n[점검종류 인라인]')
  await page.reload()
  const typeView = row.locator('[data-testid="inline-inspection_type"]')
  await typeView.waitFor({ timeout: 15_000 })
  await typeView.click()
  const sel = row.locator('select').first()
  await sel.waitFor({ timeout: 10_000 })
  // 지금이 종합이면 작동으로, 아니면 종합으로 — 어느 쪽이든 '종류가 바뀌는' 변경이다
  const opts = await sel.locator('option').evaluateAll(
    (os: HTMLOptionElement[]) => os.map(o => ({ v: o.value, l: o.textContent ?? '' })))
  const cur = await sel.inputValue()
  const next = opts.find((o: { v: string; l: string }) => o.v !== cur && !/일반/.test(o.l))
  check('바꿀 다른 종류가 있다', !!next, JSON.stringify(opts))
  await sel.focus()
  await sel.selectOption(next!.v)
  // ⚠ 곧바로 blur하면 리렌더 전 핸들러가 돌아 **옛 draft**로 판단해 "변경 없음"으로 끝난다.
  //    실사용자에겐 없는 경합이라 프로브가 사람 속도를 흉내낸다.
  await page.waitForTimeout(400)
  // ⚠ 바깥을 클릭하면 ClickableRow가 상세로 이동해 버린다 — Tab으로 포커스만 옮긴다.
  //    (점검종류는 Enter 저장이 없어 **blur가 유일한 저장 경로**다)
  await page.keyboard.press('Tab')
  await page.locator('text=저장하면 이렇게 바뀝니다').waitFor({ timeout: 20_000 })
  const body2 = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check('종류 변경도 미리보기가 뜬다', /저장하면 이렇게 바뀝니다/.test(body2))
  check('법정 점검 시기 변화를 보여준다', /법정 점검 시기/.test(body2))
  check('콘솔 오류 없음', errs.length === 0, JSON.stringify(errs.slice(0, 2)))
  check('경고창 없음', alerts.length === 0, JSON.stringify(alerts))
  await page.getByRole('button', { name: /취소 \(변경하지 않음\)/ }).click()
  await page.waitForTimeout(1500)
  const { data: a2 } = await raw.from('customers')
    .select('inspection_type, inspection_sub_type').eq('id', c.id).single()
  check('취소하면 종류도 그대로다', a2.inspection_type === c.inspection_type && a2.inspection_sub_type === c.inspection_sub_type,
    `${c.inspection_type}/${c.inspection_sub_type} → ${a2.inspection_type}/${a2.inspection_sub_type}`)
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
