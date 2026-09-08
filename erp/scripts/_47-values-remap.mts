/** `fire-plan-xlsx-values.ts`의 주소 리터럴을 옛 격자 → 미세 격자로 옮긴다 (Q-9).
 *
 *  이 파일은 `unitCell(FP_SHEET.F1_1, 'D9', …)`처럼 **시트+주소**를 직접 부른다.
 *  앵커와 같은 사상표를 쓰되, **앵커에 이미 있는 자리는 앵커의 새 주소를 그대로 따른다** —
 *  두 곳이 갈라지면 값이 앵커가 아닌 칸에 찍힌다.
 *
 *  🚨 옮긴 주소가 새 매니페스트에서 **라벨/토큰을 갖고 있는지** 확인하고, 하나라도 없으면 안 쓴다.
 *  실행: npx tsx scripts/_47-values-remap.mts [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { parseTables, type HwpxTable } from '../src/lib/hwpx-table.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes('--apply')
const FINE_N = 60
const VALUES = resolve(HERE, '../src/lib/fire-plan-xlsx-values.ts')

const zip = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const form = parseTables(await zip.file('Contents/section0.xml')!.async('string'))
interface MSheet { name: string; tables: number[]; bannerRows: number[]; gridTops: { table: number; top: number; rows: number }[]; labels?: Record<string, string>; boxes?: Record<string, string>; tokenCells?: Record<string, string> }
const oldM = JSON.parse(readFileSync(resolve(HERE, '../../_manifest-old.json'), 'utf8')) as { sheets: MSheet[] }
const newM = JSON.parse(readFileSync(resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json'), 'utf8')) as { sheets: MSheet[] }
const newBy = new Map(newM.sheets.map(s => [s.name, s]))

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
const ref = (r: number, c: number) => `${colName(c)}${r + 1}`

const mapOf = new Map<string, Map<string, string>>()
for (const ms of oldM.sheets) {
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

/* 소스에서 시트 상수 해석 */
const anchors = readFileSync(resolve(HERE, '../src/lib/fire-plan-anchors.ts'), 'utf8')
const sheetConst = new Map<string, string>()
for (const m of anchors.matchAll(/(\w+):\s*'([^']+)',/g)) sheetConst.set(m[1], m[2])

let src = readFileSync(VALUES, 'utf8')
const RE = /(fillTemplate|checkCell|unitCell|boxLabelCell|yesNoCell)\((FP_SHEET\.(\w+)|'([^']+)'),\s*'([A-Z]+\d+)'/g
const hits = [...src.matchAll(RE)]
console.log(`주소 리터럴 ${hits.length}개\n`)

let moved = 0
const bad: string[] = []
for (const h of hits) {
  const sheet = h[3] ? (sheetConst.get(h[3]) ?? h[3]) : h[4]
  const cell = h[5]
  const m = mapOf.get(sheet), sh = newBy.get(sheet)
  if (!m || !sh) { bad.push(`${sheet}!${cell}: 시트 사상 없음`); continue }
  const nc = m.get(cell)
  if (!nc) { bad.push(`${sheet}!${cell}: 주소 사상 없음`); continue }
  const has = sh.labels?.[nc] !== undefined || sh.boxes?.[nc] !== undefined || sh.tokenCells?.[nc] !== undefined
  if (!has) { bad.push(`${sheet}!${cell} → ${nc}: 새 매니페스트에 라벨·토큰이 없다`); continue }
  src = src.replace(h[0], h[0].replace(`'${cell}'`, `'${nc}'`))
  moved++
  console.log(`   ${sheet.padEnd(22)} ${cell.padEnd(5)} → ${nc}`)
}
console.log(`\n✅ 옮김 ${moved}/${hits.length}`)
if (bad.length) { console.log(`🚨 막힌 것 ${bad.length}개 — 쓰지 않는다:`); bad.forEach(l => console.log('   ' + l)); process.exit(1) }
if (!APPLY) { console.log('\n(미리보기 — 적용하려면 --apply)'); process.exit(0) }
writeFileSync(VALUES, src, 'utf8')
console.log(`\n✅ ${VALUES} 갱신`)
