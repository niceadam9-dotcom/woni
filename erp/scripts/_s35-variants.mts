/** 소방계획서_35 S3 — 확대 후보안 미리보기 + 넘침 실측.
 *
 *  S2에서 모든 크기가 CSS 변수(--fs-1..6, --fs-h6..8, --fs-col-num)로 모였기 때문에
 *  **globals.css를 고치지 않고** 런타임에 :root를 덮어 후보안을 즉석 비교할 수 있다.
 *  이게 토큰화의 실질 이득이다 — 안마다 빌드·배포할 필요가 없다.
 *
 *  각 안마다 1.4 본문 + 세부제원 패널을 찍고, 동시에 표 넘침을 실측한다.
 *  "커 보이나?"와 "칸이 넘치나?"는 다른 축이고 둘 다 봐야 결정할 수 있다.
 *
 *  실행: npx tsx scripts/_s35-variants.mts
 */
import { mkdirSync } from 'node:fs'
import { raw, BASE, launch, login, mkUser, delUser } from './_e2e-helpers.mjs'

const OUT = 'scripts/_shots'
mkdirSync(OUT, { recursive: true })

type Variant = { id: string; label: string; vars: Record<string, string> | null }
const VARIANTS: Variant[] = [
  { id: 'A-current', label: 'A 현행 (9/10/11/12/14/16)', vars: null },
  { id: 'B-plus1',   label: 'B 보수 +1 (10/11/12/13/15/17)',
    vars: { '--fs-1': '10px', '--fs-2': '11px', '--fs-3': '12px', '--fs-4': '13px', '--fs-5': '15px', '--fs-6': '17px',
            '--fs-h6': '26px', '--fs-h7': '30px', '--fs-h8': '34px', '--fs-col-num': '48px' } },
  { id: 'C-design',  label: 'C 설계안 (11/12/13/14/15/17)',
    vars: { '--fs-1': '11px', '--fs-2': '12px', '--fs-3': '13px', '--fs-4': '14px', '--fs-5': '15px', '--fs-6': '17px',
            '--fs-h6': '28px', '--fs-h7': '32px', '--fs-h8': '36px', '--fs-col-num': '52px' } },
  { id: 'D-large',   label: 'D 큼 (12/13/14/15/16/18)',
    vars: { '--fs-1': '12px', '--fs-2': '13px', '--fs-3': '14px', '--fs-4': '15px', '--fs-5': '16px', '--fs-6': '18px',
            '--fs-h6': '30px', '--fs-h7': '34px', '--fs-h8': '38px', '--fs-col-num': '58px' } },
]

const { data: facRows } = await raw.from('fire_facilities').select('building_id, installed').eq('installed', true).limit(5000)
const byBld = new Map<string, number>()
for (const r of facRows ?? []) byBld.set(r.building_id, (byBld.get(r.building_id) ?? 0) + 1)
const { data: blds } = await raw.from('buildings').select('id, customer_id').in('id', [...byBld.keys()].slice(0, 200))
const { data: plans } = await raw.from('fire_plans').select('customer_id')
const planSet = new Set((plans ?? []).map(p => p.customer_id))
const custId = (blds ?? []).map(b => ({ c: b.customer_id, n: byBld.get(b.id) ?? 0 }))
  .filter(x => planSet.has(x.c)).sort((a, b) => b.n - a.n)[0]?.c
if (!custId) { console.log('❌ 대상 고객 없음'); process.exit(1) }

const email = `s35var_${Date.now()}@example.com`
const u = await mkUser({ email, name: 'S35 변경안', employeeId: `S35V${Date.now() % 100000}` })
const { browser, page } = await launch()

/** ⚠ 재기 전에 **값을 넣는다.** 빈 입력칸은 어떤 크기에서도 넘치지 않는다 —
 *  값 없이 잰 '넘침 0'은 항진명제다(설계서 §6 검사3 항진경로 ③). */
const FILL = `(() => {
  const inputs = [...document.querySelectorAll('[data-testid^="rowtable-"] input')];
  let filled = 0;
  for (const i of inputs) {
    if (i.disabled) continue;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    // 숫자열엔 5자리, 넓은 열(동·비고)엔 실제로 쓰일 법한 한글을 넣는다
    const wide = i.classList.contains('text-left');
    setter.call(i, wide ? '지하주차장동' : '99999');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    filled++;
  }
  return { total: inputs.length, filled };
})()`

const MEASURE = `(() => {
  const tables = []; let skipped = 0;
  for (const t of document.querySelectorAll('table, .overflow-x-auto')) {
    if (t.clientWidth <= 50) { skipped++; continue }
    tables.push({ id: t.getAttribute('data-testid') || t.tagName.toLowerCase(), sw: t.scrollWidth, cw: t.clientWidth });
  }
  const inputs = [...document.querySelectorAll('[data-testid^="rowtable-"] input')];
  const cut = inputs.filter(i => i.scrollWidth > i.clientWidth + 1).length;
  const clipped = inputs.filter(i => {
    const cs = getComputedStyle(i); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    return i.clientHeight < lh - 0.5;
  }).length;
  return { tables, skipped, rowtableInputs: inputs.length, widthCut: cut, heightClipped: clipped,
           docOver: document.documentElement.scrollWidth > document.documentElement.clientWidth,
           minFs: Math.min(...[...document.querySelectorAll('body *')].filter(e => {
             for (const n of e.childNodes) if (n.nodeType===3 && n.textContent.trim()) return true; return false })
             .map(e => parseFloat(getComputedStyle(e).fontSize))) };
})()`

console.log(`대상 고객 ${custId}\n`)
console.log('안'.padEnd(34), '최소글자'.padEnd(9), 'rowtable입력'.padEnd(13), '가로잘림', '높이잘림', '표넘침', '페이지밀림')
try {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await login(page, email)

  for (const v of VARIANTS) {
    await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4`, { waitUntil: 'networkidle' })
    if (v.vars) {
      const decl = Object.entries(v.vars).map(([k, val]) => `${k}:${val} !important`).join(';')
      await page.addStyleTag({ content: `:root{${decl}}` })
    }
    await page.evaluate('document.fonts.ready')
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/s35-var-${v.id}-form14.png` })

    // 세부제원 패널 (44px 숫자열이 있는 진짜 위험 지점)
    await page.evaluate(`(() => { const e=document.querySelector('[data-testid^="form14-ledger-"]'); if(e) e.click() })()`)
    await page.waitForTimeout(1600)
    const f: any = await page.evaluate(FILL)
    await page.waitForTimeout(400)
    const m: any = await page.evaluate(MEASURE)
    await page.screenshot({ path: `${OUT}/s35-var-${v.id}-specs.png` })

    const over = m.tables.filter((t: any) => t.sw > t.cw + 1)
    console.log(
      v.label.padEnd(34),
      `${m.minFs}px`.padEnd(9),
      `${f.filled}/${f.total}`.padEnd(13),
      `${m.widthCut}`.padEnd(8),
      `${m.heightClipped}`.padEnd(8),
      `${over.length}`.padEnd(6),
      m.docOver ? 'YES' : '-')
    if (over.length) console.log('       넘친 표:', over.map((t: any) => `${t.id} ${t.sw}>${t.cw}`).join(' · '))
  }
} catch (e: any) {
  console.log('실패:', e?.message ?? e)
} finally {
  await browser.close(); await delUser(u)
}
console.log(`\n산출: ${OUT}/s35-var-{A-current,B-plus1,C-design,D-large}-{form14,specs}.png`)
