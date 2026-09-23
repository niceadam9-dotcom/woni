/** 고객 화면 「그룹 단위 정렬 + 핵심 칸 강조」 — 실화면 (2026-09-23)
 *  실행: TEST_BASE_URL=http://localhost:3000 npx tsx scripts/_probe-customer-new-layout.mts
 *
 *  소스 단언(`test-customer-new-layout`)이 못 보는 것 — **실제로 그려진 모양**:
 *   · 등록: 열자마자 커서가 고객명 · 탭 순서 = 화면 순서(고객명 → 담당 → 계약일 → 사용승인일 → 점검일자 → 유형)
 *   · ★ 세로줄 정렬 — 1920에서 한 그룹 안 칸들의 **왼쪽 끝 x좌표가 4개 값으로만** 모인다(「산만하지 않게」의 실측)
 *   · ★ 1280 상세 탭(요약 패널 옆 좁은 상자)에서 **날짜가 잘리지 않는다** — 화면 폭 기준 4열이었을 때 실제로 잘렸다
 *   · 기본정보 탭 1920 본문 폭 > 1200px(넓게) · 요약 패널 유지 · 기산점 배지가 뜬다
 *   · 1280·400 가로 넘침 0
 *  읽기 전용 — 등록·저장 버튼은 누르지 않는다.
 */
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login, raw } from './_e2e-helpers.mjs'

const STAMP = Date.now().toString(36)
const EMAIL = `cust-layout-${STAMP}@test.local`

let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '등록화면프로브', employeeId: `E2E-CL-${STAMP}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(90000)
  await login(page, EMAIL)

  const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  /** 그룹 상자마다 칸([data-span])의 왼쪽 끝 x — 서로 다른 값의 개수(최대) */
  const maxColumnLines = async () => page.evaluate(() => {
    let worst = 0
    for (const box of Array.from(document.querySelectorAll('section[data-testid]'))) {
      const xs = new Set(Array.from(box.querySelectorAll('[data-span]')).map(e => Math.round((e as HTMLElement).getBoundingClientRect().left)))
      worst = Math.max(worst, xs.size)
    }
    return worst
  })
  /** 날짜 칸 중 글자가 칸보다 넓은(잘린) 것 */
  const clippedDates = async () => page.evaluate(() =>
    Array.from(document.querySelectorAll('input[placeholder="YYYY-MM-DD"]'))
      .filter(e => { const i = e as HTMLInputElement; return i.offsetParent && i.value && i.scrollWidth > i.clientWidth + 1 })
      .map(e => (e as HTMLInputElement).id || (e as HTMLInputElement).value))

  // ── 등록 1920 ──
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto(`${BASE}/customers/new`, { waitUntil: 'domcontentloaded' })
  await page.locator('#new-customer-name').waitFor()
  await page.waitForFunction(() => document.activeElement?.id === 'new-customer-name', undefined, { timeout: 15000 }).catch(() => {})
  const first = await page.evaluate(() => document.activeElement?.id ?? '')
  check('★ 등록 — 열자마자 커서가 고객명', first === 'new-customer-name', first)

  const seen: string[] = []
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    seen.push(await page.evaluate(() => {
      const a = document.activeElement as HTMLInputElement | null
      return a?.id || (a?.name ? `name:${a.name}` : `${a?.tagName}:${(a?.textContent ?? '').trim().slice(0, 6)}`)
    }))
  }
  const want = ['new-assignee', 'new-contract-date', 'new-use-approval', 'new-anchor-date']
  check('★ 탭 순서 = 화면 순서 (고객명 → 담당 → 계약일 → 사용승인일 → 점검일자)',
    want.every((w, k) => seen[k] === w), seen.join(' → '))
  check('그 다음 곧 점검유형 (미리보기 박스 버튼 외 끼어드는 칸 없음)',
    seen.slice(4).some(x => x === 'name:inspection_category'), seen.slice(4).join(' → '))

  const lines = await maxColumnLines()
  check('★ 세로줄 정렬 — 그룹 안 칸 왼쪽 끝이 4줄 이하', lines > 0 && lines <= 4, `${lines}줄`)
  check('★ 기준일 줄이 강조 바탕', await page.locator('[data-testid="new-keydates"][data-accent="1"]').count() === 1)
  check('등록 1920 — 가로 넘침 없음', await noOverflow())

  // ── 기본정보 탭 — 두 날짜가 다 있는 고객 ──
  const { data: cs } = await raw.from('customers').select('id')
    .not('use_approval_date', 'is', null).not('plan_anchor_date', 'is', null).eq('is_active', true).limit(1)
  const cid = (cs?.[0] as { id: string } | undefined)?.id
  if (!cid) check('표본 — 두 날짜가 있는 활성 고객', false, '못 찾음(판정 불가)')
  else {
    await page.goto(`${BASE}/customers/${cid}?tab=info`, { waitUntil: 'domcontentloaded' })
    await page.locator('#cf-name').waitFor()
    const boxW = await page.locator('[data-testid="info-group"]').evaluate(e => e.getBoundingClientRect().width)
    check('★ 기본정보 1920 — 본문이 넓다 (> 1200px)', boxW > 1200, `${Math.round(boxW)}px`)
    check('요약 패널은 그대로 있다', await page.getByText('고객 요약').count() > 0)
    check('★ 기산점 배지가 둘 중 하나에 뜬다',
      await page.locator('[data-testid="info-keydates"] [data-role="anchor"]').count() === 1)
    check('기본정보 1920 — 세로줄 4줄 이하', (await maxColumnLines()) <= 4, `${await maxColumnLines()}줄`)

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.waitForTimeout(400)
    const clipped = await clippedDates()
    check('★ 기본정보 1280 — 날짜가 잘리지 않는다 (상자 폭 기준 2열)', clipped.length === 0, clipped.join(', '))
    check('기본정보 1280 — 가로 넘침 없음', await noOverflow())
  }

  // ── 등록 400 ──
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto(`${BASE}/customers/new`, { waitUntil: 'domcontentloaded' })
  await page.locator('#new-customer-name').waitFor()
  check('등록 400 — 가로 넘침 없음', await noOverflow(), String(await page.evaluate(() => document.documentElement.scrollWidth)))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  await delUser(userId)
  summary()
}
