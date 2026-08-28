// 소방계획서_29 — 다크에서 "밝게 남은 요소" 전수 스캔 (진단용)
//
// 눈짐작 대신 computed backgroundColor의 휘도를 재서 **밝은 면을 전부 뽑는다**.
// 클래스명을 함께 찍으므로 원인 지점(토큰 미적용·인라인 style·라이브러리 CSS)이 바로 드러난다.
// 실행: npx tsx scripts/_probe-29-light-scan.mts
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'theme-scan@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

/** 화면별로 밝은 요소 상위 N개를 반환하는 브라우저 식(문자열 — tsx __name 주입 회피) */
const SCAN = `(function(){
  var out = [], seen = {};
  var els = document.querySelectorAll('*');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var cs = getComputedStyle(el);
    var bg = cs.backgroundColor;
    var m = /^rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?\\)$/.exec(bg);
    if (!m) continue;
    var a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a < 0.5) continue;                        // 투명 면은 부모 색이 보인다
    var lum = (0.2126*+m[1] + 0.7152*+m[2] + 0.0722*+m[3]) / 255;
    if (lum < 0.55) continue;                     // 어두우면 정상
    var r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 12) continue;  // 아이콘·점 등 미세 요소 제외
    var cls = (typeof el.className === 'string' ? el.className : '').slice(0, 90);
    var key = el.tagName + '|' + cls + '|' + bg;
    if (seen[key]) { seen[key].n++; continue; }
    seen[key] = { n: 1 };
    out.push({ key: key, bg: bg, area: Math.round(r.width * r.height), tag: el.tagName, cls: cls, inline: el.getAttribute('style') || '' });
  }
  out.sort(function(a,b){ return b.area - a.area; });
  return JSON.stringify(out.slice(0, 14));
})()`

async function scan(page: { goto: (u: string) => Promise<unknown>; waitForTimeout: (n: number) => Promise<void>; evaluate: (s: string) => Promise<unknown>; waitForLoadState: (s: string) => Promise<unknown> }, path: string, label: string) {
  await page.goto(`${BASE}${path}`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1200)
  const raw = (await page.evaluate(SCAN)) as string
  const list = JSON.parse(raw) as Array<{ bg: string; area: number; tag: string; cls: string; inline: string }>
  console.log(`\n── ${label} (${path}) — 밝은 면 ${list.length}종`)
  for (const it of list) {
    console.log(`   ${it.bg}  area=${it.area}  <${it.tag}> ${it.cls}${it.inline ? `  style="${it.inline.slice(0, 60)}"` : ''}`)
  }
  return list
}

try {
  userId = await mkUser({ email: EMAIL, name: '밝기스캔', employeeId: 'E2E-SCN' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, EMAIL)
  await page.goto(`${BASE}/settings`)
  await page.waitForSelector('[data-testid="theme-option-dark"]')
  await page.click('[data-testid="theme-option-dark"]')
  await page.waitForSelector('[data-testid="theme-saved"]', { timeout: 15000 })

  const cal = await scan(page, '/inspections/calendar', '점검 달력(월)')
  // 주·목록 뷰도 — 월 뷰만 보고 '됐다' 하면 나머지가 남는다
  for (const [sel, label] of [['button:text-is("주")', '주간'], ['button:text-is("목록")', '목록']] as const) {
    await page.click(sel).catch(() => {})
    await page.waitForTimeout(1200)
    const raw = (await page.evaluate(SCAN)) as string
    const list = JSON.parse(raw) as Array<{ bg: string; area: number; tag: string; cls: string; inline: string }>
    console.log(`\n── 점검 달력(${label}) — 밝은 면 ${list.length}종`)
    for (const it of list) console.log(`   ${it.bg}  area=${it.area}  <${it.tag}> ${it.cls}${it.inline ? `  style="${it.inline.slice(0, 60)}"` : ''}`)
  }
  const plans = await scan(page, '/inspection-plans', '점검확정')
  const leaves = await scan(page, '/leaves/calendar', '휴가 달력')

  check('스캔 완주', true, `달력 ${cal.length}종 · 점검확정 ${plans.length}종 · 휴가 ${leaves.length}종`)
} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
summary('다크 밝은 면 스캔')
