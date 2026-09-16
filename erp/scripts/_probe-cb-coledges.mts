/** 미세 격자 **열 경계 지도**를 찍는다 — `COL_EDGE_NUDGES`의 `edge` 인덱스를 눈으로 고르려고.
 *
 *  ⚠ 투영식은 빌드와 **한 벌이어야** 한다. 여기 사본을 두면 조용히 갈라지므로, 빌드가 쓰는
 *    `solveWidths`/`projectCols`와 같은 식을 그대로 옮겨 적되 **조정(nudge)은 빼고** 찍는다
 *    (조정 전 지도가 필요한 것이므로 — 조정 후는 산출물 xlsx가 이미 말해 준다).
 *
 *  실행: npx tsx scripts/_probe-cb-coledges.mts <표번호> [행(1-based, hwpx 기준)]
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { parseTables, type HwpxTable } from '../src/lib/hwpx-table.ts'

const HERE = import.meta.dirname
const FINE_N = 60
const table = Number(process.argv[2])
const row1 = process.argv[3] ? Number(process.argv[3]) : null

const hwpx = await JSZip.loadAsync(new Uint8Array(readFileSync(
  path.resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx'))))
const tables = parseTables(await hwpx.file('Contents/section0.xml')!.async('string'))
const t: HwpxTable = tables[table]
if (!t) { console.error(`표 #${table} 없음 (총 ${tables.length})`); process.exit(1) }

function solveWidths(t: HwpxTable): number[] {
  const w = new Array<number>(t.colCnt).fill(0)
  for (const c of t.cells) if (c.colSpan === 1 && c.widthHwp > 0) w[c.col] = Math.max(w[c.col], c.widthHwp)
  const spans = t.cells.filter(c => c.colSpan > 1 && c.widthHwp > 0).sort((a, b) => a.colSpan - b.colSpan)
  for (let p = 0; p < 4; p++) {
    let changed = false
    for (const c of spans) {
      const cols = Array.from({ length: c.colSpan }, (_, k) => c.col + k).filter(i => i < t.colCnt)
      const unknown = cols.filter(i => w[i] === 0)
      if (!unknown.length) continue
      const rest = c.widthHwp - cols.reduce((a, i) => a + w[i], 0)
      if (rest <= 0) continue
      const each = Math.round(rest / unknown.length)
      for (const i of unknown) w[i] = each
      changed = true
    }
    if (!changed) break
  }
  return w.map(x => (x > 0 ? x : 1))
}
const w = solveWidths(t)
const total = w.reduce((a, b) => a + b, 0) || 1
const map = [0]
let acc = 0
for (const x of w) { acc += x; map.push(Math.round((acc / total) * FINE_N)) }
for (let i = 1; i < map.length; i++) if (map[i] <= map[i - 1]) map[i] = map[i - 1] + 1

const colName = (n0: number) => { let s = ''; for (let n = n0 + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s }

console.log(`표 #${table}  ${t.rowCnt}행 × ${t.colCnt}열  (조정 전 지도)`)
console.log(`edge:  ${map.map((v, i) => `${i}=${v}`).join('  ')}`)
console.log(`칸 폭(미세열): ${map.slice(1).map((v, i) => v - map[i]).join(' ')}`)
console.log()
for (const c of t.cells) {
  if (row1 !== null && c.row !== row1 - 1) continue
  const f0 = map[c.col], f1 = map[Math.min(c.col + c.colSpan, map.length - 1)]
  const txt = c.text.replace(/\n/g, '\\n').slice(0, 46)
  console.log(`  r${String(c.row).padStart(2)} hwpCol ${String(c.col).padStart(2)}+${c.colSpan}  `
    + `→ ${colName(f0)}..${colName(f1 - 1)} (${f1 - f0}칸)  [edge ${c.col}..${c.col + c.colSpan}]  ${JSON.stringify(txt)}`)
}
