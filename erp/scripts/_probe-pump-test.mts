// 펌프성능시험 판정 프로브 (소방계획서_21 R5-7 후속) — DB 없이 순수 함수 전 조합 단언
// 실행: npx tsx scripts/_probe-pump-test.mts
import pump from '../src/lib/pump-test.ts'

const { judgePumpTest, emptyPumpRow, pumpRowHasValue, PUMP_TEST_SHEETS, PUMP_JUDGE_LABELS, PUMP_SHEET_LABELS } = pump as typeof import('../src/lib/pump-test.ts')

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

const row = (o: Partial<ReturnType<typeof emptyPumpRow>>) => ({ ...emptyPumpRow(2, '주'), ...o })

// ── 서식 상수 ──
// 8개다 — 이 단언은 원래 6개로 굳어 있었고 그 숫자가 틀렸다(5·13 누락).
// 고시 원문에서 '펌프성능시험' 9회 출현의 직전 항목코드로 귀속을 확정했다:
//   2-H-031→2 · 3-L-002→3 · '4쪽 중 4쪽'면→4 · 5-M-001→5 · 6-L-001→6 · 7-I-031→7 · 8-L-041→8 · 13-G-041→13
// 근거: scripts/_probe-pump-table-source.mjs(두 원문 교차 대조) · _probe-pump-table-context.mjs(문맥)
check('표가 붙는 설비 8개 (법정 서식 기준)',
  PUMP_TEST_SHEETS.length === 8 && [2, 3, 4, 5, 6, 7, 8, 13].every(n => (PUMP_TEST_SHEETS as readonly number[]).includes(n)),
  PUMP_TEST_SHEETS.join(','))
check('설비 라벨이 전 대상에 있다',
  PUMP_TEST_SHEETS.every(n => !!PUMP_SHEET_LABELS[n]),
  PUMP_TEST_SHEETS.filter(n => !PUMP_SHEET_LABELS[n]).join(',') || 'ok')
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
check('② 명판 없으면 자동 판정 안 함(수동)',
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

// ── C3 4단계 — 설비 대장 펌프 명판이 있으면 ② 자동 (2026-10-03) ──
{
  const { headToMpa } = pump as typeof import('../src/lib/pump-test.ts')
  const plates = await import('../src/lib/pump-plates.ts')
  const { buildPlateMap, plateFor, plateFromSpecs } = (plates as unknown as { default?: typeof plates }).default ?? plates
  const plate = { ratedFlowLpm: 1200, ratedHeadM: 80 }   // 80m ≈ 0.7845 MPa
  check('양정 80m → 0.7845MPa', headToMpa(80) === 0.7845, String(headToMpa(80)))
  check('명판 있음 + 정격 1200ℓ·0.80MPa → ② 자동 O', judgePumpTest(row({ ratedFlow: 1200, ratedPress: 0.8 }), plate).auto[1] === 'O')
  check('토출량 미달(1100ℓ) → ② X', judgePumpTest(row({ ratedFlow: 1100, ratedPress: 0.8 }), plate).auto[1] === 'X')
  check('토출압 미달(0.78MPa < 0.7845) → ② X', judgePumpTest(row({ ratedFlow: 1300, ratedPress: 0.78 }), plate).auto[1] === 'X')
  check('명판 있어도 실측 없으면 판정 안 함 + 사유', judgePumpTest(row({ ratedPress: 0.8 }), plate).auto[1] === null && !!judgePumpTest(row({ ratedPress: 0.8 }), plate).reasons[1])
  check('수동 보정이 자동을 이긴다(자동 O, 수동 X → 최종 X)', judgePumpTest(row({ ratedFlow: 1200, ratedPress: 0.8, judge2: 'X' }), plate).final[1] === 'X')
  check('명판 없으면 종전 그대로(② null)', judgePumpTest(row({ ratedFlow: 1200, ratedPress: 0.8 })).auto[1] === null && judgePumpTest(row({ ratedFlow: 1200, ratedPress: 0.8 }), null).auto[1] === null)
  const r13 = row({ ratedPress: 0.8, shutoffPress: 1.0, overPress: 0.6 })
  check('①③은 명판과 무관', judgePumpTest(r13, plate).auto[0] === judgePumpTest(r13).auto[0] && judgePumpTest(r13, plate).auto[2] === judgePumpTest(r13).auto[2])
  check('specs 형식: 설비 번호 밖(9) → 무시', plateFromSpecs({ pump_sheet_no: 9, pump_kind: '주', rated_flow_lpm: 1, rated_head_m: 1 }) === null)
  check('specs 형식: 0 → 무시', plateFromSpecs({ pump_sheet_no: 2, pump_kind: '주', rated_flow_lpm: 0, rated_head_m: 80 }) === null)
  const m = buildPlateMap([
    { specs: { pump_sheet_no: 2, pump_kind: '주', rated_flow_lpm: 1200, rated_head_m: 80 } },
    { specs: { pump_sheet_no: 3, pump_kind: '주', rated_flow_lpm: 2400, rated_head_m: 90 } },
    { specs: { pump_sheet_no: 3, pump_kind: '주', rated_flow_lpm: 2000, rated_head_m: 85 } },
    { specs: {} },
  ])
  check('지도: 옥내소화전 주 = 명판', plateFor(m, 2, '주')?.ratedFlowLpm === 1200)
  check('지도: 같은 설비·구분 둘 → 판정 안 함(dup)', m['3|주'] === 'dup' && plateFor(m, 3, '주') === null)
  check('지도: 예비는 없음', plateFor(m, 2, '예비') === null)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
