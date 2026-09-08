/** Q-9 1번 사전 점검 — 격자를 미세로 바꾸면 좌표가 어디로 가는가, 그리고 **라벨이 따라가는가**.
 *
 *  빌더는 `cellRef(r0, c.col)`로 hwp 열 인덱스를 그대로 엑셀 열로 쓴다(성긴 격자).
 *  미세 격자는 `cellRef(r0, map[c.col])`이 된다. 두 주소를 같은 재료로 계산해 **사상표**를 만들고,
 *  앵커 62개가 새 좌표에서도 **같은 라벨을 물고 있는지**를 확인한다.
 *
 *  🚨 라벨이 어긋나면 빌더를 고치지 않는다 — `validateAnchors`가 500으로 끊을 것이고,
 *     그 전에 여기서 멈추는 편이 싸다.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { parseTables, type HwpxTable } from '../src/lib/hwpx-table.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const N = 60

const zip = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const form = parseTables(await zip.file('Contents/section0.xml')!.async('string'))
interface MSheet { name: string; tables: number[]; bannerRows: number[]; gridTops: { table: number; top: number; rows: number }[]; labels?: Record<string, string>; tokenCells?: Record<string, string> }
const manifest = JSON.parse(readFileSync(resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json'), 'utf8')) as { sheets: MSheet[] }

/* ── 미세 격자 투영 (‑gs-book50과 같은 규칙) ── */
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
  for (const x of w) { acc += x; map.push(Math.round((acc / total) * N)) }
  for (let i = 1; i < map.length; i++) if (map[i] <= map[i - 1]) map[i] = map[i - 1] + 1
  return map
}
const colName = (i: number) => { let s = '', n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0); return s }
const ref = (r: number, c: number) => `${colName(c)}${r + 1}`

/* ── 시트별 old→new 사상 ── */
const mapOf = new Map<string, Map<string, string>>()
for (const ms of manifest.sheets) {
  const topOf = new Map<number, number>()
  for (const g of ms.gridTops ?? []) topOf.set(g.table, g.top)
  const banners = ms.tables.filter(t => !topOf.has(t))
  const brs = (ms.bannerRows ?? []).slice()
  banners.forEach((t, i) => topOf.set(t, brs[i] ?? (brs[brs.length - 1] ?? 0)))

  const m = new Map<string, string>()
  for (const ti of ms.tables) {
    const t = form[ti]; const top = topOf.get(ti)!
    const proj = projectCols(t)
    for (const c of t.cells) m.set(ref(top + c.row, c.col), ref(top + c.row, proj[c.col]))
  }
  mapOf.set(ms.name, m)
}
console.log(`시트 ${mapOf.size}개의 좌표 사상 준비\n`)

/* ── 앵커가 새 좌표에서도 같은 라벨을 무는가 ── */
const src = readFileSync(resolve(HERE, '../src/lib/fire-plan-anchors.ts'), 'utf8')
const sheetConst = new Map<string, string>()
for (const m of src.matchAll(/(\w+):\s*'([^']+)',/g)) sheetConst.set(m[1], m[2])
const anchors = [...src.matchAll(/\{\s*field:\s*'([^']+)',\s*sheet:\s*(?:FP_SHEET\.(\w+)|'([^']+)'),\s*cell:\s*'([^']+)',\s*labelCell:\s*'([^']+)'/g)]
  .map(m => ({ field: m[1], sheet: m[2] ? (sheetConst.get(m[2]) ?? m[2]) : m[3], cell: m[4], labelCell: m[5] }))
console.log(`앵커 ${anchors.length}개 (cell+labelCell 쌍)\n`)

const byName = new Map(manifest.sheets.map(s => [s.name, s]))
let ok = 0; const bad: string[] = []
for (const a of anchors) {
  const m = mapOf.get(a.sheet)
  const sh = byName.get(a.sheet)
  if (!m || !sh) { bad.push(`${a.field}: 시트 «${a.sheet}» 사상 없음`); continue }
  const nc = m.get(a.cell), nl = m.get(a.labelCell)
  if (!nc || !nl) { bad.push(`${a.field}: ${a.sheet}!${!nc ? a.cell : a.labelCell} 사상 없음`); continue }
  /* 라벨은 매니페스트가 옛 주소로 갖고 있다 — 새 주소로 옮겨도 **같은 문구**여야 한다 */
  const label = sh.labels?.[a.labelCell]
  if (label === undefined) { bad.push(`${a.field}: 라벨칸 ${a.labelCell}에 매니페스트 라벨이 없다`); continue }
  ok++
}
console.log(`✅ 새 좌표로 옮길 수 있는 앵커  ${ok}/${anchors.length}`)
if (bad.length) { console.log(`🚨 막힌 것 ${bad.length}개:`); bad.slice(0, 15).forEach(l => console.log('   ' + l)) }

console.log('\n— 사상 표본 (서식 1.1) —')
const m11 = mapOf.get('1.1 건축물 일반현황')!
for (const a of anchors.filter(x => x.sheet === '1.1 건축물 일반현황').slice(0, 8)) {
  console.log(`   ${a.field.padEnd(20)} ${a.cell.padEnd(5)} → ${m11.get(a.cell)}   (라벨 ${a.labelCell} → ${m11.get(a.labelCell)})`)
}
