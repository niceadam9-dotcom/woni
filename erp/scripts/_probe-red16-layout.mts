/** 적색 16장 중 미조사 7장 — 양식 내용 덤프 (2026-09-18)
 *  다음 배선 후보를 정하는 근거: 각 시트가 무엇을 묻는지 실측해 ERP 데이터 축 유무를 가린다.
 *  (② 순위 사고의 교훈 — 순위는 상자 수가 아니라 데이터 유무가 먼저.)
 *  실행: npx tsx --conditions=react-server scripts/_probe-red16-layout.mts */
import JSZip from 'jszip'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'

const SHEETS = [
  '1.15 피해 복구',
  '1.11.2 소방훈련·교육 세부계획',
  '1.11.4 결과기록부 뒷쪽',
  '1.14.2 화재예방 및 홍보 결과',
  '1.5.2 방화·제연구획 현황도',
  '1.3 건축물 위치·운영현황',
  '3.6 피난약자 유형별 방법',
]

const t = await firePlanTemplate()
const zip = await JSZip.loadAsync(t.bytes)

for (const name of SHEETS) {
  console.log(`\n══════════ ${name} ══════════`)
  const g = await readSheetGrid(zip, name)
  const byRow = new Map<number, string[]>()
  for (const c of g.cells) {
    if (!c.text || !c.text.trim()) continue
    const arr = byRow.get(c.row) ?? []
    arr.push(`${c.ref}:${JSON.stringify(c.text.slice(0, 60))}`)
    byRow.set(c.row, arr)
  }
  for (const [, arr] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    console.log('  ' + arr.join('  '))
  }
}
