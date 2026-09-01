/** 회귀 고정 — 시트를 전부 ／(해당없음)로 채워도 별지 3쪽에 ○(양호)로 인쇄되지 않는다.
 *
 *  2026-08-21 결함 재현용으로 태어나 소방계획서_26 S1(SheetStat 3축화·foldSheetResult) 수정 후
 *  회귀 고정으로 승격. 종전엔 SheetStat이 {any,x} 두 축이라 N만 있어도 any=true·x=false → 'O'였고,
 *  [／ 전체] 버튼(inspection-sheet-client.tsx · sheet-group-board.tsx) 하나로 그 상태를 만들 수 있었다.
 *  실행: npx tsx scripts/_probe-na-only-becomes-good.mts */
import { rollUpForm3Results, legacySheetOnlyStats, foldSheetResult, type SheetStat } from '../src/lib/sheet-facility-map.ts'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `  ${extra}`}`); ok ? pass++ : fail++
}

/** 실제 구성 지점(report9-actions·facility-spec-actions)과 **같은 함수**로 SheetStat을 만든다 */
function buildStat(rows: Array<{ sheet: string; result: 'O' | 'X' | 'N' }>) {
  const st = new Map<string, SheetStat>()
  for (const r of rows) st.set(r.sheet, foldSheetResult(st.get(r.sheet), r.result))
  return st
}

const ITEMS = ['유도등', '유도표지', '피난유도선', '옥내소화전설비']
const SHEET = '유도등 및 유도표지'

console.log('── 시트 응답이 전부 ／(N)인데 설비는 설치(√)')
{
  const stat = buildStat([
    { sheet: SHEET, result: 'N' }, { sheet: SHEET, result: 'N' }, { sheet: SHEET, result: 'N' },
  ])
  const { facilityChecks, resultMarks } = rollUpForm3Results(legacySheetOnlyStats(stat), ITEMS, ['유도등'])
  console.log(`     설치=${facilityChecks.includes('유도등')} · 유도등 결과=${JSON.stringify(resultMarks['유도등'])}`)
  check('해당없음만 입력하면 ／로 찍힌다 (○ 둔갑 금지)', resultMarks['유도등'] === 'N',
    `→ 실제 '${resultMarks['유도등']}'`)
}

console.log('\n── 대조군: 한 항목이라도 ○이면 ○가 맞다')
{
  const stat = buildStat([{ sheet: SHEET, result: 'N' }, { sheet: SHEET, result: 'O' }])
  const { resultMarks } = rollUpForm3Results(legacySheetOnlyStats(stat), ITEMS, ['유도등'])
  check('○ 섞이면 ○', resultMarks['유도등'] === 'O', `실제 ${resultMarks['유도등']}`)
}

console.log('\n── 대조군: ✕가 있으면 ×가 맞다')
{
  const stat = buildStat([{ sheet: SHEET, result: 'N' }, { sheet: SHEET, result: 'X' }])
  const { resultMarks } = rollUpForm3Results(legacySheetOnlyStats(stat), ITEMS, ['유도등'])
  check('✕ 섞이면 ×', resultMarks['유도등'] === 'X', `실제 ${resultMarks['유도등']}`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
