/** 컨트롤·글리프 덩어리에 **이름을 붙이고** 시트 좌표로 되돌린다 — 고칠 값을 바로 낸다.
 *
 *  앞 단계(`_probe-cb-render3-measure`)는 「어긋났다」까지만 말한다. 얼마나 어긋났는지를
 *  **시트 px**로 알아야 표를 고칠 수 있고, 그러려면 덩어리가 어느 상자인지 알아야 한다.
 *
 *  방법: 컨트롤이 **어디 있어야 하는지는 제품이 이미 안다**(`col*13 + inset + offset`).
 *  그 기대 좌표와 관측 컨트롤을 띠 단위로 맞대고, 최소제곱으로 `render = a*sheet + b`를 구한다.
 *  🚨 **잔차가 작아야만** 이름이 맞다고 본다 — 크면 짝짓기가 틀린 것이므로 수치를 쓰지 않는다.
 *  그 뒤 글리프를 같은 식으로 시트 좌표로 되돌리면 **필요한 offset = 글리프 − col*13 − inset**.
 *
 *  실행: CB3_PNGSUF=-lo npx tsx scripts/_probe-cb-render3-fit.mts 8,9,15
 */
import sharp from 'sharp'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { FIRE_PLAN_MANIFEST, sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { firePlanCheckboxCells } from '../src/lib/fire-plan-checkbox-controls.ts'

const DIR = path.join(process.env.TEMP ?? '/tmp', 'cb3')
const SUF = process.env.CB3_PNGSUF ?? ''
const PX_PER_COL = 13
const TEXT_INSET_PX = 15       // 제품 상수(여기서 재는 대상이다 — 고정값으로 쓰지 말고 결과를 볼 것)
const sheetIdx = (process.argv[2] ?? '8').split(',').map(s => Number(s.trim()))
const names = FIRE_PLAN_MANIFEST.sheets.map(s => s.name)

type Run = { x0: number; x1: number; y0: number; y1: number }
const cy = (r: Run) => (r.y0 + r.y1) / 2

async function changedRuns(a: string, b: string): Promise<Run[]> {
  const A = await sharp(a).greyscale().raw().toBuffer({ resolveWithObject: true })
  const B = await sharp(b).greyscale().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = A.info
  type Seg = { y: number; x0: number; x1: number; p: number }
  const segs: Seg[] = []
  for (let y = 0; y < h; y++) {
    let bx = -1
    for (let x = 0; x <= w; x++) {
      const on = x < w && Math.abs(A.data[y * w + x] - B.data[y * w + x]) > 18
      if (on) { if (bx < 0) bx = x; continue }
      if (bx >= 0) { segs.push({ y, x0: bx, x1: x - 1, p: segs.length }); bx = -1 }
    }
  }
  const find = (i: number): number => { while (segs[i].p !== i) { segs[i].p = segs[segs[i].p].p; i = segs[i].p } return i }
  const uni = (i: number, j: number) => { const p = find(i), q = find(j); if (p !== q) segs[p].p = q }
  let lo = 0
  for (let i = 0; i < segs.length; i++) {
    while (lo < segs.length && segs[lo].y < segs[i].y - 1) lo++
    for (let j = lo; j < i; j++) {
      if (segs[j].y !== segs[i].y - 1) continue
      if (segs[j].x0 <= segs[i].x1 && segs[i].x0 <= segs[j].x1) uni(i, j)
    }
  }
  const bb = new Map<number, Run>()
  for (let i = 0; i < segs.length; i++) {
    const r = find(i), s = segs[i], cur = bb.get(r)
    if (!cur) bb.set(r, { x0: s.x0, x1: s.x1, y0: s.y, y1: s.y })
    else {
      cur.x0 = Math.min(cur.x0, s.x0); cur.x1 = Math.max(cur.x1, s.x1)
      cur.y0 = Math.min(cur.y0, s.y); cur.y1 = Math.max(cur.y1, s.y)
    }
  }
  const parts = [...bb.values()].filter(r => r.x1 - r.x0 >= 2 && r.y1 - r.y0 >= 2)
  const near = (p: Run, q: Run) => p.x0 <= q.x1 + 3 && q.x0 <= p.x1 + 3 && p.y0 <= q.y1 + 3 && q.y0 <= p.y1 + 3
  const merged: Run[] = []
  for (const r of parts.sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0)) {
    const hit = merged.find(m => near(m, r))
    if (hit) {
      hit.x0 = Math.min(hit.x0, r.x0); hit.x1 = Math.max(hit.x1, r.x1)
      hit.y0 = Math.min(hit.y0, r.y0); hit.y1 = Math.max(hit.y1, r.y1)
    } else merged.push({ ...r })
  }
  return merged.filter(r => r.x1 - r.x0 >= 5 && r.y1 - r.y0 >= 5)
}

function bands<T>(items: T[], yOf: (t: T) => number, xOf: (t: T) => number, tol: number): T[] {
  const sorted = [...items].sort((p, q) => yOf(p) - yOf(q))
  const out: T[][] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(yOf(r) - yOf(last[0])) <= tol) last.push(r)
    else out.push([r])
  }
  return out.flatMap(b => b.sort((p, q) => xOf(p) - xOf(q)))
}

/* 시트 기하 — 컨트롤의 기대 세로 자리는 **병합 범위의 가운데**다(칸이 vertical=center) */
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(
  path.join(import.meta.dirname, '..', 'templates', 'fire-plan-workbook.xlsx'))))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const tgt = new Map<string, string>()
for (const m of relsXml.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) tgt.set(m[1], m[2])
const partOf = new Map<string, string>()
for (const m of wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  partOf.set(m[1].replace(/&amp;/g, '&'), 'xl/' + tgt.get(m[2])!.replace(/^\/?xl\//, ''))
}
async function geom(sheet: string) {
  const xml = await zip.file(partOf.get(sheet)!)!.async('string')
  const def = Math.floor(Number(/<sheetFormatPr[^>]*defaultRowHeight="([\d.]+)"/.exec(xml)?.[1] ?? 15) * 4 / 3)
  const px = new Map<number, number>()
  for (const m of xml.matchAll(/<row r="(\d+)"([^>]*)>/g)) {
    const ht = /ht="([\d.]+)"/.exec(m[2])?.[1]
    if (ht) px.set(Number(m[1]), Math.floor(Number(ht) * 4 / 3))
  }
  const top = (r1: number) => { let t = 0; for (let r = 1; r < r1; r++) t += px.get(r) ?? def; return t }
  const mergeEnd = new Map<string, number>()
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):[A-Z]+(\d+)"\/>/g)) mergeEnd.set(m[1], Number(m[2]))
  return (cell: string, row0: number) => (top(row0 + 1) + top((mergeEnd.get(cell) ?? row0 + 1) + 1)) / 2
}

type Obs = { sheet: string; cell: string; boxIndex: number; label: string; absPx: number; nowPx: number }
const obs: Obs[] = []

for (const i of sheetIdx) {
  const sheet = names[i - 1]
  const pX = path.join(DIR, `png-X${SUF}`, `s${i}.png`)
  const pY = path.join(DIR, `png-Y${SUF}`, `s${i}.png`)
  const pZ = path.join(DIR, `png-Z${SUF}`, `s${i}.png`)
  if (![pX, pY, pZ].every(existsSync)) { console.log(`건너뜀 [${i}] ${sheet}`); continue }

  const centerY = await geom(sheet)
  const cells = firePlanCheckboxCells(sheet)
  const exp = cells.map(c => ({
    ...c,
    sx: c.col * PX_PER_COL + TEXT_INSET_PX + c.offsetPx,
    sy: centerY(c.cell, c.row0),
  }))
  const expSorted = bands(exp, e => e.sy, e => e.sx, 4)
  const ctrl = bands(await changedRuns(pY, pX), cy, r => r.x0, 6)
  const glyph = bands(await changedRuns(pY, pZ), cy, r => r.x0, 6)
  console.log(`\n[${i}] ${sheet}  기대 ${exp.length} · 컨트롤 ${ctrl.length} · 글리프 ${glyph.length}`)
  if (ctrl.length !== exp.length || glyph.length !== exp.length) { console.log('  🚨 개수 불일치 — 건너뛴다'); continue }

  // render_x = a*sheet_x + b  (컨트롤은 제품이 시킨 자리에 있어야 하므로 잔차가 곧 자기검사다)
  const n = exp.length
  const sx = expSorted.reduce((t, e) => t + e.sx, 0), sy = ctrl.reduce((t, r) => t + r.x0, 0)
  const sxx = expSorted.reduce((t, e) => t + e.sx * e.sx, 0)
  const sxy = expSorted.reduce((t, e, k) => t + e.sx * ctrl[k].x0, 0)
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  const b = (sy - a * sx) / n
  const resid = expSorted.map((e, k) => ctrl[k].x0 - (a * e.sx + b))
  const maxR = Math.max(...resid.map(Math.abs))
  console.log(`  환산 a=${a.toFixed(4)} · b=${b.toFixed(1)} · 컨트롤 최대 잔차 ${maxR.toFixed(1)}px `
    + `${maxR < 4 ? '(이름이 맞다)' : '🚨 짝짓기가 틀렸다 — 수치를 쓰지 않는다'}`)
  if (maxR >= 4) continue

  /* 관측 글리프를 시트 좌표로 되돌린다. `absPx` = **칸 왼쪽 끝에서 상자 글리프까지**(시트px).
   * 들여쓰기도 offset도 아직 안 뺀 날값이다 — 무엇을 상수로 삼을지는 전 시트를 모아 놓고 정한다. */
  for (let k = 0; k < n; k++) {
    const e = expSorted[k]
    obs.push({
      sheet, cell: e.cell, boxIndex: e.boxIndex,
      label: sheetManifest(sheet).labels[e.cell]!,
      absPx: (glyph[k].x0 - b) / a - e.col * PX_PER_COL,
      nowPx: e.offsetPx,
    })
  }
  const inset0 = obs.filter(o => o.sheet === sheet && o.boxIndex === 0).map(o => o.absPx)
  const im = [...inset0].sort((p, q) => p - q)[Math.floor(inset0.length / 2)]
  console.log(`  들여쓰기(첫 상자 기준) 중앙값 ${im.toFixed(2)}px  (제품 상수 ${TEXT_INSET_PX})`)
}

/* ══════════ 표 만들기 ══════════
 *
 *  ⭐ **기준선을 데이터가 정한다.** 「상자가 문자열 맨 앞」인 라벨들의 `absPx` 중앙값이 곧
 *    들여쓰기 상수다. 선두에 공백이 있는 라벨(` ☐ 상근직`)은 그만큼 더 오른쪽에서 시작하므로
 *    **0번 상자도 offset을 가진다** — 종전 표가 0번을 늘 0으로 둔 것이 6px 어긋남의 뿌리였다.
 */
const leading = obs.filter(o => o.boxIndex === 0 && /^[□☐]/.test(o.label))
if (!leading.length) { console.log('\n기준 표본이 없다 — 표를 만들지 않는다'); process.exit(1) }
const sortedLead = leading.map(o => o.absPx).sort((p, q) => p - q)
const baseInset = sortedLead[Math.floor(sortedLead.length / 2)]
const spreadLead = sortedLead[sortedLead.length - 1] - sortedLead[0]
console.log(`\n기준 들여쓰기 = ${baseInset.toFixed(2)}px  (선두가 상자인 라벨 ${leading.length}개 · 폭 ${spreadLead.toFixed(2)}px)`)

const byLabel = new Map<string, number[][]>()
for (const o of obs) {
  const list = byLabel.get(o.label) ?? []
  ;(list[o.boxIndex] ??= []).push(o.absPx - baseInset)
  byLabel.set(o.label, list)
}
let maxSpread = 0
const lines: string[] = []
for (const [label, perBox] of [...byLabel].sort((p, q) => p[0].localeCompare(q[0]))) {
  const avg = perBox.map(v => v.reduce((t, x) => t + x, 0) / v.length)
  const spread = Math.max(...perBox.map(v => Math.max(...v) - Math.min(...v)))
  // 어느 상자도 1.5px 안이면 표에 안 싣는다 — 기본값 0으로 충분하다(표를 작게 유지한다)
  if (Math.max(...avg.map(Math.abs)) < 1.5) continue
  maxSpread = Math.max(maxSpread, spread)
  const cnt = perBox[0].length
  lines.push(`  ${JSON.stringify(label)}: [${avg.map(v => v.toFixed(1)).join(', ')}],`
    + (cnt > 1 ? `   // ${cnt}칸 평균 · 편차 ${spread.toFixed(2)}px` : ''))
}
console.log(`표에 실을 라벨 ${lines.length}종 · 같은 글자끼리 최대 편차 ${maxSpread.toFixed(2)}px `
  + `${maxSpread < 2.5 ? '(측정 재현성 안)' : '🚨 같은 글자인데 값이 다르다'}`)

if (process.env.CB3_EMIT) {
  const { writeFileSync } = await import('node:fs')
  const ts = `/** 상자별 **가로 오프셋**(px, 칸 왼쪽 끝 + \`TEXT_INSET_PX\` 기준) — 자동 생성. 손으로 고치지 말 것.
 *
 *  생성: npx tsx scripts/_probe-cb-render3.mts → scripts/_shot-cb-render3.ps1 / LibreOffice 렌더
 *        → CB3_EMIT=1 CB3_PNGSUF=-lo npx tsx scripts/_probe-cb-render3-fit.mts <시트번호들>
 *
 *  🚨 **글자 폭을 계산해서 낸 값이 아니다.** 상자만 색을 바꾼 판과 컨트롤만 뗀 판을 굽고
 *    **픽셀을 빼서** 「컨트롤이 실제로 선 자리」와 「상자 글리프가 실제로 있는 자리」를 따로 재,
 *    그 차이를 되돌린 값이다. 계산으로 내려던 모델은 9%까지 어긋났다(실패 기록).
 *
 *  🚨🚨 **자[尺]는 LibreOffice다.** 같은 파일을 MS Excel과 LibreOffice가 **12~13% 다르게**
 *    배치한다(2026-09-16 실측). 사용자가 이 산출물을 LibreOffice로 열어 체크하므로 그쪽에 맞춘다.
 *    → Excel로 열면 다중상자 칸에서 그만큼 반대로 어긋난다. **한 표로 둘 다 맞출 수는 없다.**
 *    렌더러를 바꾸려면 위 파이프라인을 그 렌더러로 다시 돌릴 것. 값만 손으로 고치지 말 것.
 *
 *  ⚠ 키는 **라벨 글자**다(오프셋은 앞 글자의 폭이 정하므로 같은 글자면 같은 값 —
 *    실측 교차검증: 같은 글자인 칸들이 ${maxSpread.toFixed(2)}px 안에서 일치).
 *  ⚠ **0번 상자도 값을 가질 수 있다.** 선두에 공백이 있는 라벨(\` ☐ 상근직\`)은 상자가
 *    그만큼 오른쪽에서 시작한다 — 0번을 늘 0으로 두던 종전 표가 그 칸들을 6px 밀어 놓았다.
 *  ⚠ 표에 없는 라벨은 **전부 0**이다(기준 들여쓰기만 적용).
 */
export const CHECKBOX_BOX_OFFSETS: Record<string, readonly number[]> = {
${lines.join('\n')}
}
`
  const p = path.join(import.meta.dirname, '..', 'src', 'lib', 'fire-plan-checkbox-offsets.ts')
  writeFileSync(p, ts, 'utf8')
  console.log(`→ ${p}`)
  console.log(`   ⚠ TEXT_INSET_PX 를 ${Math.round(baseInset)} 로 맞출 것(지금 ${TEXT_INSET_PX})`)
}
