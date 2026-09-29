/** 점검달력 데이 패널 — 문자 대상(방문) 행 판정. 순수 함수 검사(무서버·무DB).
 *  실행: npx tsx scripts/test-calendar-sms-row.mts
 *
 *  달력에서 고객을 **골라** 문자를 보낼 수 있게 되면서(2026-09-29), 「어느 행에 체크박스를 붙이는가」가
 *  곧 「누구에게 "방문합니다"가 나갈 수 있는가」가 됐다. 데이 패널의 단계 일정에는 ②~⑥ 서류 마감이
 *  섞여 있다 — 거기에 붙으면 방문하지도 않는 날짜로 안내가 나간다.
 *
 *  이 검사의 값어치는 「1단계에 붙는가」보다 **「2~6단계에 안 붙는가」**에 있다(음성 대조). */
import { smsDayOpen, isSmsStepRow, isSmsPlanRow } from '../src/lib/calendar-sms-row'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? `\n     ${d}` : ''}`) }
}

const TODAY = '2026-09-29'
const step = (stepNum: number, over: Partial<{ kind: string; stepStatus: string; customerId: string }> = {}) =>
  ({ kind: 'step', stepNum, stepStatus: 'pending', customerId: 'c1', ...over })

console.log('\n— 날짜')
check('내일은 열린다', smsDayOpen({ canSendSms: true, date: '2026-09-30', today: TODAY }))
check('오늘도 열린다(당일 안내 시점 0)', smsDayOpen({ canSendSms: true, date: TODAY, today: TODAY }))
check('★ 어제는 닫힌다 — 지난 방문에 "방문합니다"는 없다',
  !smsDayOpen({ canSendSms: true, date: '2026-09-28', today: TODAY }))
check('★ 권한이 없으면 닫힌다', !smsDayOpen({ canSendSms: false, date: '2026-09-30', today: TODAY }))
check('패널이 닫혀 있으면(날짜 없음) 닫힌다', !smsDayOpen({ canSendSms: true, date: null, today: TODAY }))

console.log('\n— 단계 일정 행')
check('1단계(점검일)는 방문이다', isSmsStepRow(step(1), true))
for (const n of [2, 3, 4, 5, 6]) {
  check(`★ ${n}단계는 방문이 아니다(서류 마감)`, !isSmsStepRow(step(n), true))
}
check('★ 끝난 1단계는 대상이 아니다', !isSmsStepRow(step(1, { stepStatus: 'completed' }), true))
check('★ 집계 칩(plan-group)은 대상이 아니다 — 고객이 하나가 아니다',
  !isSmsStepRow(step(1, { kind: 'plan-group' }), true))
check('고객을 모르는 행은 대상이 아니다(미리 체크할 키가 없다)',
  !isSmsStepRow({ kind: 'step', stepNum: 1, stepStatus: 'pending' }, true))
check('★ 날짜가 닫혀 있으면 1단계도 대상이 아니다', !isSmsStepRow(step(1), false))

console.log('\n— 계획 일정 행')
check('확정된 계획은 방문이다', isSmsPlanRow({ status: 'confirmed' }, true))
check('★ 끝난 계획은 대상이 아니다', !isSmsPlanRow({ status: 'completed' }, true))
check('★ 날짜가 닫혀 있으면 대상이 아니다', !isSmsPlanRow({ status: 'confirmed' }, false))

console.log(`\n합계 ${pass}/${pass + fail} · 실패 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
