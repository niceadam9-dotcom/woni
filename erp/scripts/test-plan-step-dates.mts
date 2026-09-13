/** 자체점검 6단계 법정 마감일 산식 — **순수·무서버·무DB**
 *  실행: npx tsx scripts/test-plan-step-dates.mts
 *
 *  왜 이 검사가 있나 —
 *  산식이 `confirmPlanItemStageOneAction`(plan-date-actions.ts) 안에 인라인으로만 있어서
 *  `'use server'` 밖에서는 부를 수도, 단언할 수도 없었다. 당일 자동 시작 크론이 특별점검을
 *  제외하고 있던 이유가 그것이고, 점검확정 폐지로 그 제외가 **구멍**이 됐다(신규 특별점검을
 *  아무도 시작하지 않는다). 산식을 lib/plan-step-dates.ts로 올리면서 이 검사를 함께 만든다.
 *
 *  가장 중요한 단언은 **추출이 동작을 바꾸지 않았다**는 것이다. 그래서 리팩터 이전 인라인
 *  구현을 아래에 **그대로 복사해 두고**(LEGACY) 두 구현을 넓은 날짜·공휴일 조합에서 대조한다.
 *  기대값을 손으로 베껴 적으면 "내가 옮겨 적은 것"을 검사하게 되지, 옮기기 전 코드를 검사하지 않는다.
 */
import { computeStepDates, isSixStepPlanType } from '../src/lib/plan-step-dates.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${n}${ok || !d ? '' : ` — ${d}`}`) }

// ── 리팩터 이전 plan-date-actions.ts:77-116의 계산부 **원문 복사** (대조군) ────────────────
function LEGACY(confirmedDate: string, holidaySet: Set<string>): string[] {
  function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  function addWorkingDays(from: Date, n: number): string {
    const d = new Date(from)
    let count = 0
    while (count < n) {
      d.setDate(d.getDate() + 1)
      const dow = d.getDay()
      if (dow !== 0 && dow !== 6 && !holidaySet.has(toDateStr(d))) count++
    }
    return toDateStr(d)
  }
  const step1 = confirmedDate
  const step2 = addWorkingDays(new Date(step1), 5)
  const step3 = addWorkingDays(new Date(step1), 10)
  const step4 = addWorkingDays(new Date(step1), 15)
  const step4Date = new Date(step4); step4Date.setDate(step4Date.getDate() + 9)
  const step5 = toDateStr(step4Date)
  const step6 = addWorkingDays(new Date(step5), 10)
  return [step1, step2, step3, step4, step5, step6]
}

const NONE = new Set<string>()
// 실제 공휴일 표에 가까운 표본 — 연휴가 겹치는 구간을 일부러 포함한다
const HOLIDAYS = new Set([
  '2026-01-01', '2026-03-01', '2026-05-05', '2026-06-06', '2026-07-17',
  '2026-08-15', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03',
  '2026-10-09', '2026-12-25', '2027-01-01', '2027-02-16', '2027-02-17',
])

console.log('— 추출 전후가 같은 값을 낸다 (대조군: 리팩터 이전 원문)')
{
  let compared = 0, diff: string[] = []
  for (const holidays of [NONE, HOLIDAYS]) {
    // 2026-01-01 ~ 2026-12-31 전 날짜
    const d = new Date('2026-01-01')
    while (d.getFullYear() === 2026) {
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      const a = computeStepDates(iso, holidays).join('|')
      const b = LEGACY(iso, holidays).join('|')
      compared++
      if (a !== b && diff.length < 5) diff.push(`${iso}: new=${a} legacy=${b}`)
      d.setDate(d.getDate() + 1)
    }
  }
  check(`전 날짜 대조 ${compared}건이 원문과 일치`, diff.length === 0, diff.join(' / '))
  // 공허 통과 방지 — 위 루프가 실제로 돌았는가
  check('대조가 실제로 수행됐다(공허 아님)', compared === 730, String(compared))
  // 대조군이 변별력이 있는가 — 공휴일을 넣으면 값이 달라져야 한다
  const withNone = computeStepDates('2026-07-15', NONE).join('|')
  const withHol = computeStepDates('2026-07-15', HOLIDAYS).join('|')
  check('[대조군] 공휴일 표가 결과를 실제로 바꾼다', withNone !== withHol, `${withNone} vs ${withHol}`)
}

console.log('\n— 문서화된 사용자 확정 사례 (2026-07-09: step4 08-18 → step5 08-27)')
{
  // step5는 step4 **당일을 1일째로 포함한 절대일 10일째** = +9일(주말·공휴일 포함).
  // 이 규칙만 영업일이 아니다 — 헷갈리기 쉬워 사례로 못박는다.
  const [, , , step4, step5] = computeStepDates('2026-07-28', HOLIDAYS)
  const s4 = new Date(step4), s5 = new Date(step5)
  const gap = Math.round((s5.getTime() - s4.getTime()) / 86400000)
  check('step5 − step4 = 정확히 9일(절대일)', gap === 9, `${step4} → ${step5} (${gap}일)`)
  const s5dow = s5.getDay()
  check('step5는 주말에 떨어질 수 있다(영업일 축이 아니다) — 규칙 확인용',
    gap === 9, `${step5} dow=${s5dow}`)
}

console.log('\n— 영업일 축: 주말·공휴일을 건너뛴다')
{
  // 2026-07-15(수) 기준. 공휴일 없음일 때 +5 영업일 = 07-22(수)
  const [s1, s2, s3, s4] = computeStepDates('2026-07-15', NONE)
  check('step1 = 확정일 그대로', s1 === '2026-07-15', s1)
  check('+5 영업일 = 2026-07-22', s2 === '2026-07-22', s2)
  check('+10 영업일 = 2026-07-29', s3 === '2026-07-29', s3)
  check('+15 영업일 = 2026-08-05', s4 === '2026-08-05', s4)

  // 같은 기준일에 07-17(제헌절)을 공휴일로 넣으면 전부 하루씩 밀린다
  const [, h2, h3, h4] = computeStepDates('2026-07-15', new Set(['2026-07-17']))
  check('공휴일 1건이 2·3·4단계를 하루씩 민다',
    h2 === '2026-07-23' && h3 === '2026-07-30' && h4 === '2026-08-06', `${h2}/${h3}/${h4}`)

  // 어떤 결과도 주말에 떨어지지 않는다(step5 제외 — 그건 절대일 축)
  let weekendHits = 0
  const d = new Date('2026-01-01')
  while (d.getFullYear() === 2026) {
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const [, a, b, c, , f] = computeStepDates(iso, HOLIDAYS)
    for (const s of [a, b, c, f]) {
      const dow = new Date(s).getDay()
      if (dow === 0 || dow === 6) weekendHits++
    }
    d.setDate(d.getDate() + 1)
  }
  check('2·3·4·6단계는 한 해 전 날짜에서 단 한 번도 주말에 안 떨어진다', weekendHits === 0, `${weekendHits}건`)

  let holidayHits = 0
  const d2 = new Date('2026-01-01')
  while (d2.getFullYear() === 2026) {
    const iso = `${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,'0')}-${String(d2.getDate()).padStart(2,'0')}`
    const [, a, b, c, , f] = computeStepDates(iso, HOLIDAYS)
    for (const s of [a, b, c, f]) if (HOLIDAYS.has(s)) holidayHits++
    d2.setDate(d2.getDate() + 1)
  }
  check('2·3·4·6단계는 공휴일에도 안 떨어진다', holidayHits === 0, `${holidayHits}건`)
}

console.log('\n— 순서: 1 ≤ 2 < 3 < 4 < 5 < 6')
{
  let bad: string[] = []
  const d = new Date('2026-01-01')
  while (d.getFullYear() === 2026) {
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const s = computeStepDates(iso, HOLIDAYS)
    if (!(s[0] <= s[1] && s[1] < s[2] && s[2] < s[3] && s[3] < s[4] && s[4] < s[5]) && bad.length < 3) bad.push(`${iso}: ${s.join('|')}`)
    d.setDate(d.getDate() + 1)
  }
  check('한 해 전 날짜에서 단조 증가가 깨지지 않는다', bad.length === 0, bad.join(' / '))
}

console.log('\n— 6단계 대상 판정 (누가 이 산식을 받는가)')
{
  check('special_종합 = 6단계', isSixStepPlanType('special_종합'))
  check('special_작동 = 6단계', isSixStepPlanType('special_작동'))
  // 일반관리는 plan_type이 null인데 6단계 대상이다 (소방계획서_6 W-10 · migration 111 트리거와 동일 분기)
  check('null(일반관리) = 6단계', isSixStepPlanType(null))
  check('undefined도 null과 같게 다룬다', isSixStepPlanType(undefined))
  // 음성 짝 — 이게 없으면 "늘 참"인 함수도 위 넷을 통과한다
  check('monthly는 6단계가 아니다(1단계형)', !isSixStepPlanType('monthly'))
  check('event(레거시)는 6단계가 아니다', !isSixStepPlanType('event'))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
