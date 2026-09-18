/** 1.11.2 소방훈련·교육 세부계획 — 슬롯·상자 좌표와 자구 실측 (2026-09-18, 기각 재검토)
 *  실행: npx tsx --conditions=react-server scripts/_probe-1112-layout.mts */
import JSZip from 'jszip'
import { blankReport } from '../src/lib/fire-plan-blanks.ts'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
import { sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'

const SHEET = '1.11.2 소방훈련·교육 세부계획'
const rs = await blankReport([SHEET], null)
console.log(`슬롯 ${rs[0].slots} · 상자 ${rs[0].boxes}`)
console.log('빈 슬롯: ' + rs[0].blanks.map(b => b.ref).sort().join(' '))
const m = sheetManifest(SHEET)
console.log('\n상자칸:')
for (const [cell] of Object.entries(m.boxes)) {
  console.log(`  ${cell} ${JSON.stringify((m.labels[cell] ?? '').slice(0, 50))}`)
}
const t = await firePlanTemplate()
const g = await readSheetGrid(await JSZip.loadAsync(t.bytes), SHEET)
console.log('\n병합(빈 칸만 — 값이 실릴 후보):')
for (const c of g.cells) {
  if (!c.span || (c.text ?? '').trim()) continue
  console.log(`  ${c.ref} (${c.span.rows}×${c.span.cols})`)
}
console.log('\n라벨 전부:')
for (const [cell, lbl] of Object.entries(m.labels)) {
  console.log(`  ${cell} ${JSON.stringify(lbl.slice(0, 60))}`)
}
console.log('\n예시문칸 후보 전문(핀에 적을 자구 — 자르지 않는다):')
for (const cell of ['I4', 'I14', 'I15', 'I16']) {
  console.log(`  ${cell} ${JSON.stringify(m.labels[cell] ?? null)}`)
}
