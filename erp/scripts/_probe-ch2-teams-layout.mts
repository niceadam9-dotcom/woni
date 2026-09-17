/** 2장 팀별 시트 — 양식 내용 덤프 (2026-09-18)
 *  D-2의 전제 검증: `brigadeTeams` 축(팀별 임무 서술+프리셋)이 ERP·PDF에 이미 있다.
 *  팀별 시트의 슬롯이 정말 「임무 문구」 칸인지 실측한다(D-1 전례 — 답은 결정이 아니라 실측).
 *  실행: npx tsx --conditions=react-server scripts/_probe-ch2-teams-layout.mts */
import JSZip from 'jszip'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'

const SHEETS = [
  '2.3 임무',
  '2.6 비상연락팀(지휘반)',
  '2.8 비상상황별 연락방법',
  '2.9 초기소화팀(진압반)',
  '2.10 피난유도팀',
  '2.11 응급구조팀',
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
