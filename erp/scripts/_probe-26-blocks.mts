/** 2.6 연락대상 블록 경계 — A5·A11·A14 병합 범위 실측 (2026-09-18)
 *  실행: npx tsx --conditions=react-server scripts/_probe-26-blocks.mts */
import JSZip from 'jszip'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'

const t = await firePlanTemplate()
const zip = await JSZip.loadAsync(t.bytes)
const g = await readSheetGrid(zip, '2.6 비상연락팀(지휘반)')
for (const c of g.cells) {
  if (!c.span || c.span.rows < 2) continue
  console.log(`${c.ref} (${c.span.rows}행×${c.span.cols}열) ${JSON.stringify((c.text ?? '').slice(0, 30))}`)
}
