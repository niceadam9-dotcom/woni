/** 시트 구조 프로브 — 배선 전에 「이 표가 어떤 모양인가」를 눈으로 본다.
 *  라벨·슬롯·병합폭을 행별로 늘어놓아 반복 행 예산과 열 좌표를 사람이 확인한다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-sheet-shape.mts "<시트명>" */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
import { sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const sheet = process.argv[2]
if (!sheet) { console.error('시트명을 인자로 달라'); process.exit(1) }

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(resolve(HERE, '../templates/fire-plan-workbook.xlsx'))))
const g = await readSheetGrid(zip, sheet)
const man = sheetManifest(sheet)

console.log(`${sheet} — ${g.rows}행 × ${g.cols}열 · 라벨 ${Object.keys(man.labels).length} · 상자 ${Object.keys(man.boxes).length} · 병합 ${g.merges.length}`)
console.log(`머리띠 행: ${JSON.stringify(man.bannerRows)} · numberedRuns: ${JSON.stringify(man.numberedRuns)}`)
console.log(`gridTops: ${JSON.stringify(man.gridTops)}`)
console.log('')

for (let r = 0; r < g.rows; r++) {
  const cells = g.cells.filter(c => c.row === r && !c.covered)
  const parts = cells.map(c => {
    const w = c.span?.cols ?? 1
    const lab = man.labels[c.ref]
    const box = man.boxes[c.ref]
    const hasB = c.style.left !== 'none' || c.style.right !== 'none' || c.style.top !== 'none' || c.style.bottom !== 'none'
    if (lab) return `${c.ref}[${w}]「${lab.replace(/\s+/g, ' ').slice(0, 18)}」`
    if (box) return `${c.ref}[${w}]${box}`
    if (hasB) return `${c.ref}[${w}]·`          // 값 슬롯
    return null
  }).filter(Boolean)
  if (parts.length) console.log(`  r${String(r + 1).padStart(2)}  ${parts.join('  ')}`)
}
