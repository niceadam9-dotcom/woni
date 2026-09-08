/** 계산형 앵커(ZONE_COLS·BRIG_COLS)가 박고 있는 **열 문자**의 옛→새 사상.
 *  이 열들은 행 번호와 조합해 주소를 만들므로 정규식 치환으로는 못 옮긴다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { parseTables, type HwpxTable } from '../src/lib/hwpx-table.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FINE_N = 60
const zip = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const form = parseTables(await zip.file('Contents/section0.xml')!.async('string'))
const manifest = JSON.parse(readFileSync(resolve(HERE, '../../_manifest-old.json'), 'utf8')) as {
  sheets: Array<{ name: string; tables: number[]; bannerRows: number[]; gridTops: { table: number; top: number; rows: number }[] }>
}

function solveWidths(t: HwpxTable): number[] {
  const w = new Array<number>(t.colCnt).fill(0)
  for (const c of t.cells) if (c.colSpan === 1 && c.widthHwp > 0) w[c.col] = Math.max(w[c.col], c.widthHwp)
  const spans = t.cells.filter(c => c.colSpan > 1 && c.widthHwp > 0).sort((a, b) => a.colSpan - b.colSpan)
  for (let p = 0; p < 4; p++) {
    let ch = false
    for (const c of spans) {
      const cols = Array.from({ length: c.colSpan }, (_, k) => c.col + k).filter(i => i < t.colCnt)
      const unk = cols.filter(i => w[i] === 0)
      if (!unk.length) continue
      const rest = c.widthHwp - cols.reduce((a, i) => a + w[i], 0)
      if (rest <= 0) continue
      const each = Math.round(rest / unk.length)
      for (const i of unk) w[i] = each
      ch = true
    }
    if (!ch) break
  }
  return w.map(x => (x > 0 ? x : 1))
}
function projectCols(t: HwpxTable): number[] {
  const w = solveWidths(t)
  const total = w.reduce((a, b) => a + b, 0) || 1
  const map = [0]; let acc = 0
  for (const x of w) { acc += x; map.push(Math.round((acc / total) * FINE_N)) }
  for (let i = 1; i < map.length; i++) if (map[i] <= map[i - 1]) map[i] = map[i - 1] + 1
  return map
}
const colName = (i: number) => { let s = '', n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0); return s }
const colIdx = (s: string) => [...s].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1

for (const [sheet, cols] of [
  ['1.2.1 구역별 세부현황', ['B', 'C', 'D', 'J', 'K']],
  ['2.2 자위소방대 편성표', ['C', 'D', 'F', 'H', 'A']],
] as const) {
  const ms = manifest.sheets.find(s => s.name === sheet)!
  /* 이 시트의 **격자 표**(배너 아님)를 쓴다 — 계산형 앵커는 격자 행을 가리킨다 */
  const gt = ms.gridTops[0]
  const proj = projectCols(form[gt.table])
  console.log(`\n${sheet}  (표#${gt.table}, ${form[gt.table].colCnt}열 → ${FINE_N}열)`)
  for (const c of cols) {
    const i = colIdx(c)
    console.log(`   ${c} (${i}) → ${i < proj.length ? colName(proj[i]) : '(범위 밖)'}`)
  }
}
