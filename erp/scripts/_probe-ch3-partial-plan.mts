/** 소방계획서 3장 — routes 없는 저장값 고객에서 화면이 뜨는가 (실화면, 읽기 전용, 2026-09-23)
 *  실행: TEST_BASE_URL=http://localhost:3000 npx tsx scripts/_probe-ch3-partial-plan.mts
 *  표본 = 스테이징에서 evacPlan에 routes가 **없는** 고객(_probe-evacplan-shape로 찾은 6명 중 첫째) */
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login, raw } from './_e2e-helpers.mjs'
const S = Date.now().toString(36); let uid = '', b: { close: () => Promise<void> } | null = null
try {
  const { data } = await raw.from('fire_plan_forms').select('customer_id, sections').limit(1000)
  const hit = (data ?? []).find((r: { sections: { evacPlan?: { routes?: unknown } } | null }) =>
    r.sections?.evacPlan && !Array.isArray(r.sections.evacPlan.routes))
  if (!hit) { check('표본 — routes 없는 저장값', false, '못 찾음(판정 불가)'); throw new Error('표본 없음') }
  uid = await mkUser({ email: `ch3-${S}@test.local`, name: 'ch3프로브', employeeId: `E2E-C3-${S}` })
  const l = await launch(); b = l.browser; const { page } = l; page.setDefaultTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)))
  page.on('console', m => { if (m.type() === 'error' && /routes|TypeError/.test(m.text())) errors.push(m.text().slice(0, 160)) })
  await login(page, `ch3-${S}@test.local`)
  await page.goto(`${BASE}/customers/${hit.customer_id}?tab=plan&form=ch3`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /행 추가/ }).first().waitFor({ state: 'attached', timeout: 90000 }).catch(() => {})
  const card = page.locator('[id="c-3.4"]')
  const shown = (await card.count()) === 1 && await card.isVisible()
  check('★ 3장 3.4(유도·경로) 카드가 그려진다', shown)
  check('★ routes·TypeError 오류가 없다', errors.length === 0, errors.join(' | '))
  check('경로 [행 추가] 버튼이 있다(빈 목록에서 시작)', await page.getByRole('button', { name: /행 추가/ }).count() > 0)
} catch (e) { if (!String(e).includes('표본 없음')) check('예외 없음', false, String(e)) }
finally { if (b) await b.close(); await delUser(uid); summary() }
