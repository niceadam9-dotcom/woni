/** 소방계획서_37 R-a — `--cls` 귀속 검사가 왜 가끔 무너지는가 (기전 증명 · 2×2 대조)
 *
 *  ── 무엇을 묻는가 ────────────────────────────────────────────────────────────
 *  독립 판정(2026-08-30)에서 `--cls`가 1회차에 **2통과/1실패**했다. 실패한 것은
 *  'S0-6 귀속 — 레이아웃 이동이 폰트 교체에서 온다 (정상 − 대조군)'이고, 그때 정상 CLS가
 *  **0.00082 · 이동 0회**였다(정상 실행인데 리플로우가 없었다). 2회차엔 0.26517 · 이동 1회.
 *
 *  ⚠ 조용한 트리에서 `--cls`를 3회 돌리면 3/3 통과한다(이동 1회, CLS 0.2651±0.0001).
 *    즉 **증상은 재현되지 않는다.** 재현 없이 '고쳤다'고 말할 수 없으므로,
 *    S4-5와 같은 방식으로 **조건을 주입해 기전을 증명**한다.
 *
 *  ── 가설 ─────────────────────────────────────────────────────────────────────
 *  FOUT(그래서 리플로우)는 웹폰트가 **첫 페인트 뒤**에 도착해야 일어난다. 폰트가 페인트보다
 *  먼저 오면 처음부터 Pretendard로 그려져 갈아끼움 자체가 없고 이동은 0이다.
 *  현재 하니스는 폰트 응답을 **고정 150ms** 늦춘다 — 페이지가 그보다 느리게 그려지는 순간
 *  (dev 콜드 컴파일·타 세션 부하) 폰트가 경주에서 이겨 **정상 실행인데 FOUT이 없다**.
 *  S4-5와 같은 계열이다: 고정 대기가 문턱에 걸쳐 있다.
 *
 *  ⚠ 처음에 세운 다른 가설은 **틀렸다** — `p.evaluate('document.fonts.ready')`가 직렬화
 *    불가 값을 던져 `.catch()`에 삼켜지고 대기가 사라진다고 봤으나, Playwright는 in-page에서
 *    프라미스를 **먼저 await한 뒤** 직렬화한다. 대기는 실제로 일어난다. 코드를 읽고 접었다.
 *
 *  ── 2×2 ──────────────────────────────────────────────────────────────────────
 *    축 A(조건) : 폰트 지연 0ms(페인트보다 먼저 도착 = 주입) vs 150ms(현행)
 *    축 B(하니스): 구 = 고정 지연        vs  신 = **페인트 게이트**(페인트 관측 뒤 폰트 방류)
 *
 *    ① 0ms   + 구  → 이동 0 이면 증상 재현(가설 성립)
 *    ② 150ms + 구  → 이동 1 (현행이 평소 통과하는 이유)
 *    ③ 0ms   + 신  → 이동 1 이면 **수리가 주입된 조건을 이긴다**
 *    ④ 150ms + 신  → 이동 1 (무회귀)
 *
 *  실행: npx tsx scripts/_probe37-clsrace.mts        (dev 서버 필요)
 */
import { raw, BASE, check, summary, launch, login, mkUser, delUser } from './_e2e-helpers.mjs'

/** 본 하니스(test-plan-readability.mts:181)와 **같은** 관측자 + 첫 페인트 플래그. */
const INIT = `
  window.__cls = 0; window.__shifts = []; window.__painted = 0;
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__cls += e.value;
      if (e.value > 0.001) window.__shifts.push({ v: +e.value.toFixed(5), t: Math.round(e.startTime) });
    }
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) {
      if (e.name === 'first-contentful-paint') window.__painted = Math.round(e.startTime);
    }
  }).observe({ type: 'paint', buffered: true });`

// 측정 대상 고객 — 본 하니스와 같은 기준(설치 설비가 가장 많은 + 계획서 보유).
// 아무 고객이나 쓰면 rowtable이 안 그려져 FOUT이 아픈 곳을 안 보게 된다.
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
console.log(`대상 고객 ${custId}\n`)

const email = `s37cls_${Date.now()}@example.com`
const u = await mkUser({ email, name: 'S37 CLS', employeeId: `S37C${Date.now() % 100000}` })
const { browser } = await launch()

type Cell = { id: string; delay: number; gate: boolean }
const CELLS: Cell[] = [
  { id: '① 지연0ms  + 구(고정)   ', delay: 0,   gate: false },
  { id: '② 지연150ms + 구(고정)  ', delay: 150, gate: false },
  { id: '③ 지연0ms  + 신(페인트) ', delay: 0,   gate: true },
  { id: '④ 지연150ms + 신(페인트)', delay: 150, gate: true },
]
const out: Record<string, any> = {}

try {
  for (const c of CELLS) {
    // ⚠ 매 셀 **새 컨텍스트** — 캐시에 폰트가 남으면 FOUT 자체가 안 난다(본 하니스와 같은 조건).
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    ctx.setDefaultTimeout(20000)
    const p = await ctx.newPage()
    await p.addInitScript(INIT)

    await p.route('**/fonts/pretendard/**', async (r: any) => {
      if (c.gate) {
        // 신 방식 — 첫 페인트를 **관측한 뒤** 폰트를 방류한다. 그래야 갈아끼움이 반드시 보인다.
        //   시간이 아니라 사건에 건다(S4-5에서 배운 것). 3초 상한은 안전장치일 뿐이다.
        const t0 = Date.now()
        while (Date.now() - t0 < 3000) {
          const painted = await p.evaluate('window.__painted').catch(() => 0)
          if (painted) break
          await new Promise(res => setTimeout(res, 50))
        }
      }
      if (c.delay) await new Promise(res => setTimeout(res, c.delay))
      return r.continue()
    })

    await login(p, email)
    await p.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4`, { waitUntil: 'load' })
    await p.evaluate('document.fonts.ready').catch(() => {})
    await p.waitForTimeout(2500)
    out[c.id] = await p.evaluate(`(() => {
      const f = performance.getEntriesByType('resource').filter(r => r.name.includes('/fonts/pretendard/'));
      const first = f.length ? Math.round(Math.min(...f.map(r => r.responseEnd))) : null;
      return { cls: +window.__cls.toFixed(5), shifts: window.__shifts.length,
        painted: window.__painted, fontEnd: first,
        loaded: [...document.fonts].filter(x => x.family.includes('Pretendard') && x.status === 'loaded').length } })()`)
    const o = out[c.id]
    console.log(`${c.id} → CLS=${o.cls}  이동 ${o.shifts}회  FCP ${o.painted}ms  폰트도착 ${o.fontEnd}ms  ${o.fontEnd > o.painted ? '(폰트가 늦다 = FOUT 조건 성립)' : '⚠ 폰트가 페인트를 이겼다'}  ${o.loaded}조각`)
    await ctx.close()
  }
} catch (e: any) {
  check('2×2 실행', false, e?.message ?? String(e))
} finally {
  await browser.close(); await delUser(u)
}

console.log('')
const [a, b, c2, d] = CELLS.map(c => out[c.id])

// 항진 차단 — 네 셀 모두 폰트가 실제로 로드됐어야 비교가 의미를 갖는다.
//   하나라도 0조각이면 그건 '차단된 대조군'이지 이 실험의 셀이 아니다.
check('전제: 네 셀 모두 Pretendard가 로드됐다 (차단 대조군과 섞이지 않았다)',
  [a, b, c2, d].every(x => (x?.loaded ?? 0) > 0),
  [a, b, c2, d].map(x => x?.loaded).join(' / '))

check('① 주입 — 폰트가 페인트보다 먼저 오면 리플로우가 사라진다 (증상 재현)',
  (a?.shifts ?? 9) === 0 && (a?.cls ?? 9) < 0.05,
  `CLS=${a?.cls} 이동=${a?.shifts}회 — 0회여야 가설 성립`)

check('② 현행이 평소 통과하는 이유 — 150ms면 대개 페인트가 먼저다',
  (b?.shifts ?? 0) >= 1 && (b?.cls ?? 0) > 0.2,
  `CLS=${b?.cls} 이동=${b?.shifts}회`)

check('③ 페인트 게이트는 지연 0ms에서도 리플로우를 되살린다 (①의 증상은 이긴다)',
  (c2?.shifts ?? 0) >= 1,
  `CLS=${c2?.cls} 이동=${c2?.shifts}회 — ①이 0회인데 여기서 1회 이상이면 게이트가 원인축을 덮는다`)

// ⭐ 여기서 실험이 내 예상을 뒤집었다. 게이트는 증상을 이기지만 **측정값을 바꾼다** —
//   0.265(이동 1회)가 0.12(이동 2~3회)로 반토막 나고 쪼개진다. 폰트를 페인트 뒤로 미루면
//   갈아끼움이 '이미 더 그려진 화면' 위에서 일어나 이동이 분산되기 때문이다.
//   즉 채택하려면 35 소유의 CLS 기준선(0.27315)을 **다시 떠야 한다**. 그건 내 문서의 결정이 아니다.
//   → 이 단언은 '게이트를 쓰면 안 된다'를 **적극적으로 고정**한다(다음 사람이 같은 길로 가지 않도록).
check('④ ⚠ 그러나 게이트는 값을 보존하지 못한다 — 그래서 채택하지 않는다',
  Math.abs((d?.cls ?? 0) - (b?.cls ?? 0)) > 0.05,
  `구 ${b?.cls} / 신 ${d?.cls} — 차이가 크므로 기준선 재기록 없이는 바꿀 수 없다(소유자: 소방계획서_35)`)

summary('소방계획서_37 R-a — CLS 경주 기전 2×2')
