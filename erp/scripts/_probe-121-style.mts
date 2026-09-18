/** 1.2.1 8~21행 스타일 비교 — 16행부터 정말 다른 서식인가 (2026-09-18)
 *  실행: npx tsx --conditions=react-server scripts/_probe-121-style.mts */
import JSZip from 'jszip'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'

const t = await firePlanTemplate()
const g = await readSheetGrid(await JSZip.loadAsync(t.bytes), '1.2.1 구역별 세부현황')
const at = (ref: string) => g.cells.find(c => c.ref === ref)
for (const col of ['A', 'D', 'H', 'W', 'BB']) {
  console.log(`\n[${col}열]`)
  for (const r of [8, 9, 15, 16, 17, 21]) {
    const c = at(`${col}${r}`)
    if (!c) { console.log(`  ${col}${r}: (칸 없음)`); continue }
    const s = c.style as Record<string, unknown>
    console.log(`  ${col}${r}: L=${s.left} R=${s.right} T=${s.top} B=${s.bottom} fill=${s.fill ?? '-'} align=${s.align}`)
  }
}
