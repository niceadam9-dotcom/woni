/** 소방계획서_37 S4-4 — '육안 6항목'을 기계 판정 + 스크린샷으로 대체 가능한 만큼 대체한다.
 *
 *  사람 눈이어야만 하는 것("보기 좋은가")과 기계가 더 잘 보는 것("넘쳤는가·대비가 몇인가")은
 *  다르다. 후자를 사람에게 미루면 아무도 안 재고 넘어간다.
 *
 *  V-1 기본 폭에서 3-1 표가 가로로 넘치지 않는가        (scrollWidth vs clientWidth)
 *  V-2 [넓게]가 새로고침을 살아남는가                    (localStorage 왕복)
 *  V-3 나란히 미리보기 + [넓게] 조합에서 좌우가 쓸 만한가 (각 절반의 실폭)
 *  V-4 인쇄 미디어에서 패널 글자가 안 커지는가            (D37-4 — emulateMedia)
 *  V-5 배율 lg·xl에서도 표가 패널을 안 넘치는가
 *  V-6 다크 모드에서 [넓게] 버튼 대비비 (WCAG AA 4.5:1)
 *
 *  실행: npx tsx scripts/_probe37-visual.mts   → 스크린샷은 scripts/_shots37/
 */
import { mkdirSync } from 'node:fs'
import { BASE, check, summary, launch, login, mkUser, delUser, raw } from './_e2e-helpers.mjs'

const SHOTS = 'scripts/_shots37'
mkdirSync(SHOTS, { recursive: true })

/** 상대휘도 → 대비비 (WCAG). rgb() 문자열만 받는다. */
const CONTRAST = `((fg, bg) => {
  const p = s => s.match(/\\d+(\\.\\d+)?/g).slice(0,3).map(Number);
  const L = c => { const [r,g,b] = p(c).map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4) });
                   return 0.2126*r + 0.7152*g + 0.0722*b };
  const a = L(fg), b2 = L(bg);
  return (Math.max(a,b2)+0.05)/(Math.min(a,b2)+0.05);
})`

/** 패널 내부 표들의 가로 넘침 — 패널 자체와 안쪽 표 양쪽을 본다. */
const OVERFLOW = `(() => {
  const panel = document.querySelector('[data-spec-panel]');
  if (!panel) return null;
  const tables = [...panel.querySelectorAll('table, .overflow-x-auto')]
    .filter(t => t.clientWidth > 50)
    .map(t => ({ over: t.scrollWidth - t.clientWidth, cw: t.clientWidth }));
  return {
    panelW: Math.round(panel.getBoundingClientRect().width),
    panelOver: panel.scrollWidth - panel.clientWidth,
    tables: tables.length,
    worstTable: tables.reduce((m, t) => Math.max(m, t.over), 0),
    fs: (() => { const el = panel.querySelector('.text-form-xs');
                 return el ? parseFloat(getComputedStyle(el).fontSize) : 0 })(),
  };
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
console.log(`대상 고객 ${custId} (설치 설비 ${ranked[0]?.n}개)\n`)

const email = `s37vis_${Date.now()}@example.com`
const u = await mkUser({ email, name: 'S37 육안', employeeId: `S37V${Date.now() % 100000}` })
const { browser, page } = await launch()

async function openPanel(p: any) {
  await p.goto(URL, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid^="form14-ledger-"]', { timeout: 30000 })
  await p.evaluate(`(() => {
    const els = [...document.querySelectorAll('[data-testid^="form14-ledger-"]')];
    if (els.length) els[0].click(); })()`)
  await p.waitForSelector('[data-spec-panel]', { timeout: 15000 })
  await p.waitForTimeout(2500)
}

try {
  await page.setViewportSize({ width: 1600, height: 1000 })
  page.setDefaultTimeout(45000)
  await login(page, email)

  // ── V-1 기본 폭 ───────────────────────────────────────────────────────────
  await openPanel(page)
  const v1: any = await page.evaluate(OVERFLOW)
  await page.screenshot({ path: `${SHOTS}/v1-기본폭.png` })
  console.log(`V-1 기본  폭 ${v1.panelW}px · 표 ${v1.tables}개 · 최악넘침 ${v1.worstTable}px · 글자 ${v1.fs}px`)
  check('V-1 기본 폭에서 패널·표가 가로로 넘치지 않는다',
    v1.panelOver <= 1 && v1.worstTable <= 1 && v1.tables > 0,
    `패널넘침 ${v1.panelOver} · 표최악 ${v1.worstTable} · 표 ${v1.tables}개`)

  // ── V-2 [넓게] 지속성 ─────────────────────────────────────────────────────
  await page.click('[data-testid="specs-wide-toggle"]')
  await page.waitForTimeout(600)
  const wideW: any = await page.evaluate(OVERFLOW)
  await page.screenshot({ path: `${SHOTS}/v2-넓게.png` })
  const ls = await page.evaluate(`localStorage.getItem('erp-spec-panel-wide')`)
  await openPanel(page)                                   // 새로고침 후 재진입
  const afterReload: any = await page.evaluate(OVERFLOW)
  const pressed = await page.getAttribute('[data-testid="specs-wide-toggle"]', 'aria-pressed')
  console.log(`V-2 넓게  ${v1.panelW} → ${wideW.panelW}px · localStorage=${ls} · 새로고침후 ${afterReload.panelW}px (aria-pressed=${pressed})`)
  check('V-2 [넓게]가 폭을 실제로 늘리고 새로고침을 살아남는다',
    wideW.panelW > v1.panelW + 200 && ls === '1' && afterReload.panelW === wideW.panelW && pressed === 'true',
    `기본 ${v1.panelW} · 넓게 ${wideW.panelW} · 새로고침 ${afterReload.panelW} · ls=${ls}`)

  // ── V-3 나란히 미리보기 + 넓게 ────────────────────────────────────────────
  const splitBtn = await page.$('button:has-text("문서 미리보기 나란히")')
  if (splitBtn) {
    await splitBtn.click()
    await page.waitForTimeout(4000)
    const half: any = await page.evaluate(`(() => {
      const panel = document.querySelector('[data-spec-panel]');
      const halves = [...panel.querySelectorAll('.md\\\\:w-1\\\\/2')];
      return { n: halves.length, w: halves.map(h => Math.round(h.getBoundingClientRect().width)) };
    })()`)
    await page.screenshot({ path: `${SHOTS}/v3-나란히+넓게.png` })
    console.log(`V-3 나란히  절반 ${JSON.stringify(half.w)}px`)
    check('V-3 나란히+넓게에서 좌우 각 절반이 500px 이상 (종전 640px 패널에선 ~300px였다)',
      half.n > 0 && half.w.every((w: number) => w >= 500), JSON.stringify(half))
  } else {
    check('V-3 나란히 토글 버튼 존재', false, '버튼을 못 찾음')
  }

  // ── V-4 인쇄 미디어 (D37-4) ───────────────────────────────────────────────
  await openPanel(page)
  const screenFs: any = await page.evaluate(OVERFLOW)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(400)
  const printFs: any = await page.evaluate(OVERFLOW)
  await page.screenshot({ path: `${SHOTS}/v4-인쇄미디어.png` })
  await page.emulateMedia({ media: 'screen' })
  console.log(`V-4 인쇄  화면 ${screenFs.fs}px → 인쇄 ${printFs.fs}px (구 값 11px이어야 함)`)
  check('V-4 인쇄 미디어에서 패널 글자가 구 값으로 되돌아간다 (부스트가 인쇄로 안 샌다)',
    printFs.fs < screenFs.fs && Math.abs(printFs.fs - 11) < 0.6,
    `화면 ${screenFs.fs} → 인쇄 ${printFs.fs}`)

  // ── V-5 배율 lg·xl 넘침 ───────────────────────────────────────────────────
  // ⚠ [넓게]를 끄고 잰다. 켠 채로 재면 1400×배율이 96vw 상한(1600px 뷰포트 → 1536)에
  //   눌려 **세 배율이 전부 1536px로 같아진다** — 폭이 안 커진 게 아니라 화면이 좁은 것이다.
  //   (첫 실행에서 이걸로 V-5b가 거짓 실패했다. 상한에 걸린 조건에서 '함께 커지는가'는 물을 수 없다.)
  await page.evaluate(`localStorage.setItem('erp-spec-panel-wide','0')`)
  await openPanel(page)
  const perScale: any = {}
  for (const s of ['md', 'lg', 'xl']) {
    await page.evaluate(`document.documentElement.setAttribute('data-fs','${s}')`)
    await page.waitForTimeout(700)
    perScale[s] = await page.evaluate(OVERFLOW)
    await page.screenshot({ path: `${SHOTS}/v5-배율-${s}.png` })
  }
  await page.evaluate(`document.documentElement.removeAttribute('data-fs')`)
  console.log(`V-5 배율  ` + ['md', 'lg', 'xl'].map(s => `${s}: 폭${perScale[s].panelW}/글자${perScale[s].fs}/넘침${perScale[s].worstTable}`).join(' · '))
  check('V-5 배율 lg·xl에서도 표가 패널을 넘치지 않는다 (폭이 글자와 함께 커진다)',
    ['md', 'lg', 'xl'].every(s => perScale[s].worstTable <= 1 && perScale[s].panelOver <= 1),
    JSON.stringify(['md', 'lg', 'xl'].map(s => `${s}:${perScale[s].worstTable}`)))
  check('V-5b 배율이 올라가면 글자와 폭이 **함께** 커진다',
    perScale.xl.fs > perScale.md.fs && perScale.xl.panelW > perScale.md.panelW,
    `md ${perScale.md.fs}px/${perScale.md.panelW} → xl ${perScale.xl.fs}px/${perScale.xl.panelW}`)

  // ── V-6 다크 모드 대비 ────────────────────────────────────────────────────
  const dark = await browser.newContext({ viewport: { width: 1600, height: 1000 },
    storageState: await page.context().storageState(), colorScheme: 'dark' })
  const dp = await dark.newPage()
  dp.setDefaultTimeout(45000)
  // ⚠ 루트(/)로 먼저 가지 않는다 — 리다이렉트 때문에 domcontentloaded가 45초를 넘겼다.
  //   측정 화면으로 직행한 뒤 .dark를 얹는다.
  await openPanel(dp)
  await dp.evaluate(`document.documentElement.classList.add('dark')`)
  await dp.waitForTimeout(800)
  const c6: any = await dp.evaluate(`(() => {
    const b = document.querySelector('[data-testid="specs-wide-toggle"]');
    if (!b) return null;
    const cs = getComputedStyle(b);
    let bg = cs.backgroundColor, el = b;
    while ((bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && el.parentElement) { el = el.parentElement; bg = getComputedStyle(el).backgroundColor }
    return { fg: cs.color, bg, ratio: ${CONTRAST}(cs.color, bg) };
  })()`)
  await dp.screenshot({ path: `${SHOTS}/v6-다크.png` })
  await dark.close()
  console.log(`V-6 다크  글자 ${c6?.fg} / 배경 ${c6?.bg} → 대비 ${c6?.ratio?.toFixed(2)}:1`)
  check('V-6 다크 모드 [넓게] 버튼 대비비가 WCAG AA(4.5:1) 이상',
    !!c6 && c6.ratio >= 4.5, `${c6?.ratio?.toFixed(2)}:1 (fg ${c6?.fg} / bg ${c6?.bg})`)

  console.log(`\n스크린샷: erp/${SHOTS}/`)
} catch (e: any) {
  check('프로브 실행', false, e?.message ?? String(e))
} finally {
  await browser.close().catch(() => {})
  await delUser(u).catch(() => {})
}
summary()
