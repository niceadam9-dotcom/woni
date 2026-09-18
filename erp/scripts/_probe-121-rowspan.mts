/** 1.2.1 표가 정말 14행인가 — 8~15행(토큰 있음)과 16~21행(토큰 없음)이 같은 모양인가
 *  (행 예산은 `tokenRowBudget`이 8로 파생했다. 표가 같은 모양으로 이어지면 예산이 짧은 것이다.)
 *  실행: npx tsx --conditions=react-server scripts/_probe-121-rowspan.mts */
import JSZip from 'jszip'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'

const t = await firePlanTemplate()
const g = await readSheetGrid(await JSZip.loadAsync(t.bytes), '1.2.1 구역별 세부현황')
const sig = (row: number) => g.cells
  .filter(c => c.row === row - 1 && c.span)
  .map(c => `${c.ref.replace(/\d+/g, '')}(${c.span!.rows}×${c.span!.cols})`)
  .join(' ')
for (const r of [8, 9, 14, 15, 16, 17, 20, 21, 22]) {
  console.log(`${String(r).padStart(2)}행: ${sig(r) || '(병합 없음)'}`)
}
console.log('\n행 높이(pt):', [8, 15, 16, 21].map(r => `${r}=${g.rowHeights[r - 1] ?? 0}`).join(' · '))
