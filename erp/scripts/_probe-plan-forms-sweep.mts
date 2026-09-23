/** 소방계획서·공통·보고서 서식 **전수 열람** — 화면 오류(TypeError 등) 수집 (실화면, 읽기 전용, 2026-09-23)
 *  실행: TEST_BASE_URL=http://localhost:3000 npx tsx scripts/_probe-plan-forms-sweep.mts
 *
 *  왜: 3장(routes)·1.11(headcount)이 **같은 부류**(공통 문구 자동 주입의 부분 저장값)로 차례로 죽었다.
 *  하나씩 발견하지 말고, 부분 저장값을 가진 고객 + 대조 고객으로 **모든 서식 노드를 열어** 한 번에 센다.
 *  표본: sections에 training·evacPlan이 부분 저장된 고객(최대 3) + 아무 sections나 있는 고객(2).
 */
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login, raw } from './_e2e-helpers.mjs'

const PLAN = ['1.2', '1.3', '1.5', '1.6', '1.7', '1.8', '1.10', '1.11', '1.12', 'ch2', 'ch3', 'cover']
const FACILITIES = ['1.1', '1.4']
const REPORTS = ['etc', 'duty']

const S = Date.now().toString(36); let uid = '', b: { close: () => Promise<void> } | null = null
try {
  const { data } = await raw.from('fire_plan_forms').select('customer_id, sections').limit(1000)
  const all = (data ?? []) as Array<{ customer_id: string; sections: Record<string, Record<string, unknown>> | null }>
  const partial = all.filter(r => (r.sections?.training && !r.sections.training.headcount)
    || (r.sections?.evacPlan && !Array.isArray(r.sections.evacPlan.routes))).slice(0, 3).map(r => r.customer_id)
  const others = all.filter(r => r.sections && !partial.includes(r.customer_id)).slice(0, 2).map(r => r.customer_id)
  const sample = [...partial, ...others]
  console.log(`표본 ${sample.length}명 (부분 저장 ${partial.length} · 대조 ${others.length})`)

  uid = await mkUser({ email: `sweep-${S}@test.local`, name: '서식전수', employeeId: `E2E-SW-${S}` })
  const l = await launch(); b = l.browser; const { page } = l; page.setDefaultTimeout(60000)
  let errs: string[] = []
  page.on('pageerror', e => errs.push(String(e).split('\n')[0].slice(0, 140)))
  await login(page, `sweep-${S}@test.local`)

  const found: string[] = []
  let visits = 0
  for (const cid of sample) {
    for (const [tab, forms] of [['plan', PLAN], ['facilities', FACILITIES], ['reports', REPORTS]] as const) {
      for (const f of forms) {
        errs = []
        await page.goto(`${BASE}/customers/${cid}?tab=${tab}&form=${f}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(2500)
        visits++
        const boundary = await page.locator('[data-testid="route-error"]').count()
        if (errs.length || boundary) found.push(`${cid.slice(0, 8)} ${tab}/${f}: ${errs[0] ?? '(오류 화면)'}`)
      }
    }
  }
  check(`★ 서식 ${visits}회 열람 — 화면 오류 0건`, found.length === 0, '\n    ' + found.join('\n    '))
} catch (e) { check('예외 없음', false, String(e)) }
finally { if (b) await b.close(); await delUser(uid); summary() }
