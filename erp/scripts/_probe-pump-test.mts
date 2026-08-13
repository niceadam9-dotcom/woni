// 펌프성능시험 판정 프로브 (소방계획서_21 R5-7 후속) — DB 없이 순수 함수 전 조합 단언
// 실행: npx tsx scripts/_probe-pump-test.mts
import pump from '../src/lib/pump-test.ts'

const { judgePumpTest, emptyPumpRow, pumpRowHasValue, PUMP_TEST_SHEETS, PUMP_JUDGE_LABELS } = pump as typeof import('../src/lib/pump-test.ts')

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

const row = (o: Partial<ReturnType<typeof emptyPumpRow>>) => ({ ...emptyPumpRow(2, '주'), ...o })

// ── 서식 상수 ──
check('표가 붙는 설비 6개 (법정 서식 기준)',
  PUMP_TEST_SHEETS.length === 6 && [2, 3, 4, 6, 7, 8].every(n => (PUMP_TEST_SHEETS as readonly number[]).includes(n)),
  PUMP_TEST_SHEETS.join(','))
check('적정 여부 문장 3개', PUMP_JUDGE_LABELS.length === 3)
check('①은 140% 기준 문장', PUMP_JUDGE_LABELS[0].includes('140%'))
check('③은 65% 기준 문장', PUMP_JUDGE_LABELS[2].includes('65%'))

// ── ① 체절운전 토출압 ≤ 정격토출압 × 140% ──
check('① 경계 정확히 140% → O', judgePumpTest(row({ ratedPress: 1.0, shutoffPress: 1.4 })).auto[0] === 'O')
check('① 140% 초과 → X', judgePumpTest(row({ ratedPress: 1.0, shutoffPress: 1.41 })).auto[0] === 'X')
check('① 여유 있으면 O', judgePumpTest(row({ ratedPress: 0.7, shutoffPress: 0.9 })).auto[0] === 'O')

// ── ③ 150% 운전 토출압 ≥ 정격토출압 × 65% ──
check('③ 경계 정확히 65% → O', judgePumpTest(row({ ratedPress: 1.0, overPress: 0.65 })).auto[2] === 'O')
check('③ 65% 미만 → X', judgePumpTest(row({ ratedPress: 1.0, overPress: 0.64 })).auto[2] === 'X')

// ── 근거가 없으면 단정하지 않는다 ──
const noRated = judgePumpTest(row({ shutoffPress: 1.4, overPress: 0.7 }))
check('정격토출압 없으면 ① 자동 판정 없음', noRated.auto[0] === null)
check('정격토출압 없으면 ③ 자동 판정 없음', noRated.auto[2] === null)
check('①에 사유 안내', !!noRated.reasons[0] && noRated.reasons[0]!.includes('정격운전 토출압'))
check('② 규정치는 시스템에 없어 항상 수동',
  judgePumpTest(row({ ratedPress: 1, ratedFlow: 100 })).auto[1] === null)
check('②에 사유 안내', judgePumpTest(row({})).reasons[1]!.includes('명판'))

// ── 수동 보정이 자동값을 이긴다 (final) ──
const overridden = judgePumpTest(row({ ratedPress: 1.0, shutoffPress: 2.0, judge1: 'O' }))
check('수동 O가 자동 X를 덮어씀 (final)', overridden.auto[0] === 'X' && overridden.final[0] === 'O')
const notOverridden = judgePumpTest(row({ ratedPress: 1.0, shutoffPress: 2.0 }))
check('보정 없으면 final = 자동', notOverridden.final[0] === 'X')
check('보정도 자동도 없으면 final = null', judgePumpTest(row({})).final[1] === null)

// ── 빈 행 판별 (빈 행은 저장·출력하지 않는다) ──
check('전부 빈 행은 값 없음', !pumpRowHasValue(emptyPumpRow(2, '주')))
check('수치 하나만 있어도 값 있음', pumpRowHasValue(row({ shutoffFlow: 0 })))
check('0도 값으로 센다 (체절 토출량 0은 정상값)', pumpRowHasValue(row({ shutoffFlow: 0 })))
check('판정만 있어도 값 있음', pumpRowHasValue(row({ judge2: 'O' })))
check('공백 비고는 값 아님', !pumpRowHasValue(row({ note: '   ' })))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
