/** 2.5 지휘통제팀 — 기각 사유 재실측 (2026-09-18, 오늘 세 번 낡은 기각의 후속)
 *  실행: npx tsx --conditions=react-server scripts/_probe-25-layout.mts */
import JSZip from 'jszip'
import { blankReport } from '../src/lib/fire-plan-blanks.ts'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
import { sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'

const SHEET = '2.5 지휘통제팀'
const rs = await blankReport([SHEET], null)
console.log(`슬롯 ${rs[0].slots} · 상자 ${rs[0].boxes}`)
console.log('빈 슬롯: ' + rs[0].blanks.map(b => b.ref).sort().join(' '))
const m = sheetManifest(SHEET)
console.log('\n상자칸:')
for (const cell of Object.keys(m.boxes)) {
  console.log(`  ${cell} ${JSON.stringify((m.labels[cell] ?? '').slice(0, 44))}`)
}
console.log('\n라벨(상자 아닌 것):')
for (const [cell, lbl] of Object.entries(m.labels)) {
  if (m.boxes[cell]) continue
  console.log(`  ${cell} ${JSON.stringify(lbl.slice(0, 50))}`)
}
const t = await firePlanTemplate()
const g = await readSheetGrid(await JSZip.loadAsync(t.bytes), SHEET)
console.log('\n병합 빈 칸:')
for (const c of g.cells) {
  if (!c.span || (c.text ?? '').trim()) continue
  console.log(`  ${c.ref} (${c.span.rows}×${c.span.cols})`)
}
