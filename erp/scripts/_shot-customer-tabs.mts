/** 고객 상세 세 탭(기본정보·건물·시설·관계인) 1920 캡처 — 읽기 전용 (2026-09-23 재배치 제안용) */
// @ts-expect-error mjs 헬퍼
import { BASE, mkUser, delUser, launch, login, raw } from './_e2e-helpers.mjs'
const STAMP = Date.now().toString(36)
const OUT = process.env.SHOT_DIR ?? '.'
let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: `tabs-shot-${STAMP}@test.local`, name: '탭캡처', employeeId: `E2E-TS-${STAMP}` })
  // 건물(용도 있음)과 관계인 2명 이상인 활성 고객
  const { data: b } = await raw.from('buildings').select('customer_id').not('purpose', 'is', null).limit(300)
  const ids = [...new Set((b ?? []).map((r: { customer_id: string }) => r.customer_id))]
  let cid = ''
  for (const id of ids) {
    const { count } = await raw.from('customer_contacts').select('id', { count: 'exact', head: true }).eq('customer_id', id)
    if ((count ?? 0) >= 2) { cid = id as string; break }
  }
  console.log('customer', cid)
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(90000)
  await login(page, `tabs-shot-${STAMP}@test.local`)
  await page.setViewportSize({ width: 1920, height: 1080 })
  const W = Number(process.env.SHOT_W ?? 1920)
  await page.setViewportSize({ width: W, height: 1080 })
  await page.goto(`${BASE}/customers/new`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/new-${W}.png`, fullPage: true })
  console.log('shot new')
  const TABS = (process.env.SHOT_TABS ?? 'info,buildings,contacts').split(',')
  for (const tab of TABS) {
    await page.goto(`${BASE}/customers/${cid}?tab=${tab}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}/tab-${tab}-${W}.png`, fullPage: true })
    console.log('shot', tab)
  }
} finally {
  if (browser) await browser.close()
  await delUser(userId)
}
