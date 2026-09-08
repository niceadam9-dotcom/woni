/** 앵커 좌표를 옛 격자 → 새(미세) 격자로 옮긴다 (소방계획서_47 Q-9).
 *
 *  ⭐ **옮기는 것은 좌표뿐이다.** `field ↔ labelCell` 쌍은 사람이 라벨을 보며 재승인한 판단이라
 *    그대로 둔다(실측: 62개 중 40개가 토큰만으로는 세울 수 없는 자리였다 — 씨앗을 그대로
 *    믿었으면 `1.1!I7`에 대표자 전화가 박힌다).
 *
 *  방법: **옛 매니페스트**(백업)와 **새 매니페스트**를 같은 (표, 행, 열) 축으로 잇는다.
 *   · 옛 주소 = cellRef(top + row, col)          ← 성긴 격자(hwp 열 = 엑셀 열)
 *   · 새 주소 = cellRef(top + row, proj[col])    ← 미세 격자
 *  두 매니페스트의 `gridTops`·`bannerRows`가 같으므로 top은 공유한다.
 *
 *  🚨 검증: 옮긴 뒤 **새 매니페스트의 그 자리에 같은 라벨이 있는지** 확인한다. 하나라도
 *     어긋나면 파일을 쓰지 않는다 — `validateAnchors`가 어차피 500으로 끊을 것이고
 *     여기서 멈추는 편이 싸다.
 *
 *  실행: npx tsx scripts/_47-anchor-remap.mts [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { parseTables, type HwpxTable } from '../src/lib/hwpx-table.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes('--apply')
const FINE_N = 60
const ANCHORS = resolve(HERE, '../src/lib/fire-plan-anchors.ts')
const OLD_MANIFEST = resolve(HERE, '../../_manifest-old.json')
const NEW_MANIFEST = resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json')

const zip = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const form = parseTables(await zip.file('Contents/section0.xml')!.async('string'))

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

interface MSheet { name: string; tables: number[]; bannerRows: number[]; gridTops: { table: number; top: number; rows: number }[]; labels?: Record<string, string>; boxes?: Record<string, string>; tokenCells?: Record<string, string> }
const oldM = JSON.parse(readFileSync(OLD_MANIFEST, 'utf8')) as { sheets: MSheet[] }
const newM = JSON.parse(readFileSync(NEW_MANIFEST, 'utf8')) as { sheets: MSheet[] }
const newBy = new Map(newM.sheets.map(s => [s.name, s]))

/* 시트별 옛→새 사상 */
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

/* 앵커 파싱 */
const src = readFileSync(ANCHORS, 'utf8')
const sheetConst = new Map<string, string>()
for (const m of src.matchAll(/(\w+):\s*'([^']+)',/g)) sheetConst.set(m[1], m[2])
const RE = /\{\s*field:\s*'([^']+)',\s*sheet:\s*(?:FP_SHEET\.(\w+)|'([^']+)'),\s*cell:\s*'([^']+)',\s*labelCell:\s*'([^']+)'\s*\}/g
const hits = [...src.matchAll(RE)]
console.log(`앵커 ${hits.length}개\n`)

let out = src, moved = 0
const bad: string[] = []
for (const h of hits) {
  const sheet = h[2] ? (sheetConst.get(h[2]) ?? h[2]) : h[3]
  const [field, cell, labelCell] = [h[1], h[4], h[5]]
  const m = mapOf.get(sheet), sh = newBy.get(sheet)
  if (!m || !sh) { bad.push(`${field}: 시트 «${sheet}» 없음`); continue }
  const nc = m.get(cell), nl = m.get(labelCell)
  if (!nc || !nl) { bad.push(`${field}: ${sheet}!${!nc ? cell : labelCell} 사상 없음`); continue }
  /* 🚨 옮긴 라벨칸에 **라벨이 실제로 있는지** 확인 — 없으면 좌표가 밀린 것이다 */
  const hasLabel = sh.labels?.[nl] !== undefined || sh.boxes?.[nl] !== undefined
  if (!hasLabel) { bad.push(`${field}: 새 라벨칸 ${sheet}!${nl}에 라벨이 없다(옛 ${labelCell})`); continue }
  out = out.replace(h[0], h[0].replace(`cell: '${cell}'`, `cell: '${nc}'`).replace(`labelCell: '${labelCell}'`, `labelCell: '${nl}'`))
  moved++
}

console.log(`✅ 옮김 ${moved}/${hits.length}`)
if (bad.length) {
  console.log(`🚨 막힌 것 ${bad.length}개 — **파일을 쓰지 않는다**:`)
  bad.forEach(l => console.log('   ' + l))
  process.exit(1)
}
if (!APPLY) { console.log('\n(미리보기 — 적용하려면 --apply)'); process.exit(0) }
writeFileSync(ANCHORS, out, 'utf8')
console.log(`\n✅ ${ANCHORS} 갱신`)
