/** 소방계획서_37 F-1·F-2 검증.
 *
 *  F-1 [문서 미리보기 나란히]를 켜면 패널이 자동으로 [넓게]가 된다.
 *      ⚠ 단, **localStorage에 쓰지 않는다** — 취향 설정이 아니라 세션 편의다.
 *        새로고침하면 사용자가 고른 폭으로 돌아가야 한다. 이 '안 쓴다'가 F-1의 핵심 제약이라
 *        기능 확인과 **같은 무게로** 단언한다(안 그러면 조용히 취향을 덮어쓴다).
 *  F-2 미리보기 iframe 높이가 고정 640px이 아니라 min(78vh,900px)이다.
 *
 *  실행: npx tsx scripts/_probe37-f12.mts
 */
import { readFileSync } from 'node:fs'
import { BASE, check, summary, launch, login, mkUser, delUser, raw } from './_e2e-helpers.mjs'

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
const URL = `${BASE}/customers/${custId}?tab=plan&form=1.4`

const email = `s37f12_${Date.now()}@example.com`
const u = await mkUser({ email, name: 'S37 F12', employeeId: `S37F${(Date.now() + 7) % 100000}` })
const { browser, page } = await launch()

const panelW = () => page.evaluate(
  `Math.round(document.querySelector('[data-spec-panel]')?.getBoundingClientRect().width ?? 0)`)

async function openPanel() {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid^="form14-ledger-"]', { timeout: 30000 })
  await page.evaluate(`(() => {
    const els = [...document.querySelectorAll('[data-testid^="form14-ledger-"]')];
    if (els.length) els[0].click(); })()`)
  await page.waitForSelector('[data-spec-panel]', { timeout: 15000 })
  await page.waitForTimeout(2500)
}

try {
  await page.setViewportSize({ width: 1600, height: 1000 })
  page.setDefaultTimeout(45000)
  await login(page, email)

  // 사용자가 '기본 폭'을 고른 상태에서 출발한다 (F-1이 덮어쓰면 안 되는 그 값)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(`localStorage.setItem('erp-spec-panel-wide','0')`)
  await openPanel()
  const base = await panelW() as number
  const lsBefore = await page.evaluate(`localStorage.getItem('erp-spec-panel-wide')`)
  check('출발 상태 — 기본 폭이고 localStorage=0', base > 0 && lsBefore === '0', `폭 ${base} · ls=${lsBefore}`)

  // ── F-1 ───────────────────────────────────────────────────────────────────
  const splitBtn = await page.$('button:has-text("문서 미리보기 나란히")')
  if (!splitBtn) throw new Error('[문서 미리보기 나란히] 버튼을 못 찾았다')
  await splitBtn.click()
  await page.waitForTimeout(3500)
  const afterSplit = await panelW() as number
  const lsAfter = await page.evaluate(`localStorage.getItem('erp-spec-panel-wide')`)
  const pressed = await page.getAttribute('[data-testid="specs-wide-toggle"]', 'aria-pressed')
  check('F-1 나란히를 켜면 패널이 자동으로 넓어진다',
    afterSplit > base + 200 && pressed === 'true', `${base} → ${afterSplit} · aria-pressed=${pressed}`)
  check('F-1 그런데 localStorage는 **건드리지 않는다** (사용자 취향을 조용히 덮어쓰지 않는다)',
    lsAfter === '0', `ls=${lsAfter} (0이어야 한다 — 1이면 취향을 덮어썼다)`)

  // 새로고침하면 사용자가 고른 기본 폭으로 돌아가야 한다
  await openPanel()
  const afterReload = await panelW() as number
  check('F-1 새로고침하면 사용자가 고른 기본 폭으로 복귀한다',
    afterReload === base, `${afterReload} vs 기본 ${base}`)

  // ── F-2 ───────────────────────────────────────────────────────────────────
  // ⚠ iframe은 **시작된 자체점검 회차가 있는 고객**에서만 그려진다. 기본 대상 고객엔 없어서
  //   첫 실행이 '측정 불가'로 끝났다 — 계획서+점검을 모두 가진 후보를 순회해 실측을 확보한다.
  const { data: insp } = await raw.from('inspections').select('customer_id').limit(2000)
  const cands = [...new Set((insp ?? []).map((r: any) => r.customer_id))]
    .filter(c => planSet.has(c))
  let frame: any = null
  for (const cid of [custId, ...cands.filter(c => c !== custId)]) {
    // ⚠ 후보를 갈아탈 때 about:blank를 거친다. split이 열린 채로 바로 이동하면
    //   srcDoc iframe이 살아 있어 net::ERR_ABORTED가 난다(첫 실행에서 이걸로 죽었다).
    // ⚠ 한 후보의 실패가 나머지를 못 보게 하면 안 된다 — 후보마다 격리한다.
    try {
      await page.goto('about:blank', { waitUntil: 'domcontentloaded' })
      await page.goto(`${BASE}/customers/${cid}?tab=plan&form=1.4`, { waitUntil: 'networkidle' })
      await page.waitForSelector('[data-testid^="form14-ledger-"]', { timeout: 30000 })
      await page.evaluate(`(() => {
        const els = [...document.querySelectorAll('[data-testid^="form14-ledger-"]')];
        if (els.length) els[0].click(); })()`)
      await page.waitForTimeout(2000)
      const b = await page.$('button:has-text("문서 미리보기 나란히")')
      if (!b) continue
      await b.click()
      await page.waitForTimeout(5000)
      frame = await page.evaluate(`(() => {
        const f = document.querySelector('iframe[title="별지 9호 미리보기"]');
        if (!f) return null;
        return { h: Math.round(f.getBoundingClientRect().height), vh: window.innerHeight };
      })()`)
      if (frame) { console.log(`  (F-2 측정 고객: ${cid})`); break }
    } catch (err: any) {
      console.log(`  (후보 ${cid.slice(0, 8)} 건너뜀: ${String(err?.message ?? err).split('\n')[0].slice(0, 60)})`)
    }
  }
  if (frame) {
    const expect = Math.min(frame.vh * 0.78, 900)
    check('F-2 미리보기 높이가 고정 640px이 아니라 min(78vh,900px)이다',
      Math.abs(frame.h - expect) < 2 && frame.h !== 640, `높이 ${frame.h} · 기대 ${expect.toFixed(0)} (vh ${frame.vh})`)
  } else {
    // 후보 전원에 '시작된 자체점검 회차'가 없어 iframe이 안 그려진다(로컬 DB 데이터 공백).
    // 그렇다고 '검증 못 함'으로 덮지 않는다 — F-2에서 **실제로 깨질 수 있는 것**은 따로 있다:
    // Tailwind가 `h-[min(78vh,900px)]` 임의값 클래스를 **생성하느냐**다. 그건 데이터 없이 잰다.
    console.log('  (시작된 자체점검 회차가 없어 실제 iframe은 못 잼 — 클래스 생성 축으로 대체)')
    const probe: any = await page.evaluate(`(() => {
      const d = document.createElement('div');
      d.className = 'h-[min(78vh,900px)]';
      document.body.appendChild(d);
      const h = Math.round(d.getBoundingClientRect().height);
      d.remove();
      return { h, vh: window.innerHeight };
    })()`)
    const expect = Math.min(probe.vh * 0.78, 900)
    check('F-2 Tailwind가 h-[min(78vh,900px)]를 실제로 생성하고 기대 높이로 계산된다',
      Math.abs(probe.h - expect) < 2 && probe.h !== 0,
      `계산 ${probe.h}px · 기대 ${expect.toFixed(0)}px (vh ${probe.vh}) — 0이면 클래스가 생성되지 않은 것`)
    // 대조군 — 구 값이 새 값과 다르다는 것까지 확인해야 '바뀌었다'가 성립한다
    check('F-2 대조군 — 구 값(640px)과 새 값이 실제로 다르다',
      Math.abs(expect - 640) > 20, `새 ${expect.toFixed(0)} vs 구 640`)
  }
  // 소스 축 — 실제 iframe이 그 클래스를 쓰는지(위 계산 축과 별개로 배선을 본다)
  const src = readFileSync('src/components/customers/plan-form14-specs.tsx', 'utf8')
  check('F-2 iframe이 새 클래스를 쓰고 구 h-[640px]는 남아 있지 않다',
    /iframe[^>]*h-\[min\(78vh,900px\)\]/.test(src) && !src.includes('h-[640px]'),
    `새 클래스 ${/h-\[min\(78vh,900px\)\]/.test(src)} · 구 잔존 ${src.includes('h-[640px]')}`)
} catch (e: any) {
  check('프로브 실행', false, e?.message ?? String(e))
} finally {
  await browser.close().catch(() => {})
  await delUser(u).catch(() => {})
}
summary()
