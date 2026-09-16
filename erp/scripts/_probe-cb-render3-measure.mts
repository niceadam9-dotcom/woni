/** 컨트롤이 상자 글리프에서 **얼마나 어긋났는가** — 렌더 세 판(X/Y/Z)을 빼서 잰다.
 *
 *    diff(Y,X) = 컨트롤만      · diff(Y,Z) = 상자 글리프만
 *    두 판의 글자 배치가 완전히 같으므로 같은 좌표계에서 빼면 곧 어긋남이다.
 *
 *  🚨 자기검사. 하나라도 어긋나면 그 시트 수치를 쓰지 않는다:
 *   ① 컨트롤 덩어리 수 == 그 시트 적격 상자 수
 *   ② 글리프 덩어리 수 == 그 시트 적격 상자 수
 *   ③ 짝지은 둘의 거리가 한 글자(≈ 한 상자 폭)를 크게 넘지 않는다 — 넘으면 짝짓기가 틀렸다
 *
 *  실행: npx tsx scripts/_probe-cb-render3.mts
 *        → powershell scripts/_shot-cb-render3.ps1 -Sheets "8,9,15"
 *        → soffice로 PDF→PNG (%TEMP%\cb3\png-{X,Y,Z})
 *        → npx tsx scripts/_probe-cb-render3-measure.mts 8,9,15
 */
import sharp from 'sharp'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { firePlanCheckboxCells } from '../src/lib/fire-plan-checkbox-controls.ts'

const DIR = path.join(process.env.TEMP ?? '/tmp', 'cb3')
/** 어느 렌더러의 판을 볼 것인가 — `png-X…`(Excel) vs `png-X-lo…`(LibreOffice).
 *  🚨 **렌더러마다 답이 다르다**(이번 지적의 뿌리다). 그래서 자를 고르는 손잡이를 밖에 둔다. */
const SUF = process.env.CB3_PNGSUF ?? ''
const sheetIdx = (process.argv[2] ?? '8,9,15').split(',').map(s => Number(s.trim()))
const names = FIRE_PLAN_MANIFEST.sheets.map(s => s.name)

type Run = { x0: number; x1: number; y0: number; y1: number }

/** 두 PNG에서 **달라진 픽셀의 연결 덩어리**(4-이웃). 문턱은 낮게 — `☐`는 획이 가늘다. */
async function changedRuns(a: string, b: string): Promise<Run[]> {
  const A = await sharp(a).greyscale().raw().toBuffer({ resolveWithObject: true })
  const B = await sharp(b).greyscale().raw().toBuffer({ resolveWithObject: true })
  if (A.info.width !== B.info.width || A.info.height !== B.info.height) {
    throw new Error(`판 크기가 다르다 ${A.info.width}x${A.info.height} vs ${B.info.width}x${B.info.height}`)
  }
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
  // 속이 빈 사각형은 안티앨리어싱에 따라 테두리가 끊겨 두 덩어리로 잡힌다 — 2px 안쪽이면 한 글자
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

/** 세로로 **띠**를 지어 묶고 띠 안에서 x로 정렬한다.
 *  🚨 `y`로 그냥 정렬하면 안 된다 — 같은 줄의 덩어리끼리도 1px씩 어긋나 순서가 뒤집히고,
 *    그러면 짝짓기가 조용히 틀린다(처음에 그렇게 해서 -226 같은 헛값을 봤다). */
function bands(rs: Run[], tol = 6): Run[] {
  const cy = (r: Run) => (r.y0 + r.y1) / 2
  const sorted = [...rs].sort((p, q) => cy(p) - cy(q))
  const out: Run[][] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(cy(r) - cy(last[0])) <= tol) last.push(r)
    else out.push([r])
  }
  return out.flatMap(b => b.sort((p, q) => p.x0 - q.x0))
}

let fatal = 0
const allDx: number[] = [], allDy: number[] = []
for (const i of sheetIdx) {
  const sheet = names[i - 1]
  const pX = path.join(DIR, `png-X${SUF}`, `s${i}.png`)
  const pY = path.join(DIR, `png-Y${SUF}`, `s${i}.png`)
  const pZ = path.join(DIR, `png-Z${SUF}`, `s${i}.png`)
  if (![pX, pY, pZ].every(existsSync)) { console.log(`건너뜀 [${i}] ${sheet}: png 없음`); continue }

  const cells = firePlanCheckboxCells(sheet)
  const want = cells.length
  const ctrl = bands(await changedRuns(pY, pX))
  const glyph = bands(await changedRuns(pY, pZ))
  console.log(`\n[${i}] ${sheet}  적격 상자 ${want} · 컨트롤 덩어리 ${ctrl.length} · 글리프 덩어리 ${glyph.length}`)
  if (ctrl.length !== want) { console.log(`  🚨 ① 컨트롤 수 불일치`); fatal++; continue }
  if (glyph.length !== want) { console.log(`  🚨 ② 글리프 수 불일치`); fatal++; continue }

  const rows: string[] = []
  let bad = 0
  for (let k = 0; k < want; k++) {
    const c = ctrl[k], g = glyph[k]
    const dx = c.x0 - g.x0
    const dy = (c.y0 + c.y1) / 2 - (g.y0 + g.y1) / 2
    allDx.push(dx); allDy.push(dy)
    if (Math.abs(dx) > 60 || Math.abs(dy) > 40) bad++
    const cell = cells[k]
    rows.push(`    ${String(cell.cell + '#' + cell.boxIndex).padEnd(10)} `
      + `글리프 x=${String(g.x0).padStart(4)} y=${String(Math.round((g.y0 + g.y1) / 2)).padStart(4)} (${g.x1 - g.x0 + 1}x${g.y1 - g.y0 + 1})  `
      + `컨트롤 x=${String(c.x0).padStart(4)} y=${String(Math.round((c.y0 + c.y1) / 2)).padStart(4)} (${c.x1 - c.x0 + 1}x${c.y1 - c.y0 + 1})  `
      + `→ dx=${dx >= 0 ? '+' : ''}${dx}  dy=${dy >= 0 ? '+' : ''}${dy.toFixed(1)}`)
  }
  if (bad) { console.log(`  🚨 ③ 짝이 너무 멀다 ${bad}개 — 짝짓기가 틀렸을 수 있다`); fatal++ }
  for (const r of rows) console.log(r)
  const dxs = rows.map((_, k) => ctrl[k].x0 - glyph[k].x0)
  const med = [...dxs].sort((a, b) => a - b)[Math.floor(dxs.length / 2)]
  console.log(`  dx 중앙값 ${med}  최소 ${Math.min(...dxs)}  최대 ${Math.max(...dxs)}`)
}

if (allDx.length) {
  const sorted = [...allDx].sort((a, b) => a - b)
  console.log(`\n전체 ${allDx.length}개  dx 중앙값 ${sorted[Math.floor(sorted.length / 2)]} · `
    + `최소 ${sorted[0]} · 최대 ${sorted[sorted.length - 1]}`)
  const dys = [...allDy].sort((a, b) => a - b)
  console.log(`            dy 중앙값 ${dys[Math.floor(dys.length / 2)].toFixed(1)} · `
    + `최소 ${dys[0].toFixed(1)} · 최대 ${dys[dys.length - 1].toFixed(1)}`)
}
console.log(`\n실패한 시트 ${fatal}개`)
process.exit(fatal ? 1 : 0)
