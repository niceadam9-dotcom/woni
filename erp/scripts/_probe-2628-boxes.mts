/** 2.6·2.8 설비 파생 상자 + 2장 팀별 대상명 칸 실측 (2026-09-18)
 *  실행: npx tsx --conditions=react-server scripts/_probe-2628-boxes.mts */
import { blankReport } from '../src/lib/fire-plan-blanks.ts'
import { sheetManifest, labelAt } from '../src/lib/fire-plan-xlsx-manifest.ts'

for (const SHEET of ['2.6 비상연락팀(지휘반)', '2.8 비상상황별 연락방법']) {
  const rs = await blankReport([SHEET], null)
  console.log(`\n══ ${SHEET} — 슬롯 ${rs[0].slots} · 상자 ${rs[0].boxes}`)
  console.log('빈 슬롯: ' + rs[0].blanks.map(b => b.ref).sort().join(' '))
  const m = sheetManifest(SHEET)
  for (const [cell, n] of Object.entries(m.boxes)) {
    console.log(`  상자 ${cell} ×${n}  ${JSON.stringify((m.labels[cell] ?? '').slice(0, 50))}`)
  }
}

console.log('\n══ 대상명 칸 자구(접두라벨 후보) ══')
for (const SHEET of ['2.6 비상연락팀(지휘반)', '2.9 초기소화팀(진압반)', '2.10 피난유도팀', '2.11 응급구조팀']) {
  console.log(`${SHEET}  A2=${JSON.stringify(labelAt(SHEET, 'A2'))}`)
}
