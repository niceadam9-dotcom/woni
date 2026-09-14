/** 상자 위치를 **렌더 차이**로 잰다 — 글꼴·대체글꼴·축소율·자간을 하나도 몰라도 된다.
 *
 *  기준본과 표식본(상자만 빨간색)을 같은 크기로 굽고 픽셀을 뺀다. 달라진 자리가 곧 상자 자리다.
 *  그 자리를 **시트 좌표로 되돌리는 환산**도 여기서 구한다: 한 줄 안에서 상자가 하나뿐인 칸들이
 *  「열 번호 → 렌더 x」 쌍을 주므로, 최소제곱이 기울기(배율)와 절편(글자 시작 자리)을 함께 낸다.
 *
 *  🚨 자기검사 넷. 하나라도 어긋나면 그 시트 수치를 쓰지 않는다:
 *   ① 바뀐 덩어리 수 == 표식한 상자 수   (검출 실패 또는 글자가 밀린 것)
 *   ② 덩어리 폭이 상자 크기 안          (넓으면 표식이 배치를 흔들었다)
 *   ③ 줄 수 == 상자 있는 행 수          (짝짓기 불가)
 *   ④ 최소제곱 잔차가 작다              (크면 줄↔칸 짝짓기가 틀렸다)
 *
 *  실행: npx tsx scripts/_probe-cb-diffmeasure.mts
 *        (먼저 _probe-cb-mark.mts → PDF 내보내기 → PNG 굽기)
 */
import sharp from 'sharp'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { firePlanCheckboxCells } from '../src/lib/fire-plan-checkbox-controls.ts'
import { multiBoxCells } from './_cb-targets.mts'

const HERE = import.meta.dirname
const T = process.env.TEMP ?? '/tmp'
const PX_PER_COL = 13
const colNum = (t: string) => [...t].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1

/* ── 시트 번호 ─────────────────────────────────────────────────────────── */
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(
  path.join(HERE, '..', 'templates', 'fire-plan-workbook.xlsx'))))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const tgt = new Map<string, string>()
for (const m of relsXml.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) tgt.set(m[1], m[2])
const idxOf = new Map<string, number>()
const partOf = new Map<string, string>()
let sn = 0
for (const m of wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const nm = m[1].replace(/&amp;/g, '&')
  idxOf.set(nm, ++sn)
  partOf.set(nm, 'xl/' + tgt.get(m[2])!.replace(/^\/?xl\//, ''))
}

/** 행 꼭대기(시트px) — 줄 묶는 간격을 **그 시트의 실제 행 높이**에서 구하려고 쓴다.
 *  고정 간격은 못 쓴다: 5면 한 행이 둘로 갈리고 12면 이웃 행이 붙는다(둘 다 실제로 겪었다). */
async function sheetGeom(sheet: string) {
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
  /** 🚨 상자의 세로 위치는 **행이 아니라 병합 범위의 가운데**가 정한다(칸이 `vertical=center`).
   *  그래서 「같은 행 = 같은 y」가 성립하지 않는다 — 두 행에 걸친 병합 칸은 한 행짜리 이웃과
   *  y가 크게 어긋난다. y로 줄을 묶던 방식이 1.4·1.5.1에서 깨진 이유다. */
  const centerY = (cell: string, row0: number) => {
    const end = mergeEnd.get(cell) ?? row0 + 1
    return (top(row0 + 1) + top(end + 1)) / 2
  }
  return { centerY }
}

/* ── 바뀐 픽셀의 연결 덩어리(4-이웃) ───────────────────────────────────── */
type Run = { x0: number; x1: number; y0: number; y1: number }
async function changedRuns(a: string, b: string): Promise<Run[]> {
  const A = await sharp(a).greyscale().raw().toBuffer({ resolveWithObject: true })
  const B = await sharp(b).greyscale().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = A.info
  type Seg = { y: number; x0: number; x1: number; p: number }
  const segs: Seg[] = []
  for (let y = 0; y < h; y++) {
    let bx = -1
    for (let x = 0; x <= w; x++) {
      // 🚨 문턱을 낮게. `☐`(U+2610)는 획이 가늘어 색만 바꾸면 차이가 작다 —
      //   40으로 두었더니 3.1에서 34개 중 20개만 잡혔다(과소 검출).
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
  // 🚨 **쪼개진 글리프를 다시 붙인다.** 상자는 속이 빈 사각형이라 안티앨리어싱에 따라 테두리가
  //   끊겨 두 덩어리로 잡힐 수 있다(1.4·1.5.1에서 정확히 하나씩 더 잡혔고, 그 하나만 크기가
  //   달랐다 — 9x9 사이의 7x8). 서로 2px 안쪽이면 같은 글자로 본다.
  const parts = [...bb.values()].filter(r => r.x1 - r.x0 >= 2 && r.y1 - r.y0 >= 2)
  const near = (p: Run, q: Run) =>
    p.x0 <= q.x1 + 2 && q.x0 <= p.x1 + 2 && p.y0 <= q.y1 + 2 && q.y0 <= p.y1 + 2
  const merged: Run[] = []
  for (const r of parts.sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0)) {
    const hit = merged.find(m => near(m, r))
    if (hit) {
      hit.x0 = Math.min(hit.x0, r.x0); hit.x1 = Math.max(hit.x1, r.x1)
      hit.y0 = Math.min(hit.y0, r.y0); hit.y1 = Math.max(hit.y1, r.y1)
    } else merged.push({ ...r })
  }
  // 794px 렌더에서 상자 한 글자가 약 9px — 5px 미만은 글리프가 아니다
  return merged.filter(r => r.x1 - r.x0 >= 5 && r.y1 - r.y0 >= 5)
}

/* ── 시트별 측정 ───────────────────────────────────────────────────────── */
type Cell = { cell: string; boxes: number; col: number; row0: number }
const result: Record<string, Record<string, number[]>> = {}
const insets: { sheet: string; px: number }[] = []
const scales: number[] = []
let fatal = 0

for (const s of FIRE_PLAN_MANIFEST.sheets) {
  const sheet = s.name
  if (!multiBoxCells(sheet).length) continue
  const i = idxOf.get(sheet)!
  const pa = path.join(T, 'cb-png-base', `s${i}-n0.png`)
  const pb = path.join(T, 'cb-png-mark', `s${i}-n0.png`)
  if (!existsSync(pa) || !existsSync(pb)) { console.log(`  건너뜀 ${sheet}: png 없음`); continue }

  const byRef = new Map<string, Cell>()
  for (const c of firePlanCheckboxCells(sheet)) byRef.set(c.cell, { cell: c.cell, boxes: 1, col: c.col, row0: c.row0 })
  for (const m of multiBoxCells(sheet)) {
    const mm = /^([A-Z]+)(\d+)$/.exec(m.cell)!
    byRef.set(m.cell, { cell: m.cell, boxes: m.at.length, col: colNum(mm[1]), row0: Number(mm[2]) - 1 })
  }
  const cells = [...byRef.values()]
  const wantBoxes = cells.reduce((a, c) => a + c.boxes, 0)

  const all = await changedRuns(pa, pb)
  // 🚨 **상자 크기가 아닌 덩어리는 버린다.** 서식 런으로 쪼개면 이웃 글자가 1px 안팎 흔들려
  //   글자 자리에도 차이가 생긴다(1.4·1.5.1에서 딱 하나씩 더 잡혔고 크기만 달랐다).
  //   최빈 크기에서 ±2 밖은 글리프가 아니다 — 버린 개수를 **말하고** 버린다(조용히 줄이지 않는다).
  const modeOf = (v: number[]) => {
    const c = new Map<number, number>()
    for (const x of v) c.set(x, (c.get(x) ?? 0) + 1)
    return [...c].sort((p, q) => q[1] - p[1])[0][0]
  }
  const mw = modeOf(all.map(r => r.x1 - r.x0)), mh = modeOf(all.map(r => r.y1 - r.y0))
  const runs = all.filter(r => Math.abs(r.x1 - r.x0 - mw) <= 1 && Math.abs(r.y1 - r.y0 - mh) <= 1)
  if (runs.length !== all.length) {
    console.log(`\n[${sheet}] 상자 크기(${mw + 1}x${mh + 1}) 아닌 덩어리 ${all.length - runs.length}개 버림: `
      + all.filter(r => !runs.includes(r)).map(r => `${r.x1 - r.x0 + 1}x${r.y1 - r.y0 + 1}@(${r.x0},${r.y0})`).join(' '))
  }
  console.log(`\n[${sheet}] 표식 칸 ${cells.length} · 상자 ${wantBoxes} · 바뀐 덩어리 ${runs.length}`)
  if (runs.length !== wantBoxes) {
    const sizes = runs.map(r => `${r.x1 - r.x0 + 1}x${r.y1 - r.y0 + 1}@(${r.x0},${r.y0})`)
    console.log(`  🚨 ① 덩어리 수 불일치 — 이 시트 수치는 쓰지 않는다`)
    console.log(`     크기 분포: ${[...new Set(runs.map(r => `${r.x1 - r.x0 + 1}x${r.y1 - r.y0 + 1}`))].join(' ')}`)
    console.log(`     표본: ${sizes.slice(0, 8).join(' ')}`)
    fatal++; continue
  }
  const wide = runs.filter(r => r.x1 - r.x0 > 40)
  if (wide.length) { console.log(`  🚨 ② 덩어리가 너무 넓다 ${wide.length}개 — 표식이 배치를 흔들었다`); fatal++; continue }

  // 세로로 겹치거나 **아주 가까운** 덩어리끼리 묶어 줄을 만든다. 같은 시트 행이라도 글자 크기가
  // 다르면 세로 범위가 살짝 어긋나 줄이 둘로 갈린다(1.5.1에서 21줄 vs 19행으로 막혔다).
  /* 줄을 「눈대중 간격」으로 묶지 않는다. 각 칸의 **세로 중심을 미리 계산**해 두고, 관측된
   * 덩어리를 그 예측값에 붙인다. 축척 a는 다른 시트에서 빌리고(0.2% 안에서 일치), 세로 여백 by는
   * **정렬한 y 다중집합의 중앙값 차이**로 구한다 — 평행이동은 순서를 보존하므로 짝짓기가 필요 없다. */
  /* 짝짓기 = **정렬 순서 맞대기**. 평행이동·확대는 순서를 보존하므로, 기대 상자를
   * (세로중심, 열, 상자번호)로 정렬하고 관측 덩어리를 (세로중심, x)로 정렬해 지퍼처럼 채운다.
   * 「줄을 몇 개로 묶을까」를 정할 필요가 아예 없다 — 그 눈대중이 1.4·1.5.1을 계속 막았다.
   * 🚨 짝짓기가 틀리면 **x 최소제곱 잔차가 폭발**하므로 아래 ④가 그대로 자기검사가 된다. */
  const geom = await sheetGeom(sheet)
  const cy = (r: Run) => (r.y0 + r.y1) / 2
  type Exp = { cell: string; col: number; boxIndex: number; yc: number }
  const expected: Exp[] = []
  for (const c of cells) {
    const yc = geom.centerY(c.cell, c.row0)
    for (let k = 0; k < c.boxes; k++) expected.push({ cell: c.cell, col: c.col, boxIndex: k, yc })
  }
  expected.sort((p, q) => p.yc - q.yc || p.col - q.col || p.boxIndex - q.boxIndex)
  const obs = [...runs].sort((p, q) => cy(p) - cy(q) || p.x0 - q.x0)

  const pairs: { colPx: number; x: number }[] = []
  const perCell: Record<string, number[]> = {}
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]
    ;(perCell[e.cell] ??= [])[e.boxIndex] = obs[i].x0
    if (e.boxIndex === 0) pairs.push({ colPx: e.col * PX_PER_COL, x: obs[i].x0 })
  }
  // 표본이 모자란 시트(3.3은 대상 칸이 하나뿐)는 **다른 시트에서 잰 축척**을 빌린다.
  // 정당화: 이미 잰 시트들의 축척이 0.2% 안에서 일치한다(아래 편차로 확인). 빌렸다는 사실을 말한다.
  if (pairs.length < 3) {
    if (scales.length < 2) { console.log(`  🚨 환산 표본 ${pairs.length}개 · 빌릴 축척도 없다`); fatal++; continue }
    const borrowed = scales.slice().sort((x, y) => x - y)[Math.floor(scales.length / 2)]
    console.log(`  ⚠ 환산 표본 ${pairs.length}개뿐 — 다른 시트 축척 ${borrowed.toFixed(4)}를 빌린다`)
    result[sheet] = {}
    for (const [cell, xs] of Object.entries(perCell)) {
      if (xs.length < 2) continue
      result[sheet][cell] = xs.map(x => Number(((x - xs[0]) / borrowed).toFixed(2)))
      console.log(`    ${cell}  오프셋(px): ${result[sheet][cell].join(' · ')}`)
    }
    continue
  }
  // 🚨 **잔차 0은 「완벽히 맞았다」가 아니라 「기울기를 정할 수 없었다」일 수 있다.**
  //   표본이 전부 같은 열이면 x는 상수이고 어떤 기울기든 잔차가 0이 된다(축퇴).
  //   그래서 기울기를 쓰기 전에 **열이 얼마나 벌어져 있는지**를 먼저 본다.
  const colsUsed = [...new Set(pairs.map(p => p.colPx))].sort((x, y) => x - y)
  const spreadPx = colsUsed[colsUsed.length - 1] - colsUsed[0]
  console.log(`  환산 표본의 열 분포: ${colsUsed.length}종 · 폭 ${spreadPx}시트px  [${colsUsed.slice(0, 8).join(',')}${colsUsed.length > 8 ? '…' : ''}]`)
  if (spreadPx < 100) { console.log('  🚨 표본이 한쪽 열에 몰렸다 — 기울기를 정할 수 없다(축퇴)'); fatal++; continue }

  const n = pairs.length
  const sx = pairs.reduce((t, p) => t + p.colPx, 0), sy = pairs.reduce((t, p) => t + p.x, 0)
  const sxx = pairs.reduce((t, p) => t + p.colPx * p.colPx, 0), sxy = pairs.reduce((t, p) => t + p.colPx * p.x, 0)
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  const b = (sy - a * sx) / n
  const resid = Math.max(...pairs.map(p => Math.abs(p.x - (a * p.colPx + b))))
  console.log(`  환산 a=${a.toFixed(4)} 렌더px/시트px · b=${b.toFixed(2)} · 최대 잔차 ${resid.toFixed(2)} (표본 ${n})`)
  if (resid > 5) { console.log('  🚨 ④ 잔차가 크다 — 짝짓기가 틀렸다'); fatal++; continue }
  insets.push({ sheet, px: b / a }); scales.push(a)

  result[sheet] = {}
  for (const [cell, xs] of Object.entries(perCell)) {
    if (xs.length < 2) continue
    result[sheet][cell] = xs.map(x => Number(((x - xs[0]) / a).toFixed(2)))
    console.log(`    ${cell}  오프셋(px): ${result[sheet][cell].join(' · ')}`)
  }
}

console.log(`\n실패한 시트 ${fatal}개`)
console.log('들여쓰기(글자 시작 − 열 0, 시트px):')
for (const it of insets) console.log(`  ${it.px.toFixed(2)}  ${it.sheet}`)
if (!fatal && insets.length) {
  const avg = insets.reduce((t, x) => t + x.px, 0) / insets.length
  const spread = Math.max(...insets.map(x => x.px)) - Math.min(...insets.map(x => x.px))
  console.log(`  평균 ${avg.toFixed(2)}px · 편차 ${spread.toFixed(2)}px ${spread < 2 ? '(상수로 써도 된다)' : '🚨 시트마다 다르다'}`)
  const out = path.join(T, 'cb-offsets.json')
  writeFileSync(out, JSON.stringify({ insetPx: Number(avg.toFixed(2)), offsets: result }, null, 1), 'utf8')
  console.log(`→ ${out}`)

  /* ── 제품이 읽을 표를 **생성**한다. 손으로 적지 않는다 — 서식이 바뀌면 이 스크립트를 다시 돌린다.
   *    키는 「칸」이 아니라 **라벨 글자**다: 오프셋은 앞 글자의 폭이 정하므로 같은 글자면 같은 값이고,
   *    실제로 같은 글자인 칸들이 1px 안에서 같은 값을 냈다(교차검증). 칸으로 키를 잡으면 같은 글자를
   *    여러 번 재게 되고, 한 칸만 고쳐지는 드리프트가 생긴다. */
  const { sheetManifest } = await import('../src/lib/fire-plan-xlsx-manifest.ts')
  const byLabel = new Map<string, number[][]>()
  for (const [sheet, cellsMap] of Object.entries(result)) {
    for (const [cell, offs] of Object.entries(cellsMap)) {
      const label = sheetManifest(sheet).labels[cell]!
      byLabel.set(label, [...(byLabel.get(label) ?? []), offs])
    }
  }
  const lines: string[] = []
  let maxSpread = 0
  for (const [label, list] of [...byLabel].sort((p, q) => p[0].localeCompare(q[0]))) {
    const avgOff = list[0].map((_, i) => list.reduce((t, o) => t + o[i], 0) / list.length)
    const spread = Math.max(...list[0].map((_, i) => Math.max(...list.map(o => o[i])) - Math.min(...list.map(o => o[i]))))
    maxSpread = Math.max(maxSpread, spread)
    lines.push(`  ${JSON.stringify(label)}: [${avgOff.map(v => v.toFixed(1)).join(', ')}],`
      + (list.length > 1 ? `   // ${list.length}칸 평균 · 편차 ${spread.toFixed(2)}px` : ''))
  }
  console.log(`\n라벨 ${byLabel.size}종 · 같은 글자끼리 최대 편차 ${maxSpread.toFixed(2)}px `
    + `${maxSpread < 2 ? '(측정 재현성 안)' : '🚨 같은 글자인데 값이 다르다'}`)
  const ts = `/** 다중상자 칸의 **상자별 가로 오프셋**(px, 첫 상자 기준) — 자동 생성. 손으로 고치지 말 것.
 *
 *  생성: npx tsx scripts/_probe-cb-mark.mts → 시트 PDF 내보내기 → PNG → npx tsx scripts/_probe-cb-diffmeasure.mts
 *
 *  🚨 **글자 폭을 계산해서 낸 값이 아니다.** 상자만 색을 바꾼 판을 Excel로 인쇄해 원본 렌더와
 *    픽셀을 뺀 자리다. 계산으로 내려던 모델은 9%까지 어긋났다 — 한 칸 안에서 글꼴이 섞이고
 *    (상자는 SegoeUISymbol, 글자는 맑은 고딕) 공백이 폭 대신 자간 보정으로 벌어지기 때문이다.
 *  ⚠ 키는 **라벨 글자**다. 오프셋은 앞 글자의 폭이 정하므로 같은 글자면 같은 값이다
 *    (실측 교차검증: 같은 글자인 칸들이 ${maxSpread.toFixed(2)}px 안에서 일치).
 */
export const CHECKBOX_BOX_OFFSETS: Record<string, readonly number[]> = {
${lines.join('\n')}
}
`
  const tsPath = path.join(HERE, '..', 'src', 'lib', 'fire-plan-checkbox-offsets.ts')
  writeFileSync(tsPath, ts, 'utf8')
  console.log(`→ ${tsPath}`)
}
process.exit(fatal ? 1 : 0)
