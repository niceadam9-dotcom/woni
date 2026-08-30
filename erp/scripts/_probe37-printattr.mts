/** 소방계획서_37 — 인쇄 기준선 10px 31→32의 **귀속**을 실측으로 가른다.
 *
 *  두 후보가 있다. 둘 다 인쇄 미디어에서 text-form-2xs → 10px로 계수된다:
 *    ⓐ 내가 넣은 [넓게] 버튼(소방계획서_37)
 *    ⓑ 1.4의 비동기 안내문 — 타 세션이 54840d8에서 '31↔32 진동'으로 보고한 그것
 *
 *  나는 S4-1에서 "+1은 내 버튼"이라고 기록했다. 근거는 추론뿐이었다. 틀렸다면 문서를 고쳐야 한다.
 *  → 버튼을 CSS로 숨기고(=계수에서 빠지게) 인쇄 미디어에서 다시 센다. 차이가 곧 내 몫이다.
 *
 *  실행: npx tsx scripts/_probe37-printattr.mts
 */
import { BASE, check, summary, launch, login, mkUser, delUser, raw } from './_e2e-helpers.mjs'

/** 인쇄 축이 쓰는 것과 **같은** 모집단: text-form-* 클래스를 가진 요소 전부(가시성 무관). */
const TOKENS = `(() => {
  const hist = {}; let n = 0;
  for (const el of document.querySelectorAll('[class*="text-form-"]')) {
    const fs = getComputedStyle(el).fontSize;
    hist[fs] = (hist[fs] ?? 0) + 1; n++;
  }
  return { hist, n };
})()`

/** ⚠ CSS로 숨기면 안 된다. 인쇄 축의 모집단(COLLECT_TOKENS)은 **가시성을 안 본다** —
 *  `[class*="text-form-"]` 전수라 display:none이어도 그대로 계수된다(항등 축은 반대로
 *  boundingRect로 거르므로 숨기기가 통했다. 축마다 대조 기법이 다르다).
 *  실제로 첫 실행에서 이걸 몰라 32↔32가 나왔고 '내 귀속이 틀렸다'고 오판할 뻔했다.
 *  → DOM에서 **제거**해야 진짜 대조군이 된다. */
const REMOVE_BTN = `(() => {
  const b = document.querySelector('[data-testid="specs-wide-toggle"]');
  if (!b) return false; b.remove(); return true;
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
const URL = `${BASE}/customers/${custId}?tab=plan&form=1.4`

const email = `s37pa_${Date.now()}@example.com`
const u = await mkUser({ email, name: 'S37 귀속', employeeId: `S37A${Date.now() % 100000}` })
const { browser, page } = await launch()

/** 타 세션의 settleTokens와 같은 규약(안정 3회 + 하한 2.5s) — '안 온 것'과 '오고 멈춘 것' 구별. */
async function settle(p: any, minMs = 2800) {
  const t0 = Date.now(); let last = -1, stable = 0
  for (let i = 0; i < 24; i++) {
    const n: number = await p.evaluate(`document.querySelectorAll('[class*="text-form-"]').length`)
    if (n > 0 && n === last) stable++; else { stable = 0; last = n }
    if (stable >= 3 && Date.now() - t0 >= minMs) return n
    await p.waitForTimeout(300)
  }
  return last
}

async function measure(removeBtn: boolean) {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.evaluate('document.fonts.ready').catch(() => {})
  await settle(page)
  // 제거는 **정착 뒤**에 한다 — 정착 전에 지우면 리액트 리렌더가 되살릴 수 있다.
  if (removeBtn) {
    const ok = await page.evaluate(REMOVE_BTN)
    if (!ok) throw new Error('대조군 실패 — [넓게] 버튼을 못 찾아 제거하지 못했다')
  }
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(500)
  const t: any = await page.evaluate(TOKENS)
  await page.emulateMedia({ media: 'screen' })
  return t
}

try {
  await page.setViewportSize({ width: 1600, height: 1000 })
  page.setDefaultTimeout(45000)
  await login(page, email)

  const shown = await measure(false)
  const hidden = await measure(true)
  const g = (h: any) => h.hist['10px'] ?? 0
  console.log(`인쇄 10px — 버튼 보임 ${g(shown)} · 버튼 숨김 ${g(hidden)}  (총 노드 ${shown.n} / ${hidden.n})`)
  console.log(`전체 히스토그램(보임): ${JSON.stringify(shown.hist)}`)

  check('버튼이 인쇄 축 10px에 실제로 계수된다 (기여분 정확히 1)',
    g(shown) - g(hidden) === 1, `보임 ${g(shown)} · 숨김 ${g(hidden)}`)
  check('커밋된 인쇄 기준선(32)이 버튼 포함 값과 일치한다 — S4-1 귀속 기록이 옳다',
    g(shown) === 32, `실측 ${g(shown)} vs 기준선 32`)
  check('버튼을 빼면 구 기준선(31)과 같다 — 즉 +1은 안내문이 아니라 버튼이다',
    g(hidden) === 31, `숨김 ${g(hidden)} vs 구 기준선 31`)
} catch (e: any) {
  check('프로브 실행', false, e?.message ?? String(e))
} finally {
  await browser.close().catch(() => {})
  await delUser(u).catch(() => {})
}
summary()
