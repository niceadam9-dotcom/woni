/** 소방계획서_37 S4-1 진단 — 1.4-specs의 12px 노드가 기준선보다 7개 적은 이유.
 *
 *  내 변경([넓게] 버튼)은 12px 노드를 **+1** 한다. 그런데 실측은 52→45(-7)다.
 *  −8이 어디서 왔는지 모른 채 기준선을 다시 뜨면, 그 순간 '사라진 8개'가 영원히 정상이 된다.
 *
 *  두 축으로 가른다:
 *   ① 내 버튼을 CSS로 숨기고(=COLLECT의 width0·height0 제외 규칙에 걸리게) 다시 센다.
 *      45→44면 내 기여분은 정확히 1이고, 나머지 −8은 내 것이 아니다.
 *   ② 12px 노드의 **텍스트를 전부 찍는다**. 렌더가 덜 된 것인지(비동기 배지 누락),
 *      데이터가 달라진 것인지(다른 설비/섹션이 열림)를 눈으로 가른다.
 *
 *  실행: npx tsx scripts/_probe37-12px.mts
 */
import { BASE, check, summary, launch, login, mkUser, delUser, raw } from './_e2e-helpers.mjs'

const HIDE = `[data-testid="specs-wide-toggle"]{display:none!important}`
const BOOST_OFF = `[data-fs-boost]{--fs-scale:1!important}`

/** 기준선 COLLECT와 **같은 규칙**(직접 텍스트 보유 + 렌더된 것만). 텍스트도 함께 돌려준다. */
const DUMP = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    let own = false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { own = true; break }
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (getComputedStyle(el).fontSize !== '12px') continue;
    out.push(el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 42));
  }
  return out;
})()`

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
console.log(`대상 고객 ${custId} (설치 설비 ${ranked[0]?.n}개)`)

const email = `s37probe_${Date.now()}@example.com`
const u = await mkUser({ email, name: 'S37 프로브', employeeId: `S37P${Date.now() % 100000}` })
const { browser, page } = await launch()

async function collect(hideBtn: boolean) {
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4`, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: BOOST_OFF + (hideBtn ? HIDE : '') })
  await page.evaluate('document.fonts.ready')
  await page.evaluate(`(() => {
    const els = [...document.querySelectorAll('[data-testid^="form14-ledger-"]')];
    if (els.length) els[0].click(); })()`)
  await page.waitForTimeout(2500)
  return await page.evaluate(DUMP) as string[]
}

try {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await login(page, email)

  const on = await collect(false)
  const off = await collect(true)

  check(`① [넓게] 버튼의 기여분이 정확히 1이다 (${on.length} → ${off.length})`,
    on.length - off.length === 1, `버튼 있음 ${on.length} / 숨김 ${off.length}`)

  const btn = on.filter(t => !off.includes(t) || on.filter(x => x === t).length > off.filter(x => x === t).length)
  console.log(`\n버튼 숨김으로 사라진 텍스트: ${JSON.stringify(btn.slice(0, 3))}`)

  console.log(`\n── 12px 노드 ${on.length}개 전문 ──`)
  const counts = new Map<string, number>()
  for (const t of on) counts.set(t, (counts.get(t) ?? 0) + 1)
  for (const [t, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(2)}×  ${t}`)

  // 열린 섹션이 무엇인지 — 데이터 변동으로 다른 설비가 첫 칸이 되면 배지 수가 통째로 달라진다
  const ctx = await page.evaluate(`(() => {
    const first = document.querySelector('[data-testid^="form14-ledger-"]');
    const open = [...document.querySelectorAll('[data-spec-section]')]
      .filter(s => s.querySelector('[data-testid^="rowtable-"]'))
      .map(s => s.getAttribute('data-spec-section'));
    return {
      firstLedger: first ? first.getAttribute('data-testid') : null,
      ledgerCount: document.querySelectorAll('[data-testid^="form14-ledger-"]').length,
      openSections: open,
      rowtables: document.querySelectorAll('[data-testid^="rowtable-"]').length,
    } })()`) as any
  console.log(`\n첫 설비칸: ${ctx.firstLedger} (설비칸 ${ctx.ledgerCount}개)`)
  console.log(`열린 섹션: ${JSON.stringify(ctx.openSections)} · rowtable ${ctx.rowtables}개`)
} catch (e: any) {
  check('프로브 실행', false, e?.message ?? String(e))
} finally {
  await browser.close().catch(() => {})
  await delUser(u).catch(() => {})
}
summary()
