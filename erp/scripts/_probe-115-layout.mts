/** 1.15 피해 복구 — 화재발생개요 칸 배치 실측 (2026-09-18, 보류 재검토)
 *  실행: npx tsx --conditions=react-server scripts/_probe-115-layout.mts */
import JSZip from 'jszip'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
import { blankReport } from '../src/lib/fire-plan-blanks.ts'

const SHEET = '1.15 피해 복구'
const rs = await blankReport([SHEET], null)
console.log(`슬롯 ${rs[0].slots} · 상자 ${rs[0].boxes} — 빈 슬롯: ${rs[0].blanks.map(b => b.ref).sort().join(' ')}`)

const t = await firePlanTemplate()
const zip = await JSZip.loadAsync(t.bytes)
const g = await readSheetGrid(zip, SHEET)
console.log('\n행 10~18 전 칸(병합 좌상단·글자·크기):')
for (const c of g.cells) {
  if (c.row < 9 || c.row > 17 || !c.span) continue
  console.log(`  ${c.ref} (${c.span.rows}×${c.span.cols}) ${JSON.stringify((c.text ?? '').slice(0, 30))}`)
}
console.log('\n상자칸:')
const { sheetManifest } = await import('../src/lib/fire-plan-xlsx-manifest.ts')
for (const [cell, n] of Object.entries(sheetManifest(SHEET).boxes)) {
  console.log(`  ${cell} ×${n} ${JSON.stringify((sheetManifest(SHEET).labels[cell] ?? '').slice(0, 30))}`)
}
