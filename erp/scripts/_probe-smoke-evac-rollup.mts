/** Does entering responses into STD-24(제연설비) / STD-20(피난기구 및 인명구조기구)
 *  actually fill the 별지 3쪽 결과칸 for 거실제연설비 / 피난기구(→공기안전매트 행)?
 *  Pure-function simulation against the real shipped code. No DB. */
import {
  rollUpForm3Results, sheetMatchesFacilities, distributeSubMarks, form3ItemsForSheet,
  type SheetStat,
} from '../src/lib/sheet-facility-map'
import { FORM3_ITEMS } from '../src/lib/doc-templates/report9'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) fail++
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`)
}

// 송학떡집 실측 설치 목록에서 관련분만
const installed = ['피난기구', '거실제연설비', '유도표지', '옥내소화전설비']

console.log('=== A. FORM3 vocabulary present ===')
check('FORM3 has 거실제연설비', FORM3_ITEMS.includes('거실제연설비'))
check('FORM3 has 피난기구', FORM3_ITEMS.includes('피난기구'))

console.log('\n=== B. input screen would offer the sheets ===')
check('STD-24 제연설비 matches installed', sheetMatchesFacilities('제연설비', installed))
check('STD-20 피난기구 및 인명구조기구 matches installed',
  sheetMatchesFacilities('피난기구 및 인명구조기구', installed))

console.log('\n=== C. no responses at all (current staging state) ===')
{
  const stat = new Map<string, SheetStat>()
  const { facilityChecks, resultMarks } = rollUpForm3Results(stat, FORM3_ITEMS, installed)
  check('거실제연설비 is checked (installed)', facilityChecks.includes('거실제연설비'))
  check('거실제연설비 result is BLANK', resultMarks['거실제연설비'] === undefined,
    `mark=${resultMarks['거실제연설비']}`)
  check('피난기구 result is BLANK', resultMarks['피난기구'] === undefined,
    `mark=${resultMarks['피난기구']}`)
  const dist = distributeSubMarks(resultMarks['피난기구'], [true, false, false])
  check('공기안전매트 row BLANK, 미설치 하위는 N',
    dist.subs[0] === undefined && dist.subs[1] === 'N' && dist.subs[2] === 'N',
    JSON.stringify(dist))
}

console.log('\n=== D. after entering ONE 양호(O) into each sheet ===')
{
  const stat = new Map<string, SheetStat>([
    ['제연설비', { any: true, x: false, o: true }],
    ['피난기구 및 인명구조기구', { any: true, x: false, o: true }],
  ])
  const { resultMarks } = rollUpForm3Results(stat, FORM3_ITEMS, installed)
  check('거실제연설비 -> O', resultMarks['거실제연설비'] === 'O', `mark=${resultMarks['거실제연설비']}`)
  check('피난기구 -> O', resultMarks['피난기구'] === 'O', `mark=${resultMarks['피난기구']}`)
  const dist = distributeSubMarks(resultMarks['피난기구'], [true, false, false])
  check('공기안전매트 row inherits O', dist.subs[0] === 'O', JSON.stringify(dist))
  check('parent row blank when a sub carries it', dist.parent === undefined)
}

console.log('\n=== E. after entering one 불량(X) ===')
{
  const stat = new Map<string, SheetStat>([
    ['제연설비', { any: true, x: true, o: true }],
    ['피난기구 및 인명구조기구', { any: true, x: true, o: false }],
  ])
  const { resultMarks } = rollUpForm3Results(stat, FORM3_ITEMS, installed)
  check('거실제연설비 -> X', resultMarks['거실제연설비'] === 'X', `mark=${resultMarks['거실제연설비']}`)
  check('피난기구 -> X', resultMarks['피난기구'] === 'X', `mark=${resultMarks['피난기구']}`)
}

console.log('\n=== F. all responses are ／(N) ===')
{
  const stat = new Map<string, SheetStat>([['제연설비', { any: true, x: false, o: false }]])
  const { resultMarks } = rollUpForm3Results(stat, FORM3_ITEMS, installed)
  check('거실제연설비 -> N (not O)', resultMarks['거실제연설비'] === 'N', `mark=${resultMarks['거실제연설비']}`)
}

console.log('\n=== G. EXT(외관점검표) fuzzy fallback — which FORM3 items does each cover? ===')
{
  const EXT = [
    ['EXT-06', '피난기구, 유도등(유도표지), 비상조명등 및 휴대용비상조명등'],
    ['EXT-07', '제연설비, 특별피난계단의 계단실 및 부속실 제연설비'],
  ]
  for (const [code, name] of EXT) {
    const items = form3ItemsForSheet(name, FORM3_ITEMS)
    console.log(`  ${code} "${name}"\n    -> covers ${items.length}: [${items.join(', ')}]`)
  }
  const ext6 = form3ItemsForSheet(EXT[0][1], FORM3_ITEMS)
  const ext7 = form3ItemsForSheet(EXT[1][1], FORM3_ITEMS)
  check('EXT-06 covers 피난기구', ext6.includes('피난기구'))
  check('EXT-07 covers 거실제연설비', ext7.includes('거실제연설비'),
    'if FAIL: filling the exterior 제연 sheet rolls up to nothing')
  check('EXT-07 covers 부속실 등 제연설비', ext7.includes('부속실 등 제연설비'))
}

console.log(`\nRESULT = ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
process.exit(fail === 0 ? 0 : 1)
