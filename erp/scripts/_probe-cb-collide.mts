/** 컨트롤이 **글자를 덮는가** — 왼쪽 정렬이 아니라 **충돌**을 잰다.
 *
 *  🚨 종전 계측기(`_probe-cb-render3-measure`)는 `dx = 컨트롤.x0 − 글리프.x0`, 즉 **왼쪽 끝**만
 *    봤다. 컨트롤이 글리프보다 넓으면 오른쪽이 다음 글자를 파고들어도 dx는 0이다 —
 *    「안 밀렸는가」의 짝은 **「안 덮는가」**다. 사용자 지적(image-8~11)이 정확히 그 부류다.
 *
 *  재는 법: Y(컨트롤 없음·상자 숨김)에는 **라벨 글자만** 있다. 거기서 컨트롤이 설 자리
 *  오른쪽의 **첫 잉크 열**을 찾고, diff(Y,X)로 얻은 컨트롤의 **오른쪽 끝**과 비교한다.
 *  겹침 = 컨트롤.x1 ≥ 글자 시작. 음수면 그만큼 여유가 있다는 뜻이다.
 *
 *  실행: CB3_PNGSUF=-lo npx tsx scripts/_probe-cb-collide.mts 8,9,15,45
 */
import sharp from 'sharp'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { FIRE_PLAN_MANIFEST, sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { firePlanCheckboxCells } from '../src/lib/fire-plan-checkbox-controls.ts'

const DIR = path.join(process.env.TEMP ?? '/tmp', 'cb3')
const SUF = process.env.CB3_PNGSUF ?? ''
const sheetIdx = (process.argv[2] ?? '8,9,15').split(',').map(s => Number(s.trim()))
const names = FIRE_PLAN_MANIFEST.sheets.map(s => s.name)

type Run = { x0: number; x1: number; y0: number; y1: number }
const cy = (r: Run) => (r.y0 + r.y1) / 2

async function grey(p: string) {
  const g = await sharp(p).greyscale().raw().toBuffer({ resolveWithObject: true })
  return { d: g.data, w: g.info.width, h: g.info.height }
}

async function changedRuns(a: string, b: string): Promise<Run[]> {
  const A = await grey(a), B = await grey(b)
  const { w, h } = A
  type Seg = { y: number; x0: number; x1: number; p: number }
  const segs: Seg[] = []
  for (let y = 0; y < h; y++) {
    let bx = -1
    for (let x = 0; x <= w; x++) {
      const on = x < w && Math.abs(A.d[y * w + x] - B.d[y * w + x]) > 18
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

function bands(rs: Run[], tol = 6): Run[] {
  const sorted = [...rs].sort((p, q) => cy(p) - cy(q))
  const out: Run[][] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(cy(r) - cy(last[0])) <= tol) last.push(r)
    else out.push([r])
  }
  return out.flatMap(b => b.sort((p, q) => p.x0 - q.x0))
}

let worst = 0, hits = 0, total = 0
const gaps: { sheet: string; gap: number }[] = []
for (const i of sheetIdx) {
  const sheet = names[i - 1]
  const pX = path.join(DIR, `png-X${SUF}`, `s${i}.png`)
  const pY = path.join(DIR, `png-Y${SUF}`, `s${i}.png`)
  if (![pX, pY].every(existsSync)) { console.log(`건너뜀 [${i}] ${sheet}`); continue }

  const cells = bands(await changedRuns(pY, pX))   // 컨트롤만
  const Y = await grey(pY)
  const rows: string[] = []
  const expect = firePlanCheckboxCells(sheet)
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k]
    // 컨트롤의 세로 범위 안에서, 오른쪽으로 걸어가며 **첫 잉크 열**을 찾는다(Y에는 글자만 있다)
    let ink = -1
    for (let x = c.x0; x < Y.w && x < c.x1 + 40; x++) {
      let dark = 0
      for (let y = Math.max(0, c.y0); y <= Math.min(Y.h - 1, c.y1); y++) if (Y.d[y * Y.w + x] < 140) dark++
      if (dark > 0) { ink = x; break }
    }
    total++
    if (ink < 0) continue                       // 오른쪽에 글자가 없다(빈 칸)
    const gap = ink - c.x1 - 1                  // 음수면 겹친다
    gaps.push({ sheet, gap })
    if (gap < 0) {
      hits++; worst = Math.min(worst, gap)
      const e = expect[k]
      const label = e ? (sheetManifest(sheet).labels[e.cell] ?? '') : ''
      rows.push(`    ${(e ? e.cell + '#' + e.boxIndex : '?').padEnd(10)} 컨트롤 x=${c.x0}..${c.x1} · 글자 x=${ink}`
        + `  → **${-gap}px 겹침**   ${JSON.stringify(label.slice(0, 28))}`)
    }
  }
  console.log(`\n[${i}] ${sheet}  컨트롤 ${cells.length} · **겹친 것 ${rows.length}**`)
  for (const r of rows.slice(0, 12)) console.log(r)
  if (rows.length > 12) console.log(`    … 외 ${rows.length - 12}개`)
  const g = gaps.filter(x => x.sheet === sheet).map(x => x.gap).sort((a, b) => a - b)
  if (g.length) {
    const hist = new Map<number, number>()
    for (const v of g) hist.set(Math.min(v, 9), (hist.get(Math.min(v, 9)) ?? 0) + 1)
    console.log(`    여유(px) 최소 ${g[0]} · 중앙 ${g[Math.floor(g.length / 2)]} · `
      + `분포 ${[...hist].sort((a, b) => a[0] - b[0]).map(([v, n]) => `${v === 9 ? '9+' : v}:${n}`).join(' ')}`)
  }
}
const all = gaps.map(x => x.gap).sort((a, b) => a - b)
console.log(`\n전체 ${total}개 · 겹친 것 **${hits}개** · 최대 겹침 ${-worst}px`)
if (all.length) {
  const tight = all.filter(v => v <= 1).length
  console.log(`여유 최소 ${all[0]}px · 중앙 ${all[Math.floor(all.length / 2)]}px · `
    + `**1px 이하로 아슬아슬한 것 ${tight}개**(렌더러가 조금만 달라도 겹친다)`)
}
process.exit(hits ? 1 : 0)
