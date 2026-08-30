/** 소방계획서_37 R-d — 새 B-9 단언(`onScreen`)이 항진명제가 아님을 대조로 증명한다.
 *
 *  ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 *  1.4 세부제원 패널은 **항상 마운트**돼 있고 닫힘은 CSS 슬라이드(translate-x-full)다.
 *  그래서 종전 B-9('패널이 열리고 안·밖 측정 대상이 둘 다 실재한다')는 클릭 핸들러가 죽어도
 *  통과했다 — [data-spec-panel]도, 안쪽 .text-form-xs도, computed fontSize도, rect.width도
 *  translate와 **무관**하기 때문이다. 즉 B-10·B-11까지 전부 초록인 채 회귀를 놓친다.
 *
 *  수리는 '화면 안에 실제로 들어와 있는가'를 **기하**로 함께 묻는 것이다(클래스 이름이 아니라
 *  기하라서 토큰 코드모드가 이름을 갈아치워도 썩지 않는다 — 죽은 hex 사고의 교훈).
 *
 *  ── 이 프로브가 증명하는 것 ───────────────────────────────────────────────────
 *    A) 클릭 **없이** 재면 onScreen === false  (닫힘: left === vw)
 *    B) 클릭 **후** 재면 onScreen === true     (열림: left === vw - width)
 *    C) 그런데 종전 지표(패널 존재·글자 크기·폭)는 **A와 B에서 똑같다** → 종전 B-9는 A를 못 걸렀다
 *
 *  C가 이 실험의 핵심이다. B만 보면 '새 단언이 통과한다'까지만 알 뿐,
 *  **종전 단언이 왜 부족했는지**는 A와 나란히 놓아야 보인다.
 *
 *  실행: npx tsx scripts/_probe37-b9.mts        (dev 서버 필요)
 */
import { raw, BASE, check, summary, launch, login, mkUser, delUser } from './_e2e-helpers.mjs'

const { data: facRows } = await raw.from('fire_facilities')
  .select('building_id, installed').eq('installed', true).limit(5000)
const byBld = new Map<string, number>()
for (const r of facRows ?? []) byBld.set(r.building_id, (byBld.get(r.building_id) ?? 0) + 1)
const { data: blds } = await raw.from('buildings').select('id, customer_id')
  .in('id', [...byBld.keys()].slice(0, 200))
const { data: plans } = await raw.from('fire_plans').select('customer_id')
const planSet = new Set((plans ?? []).map(p => p.customer_id))
const ranked = (blds ?? []).map(b => ({ cust: b.customer_id, n: byBld.get(b.id) ?? 0 }))
  .filter(x => planSet.has(x.cust)).sort((a, b) => b.n - a.n)
const custId = ranked[0]?.cust
if (!custId) { console.log('❌ 대상 고객 없음 — 측정 불가'); process.exit(1) }

const email = `s37b9_${Date.now()}@example.com`
const u = await mkUser({ email, name: 'S37 B9', employeeId: `S37B${Date.now() % 100000}` })
const { browser, page } = await launch()

/** test-font-scale.mts B-9~B-11이 재는 것과 **같은** 항목들. */
const MEASURE = `(() => {
  const panel = document.querySelector('[data-spec-panel]');
  if (!panel) return null;
  const inside = panel.querySelector('.text-form-xs');
  const outside = [...document.querySelectorAll('.text-form-xs')].find(el => !panel.contains(el));
  const rect = panel.getBoundingClientRect();
  return {
    exists: true,
    inside: inside ? parseFloat(getComputedStyle(inside).fontSize) : null,
    outside: outside ? parseFloat(getComputedStyle(outside).fontSize) : null,
    width: Math.round(rect.width), left: Math.round(rect.left), vw: window.innerWidth,
    onScreen: rect.left < window.innerWidth - 10,
  } })()`

let closed: any = null, open: any = null
try {
  await login(page, email)
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4`, { waitUntil: 'networkidle' })
  await page.evaluate(`document.documentElement.removeAttribute('data-fs')`)

  // A) 클릭하지 않은 상태 = '클릭 핸들러가 죽은 회귀'의 대역
  closed = await page.evaluate(MEASURE)
  console.log(`A 닫힘  ${JSON.stringify(closed)}`)

  // B) 실제로 연 상태
  const clicked = await page.evaluate(`(() => {
    const els = [...document.querySelectorAll('[data-testid^="form14-ledger-"]')];
    if (!els.length) return false; els[0].click(); return true })()`)
  check('전제: 설비 버튼이 실재해 클릭했다', clicked === true, `clicked=${clicked}`)
  await page.waitForTimeout(1500)
  open = await page.evaluate(MEASURE)
  console.log(`B 열림  ${JSON.stringify(open)}\n`)
} catch (e: any) {
  check('실행', false, e?.message ?? String(e))
} finally {
  await browser.close(); await delUser(u)
}

check('A 닫힘 상태에서 새 단언이 거짓이다 (onScreen=false)',
  closed?.onScreen === false,
  `left=${closed?.left} vw=${closed?.vw} — 닫히면 자기 폭만큼 밀려 left===vw여야 한다`)

check('B 열림 상태에서 새 단언이 참이다 (onScreen=true)',
  open?.onScreen === true,
  `left=${open?.left} vw=${open?.vw} width=${open?.width}`)

// ⭐ 핵심 — 종전 B-9가 보던 것들은 A와 B에서 **구별되지 않는다**.
check('⭐ 종전 지표는 A·B를 구별하지 못한다 (패널 존재)',
  closed?.exists === true && open?.exists === true, `${closed?.exists} / ${open?.exists}`)
check('⭐ 종전 지표는 A·B를 구별하지 못한다 (안·밖 글자 크기)',
  closed?.inside === open?.inside && closed?.outside === open?.outside,
  `닫힘 ${closed?.inside}/${closed?.outside} · 열림 ${open?.inside}/${open?.outside}`)
check('⭐ 종전 지표는 A·B를 구별하지 못한다 (패널 폭)',
  closed?.width === open?.width, `닫힘 ${closed?.width} · 열림 ${open?.width}`)

// 즉 종전 조건식은 A에서도 통과했다 = 항진명제였다.
const oldPassesOnClosed = !!closed && Number.isFinite(closed?.inside) && Number.isFinite(closed?.outside)
check('⭐ 결론 — 종전 B-9 조건은 닫힌 패널에서도 통과했다 (그래서 회귀를 못 잡았다)',
  oldPassesOnClosed === true,
  '이 단언이 실패하면 종전 B-9는 이미 충분했다는 뜻 — 그때는 수리를 되돌릴 것')

summary('소방계획서_37 R-d — B-9 onScreen 대조')
