// 6단계 법정 마감일 산식 — 순수 함수 회귀 (2026-09-21 신설)
//
// 왜 생겼나: 이 산식에 **총 이행기간(10·20일)이 하드코딩**돼 있었다(⑤ = ④ + 9). 시행규칙
// 제23조제5항의 기간은 사람이 10일(수리·정비) / 20일(철거·교체) 중 고르는데, 20일을 골라도
// ⑤ 마감이 10일 기준으로 남고 ⑥(=⑤+10영업일)까지 함께 열흘 당겨졌다.
// DB도 화면도 아무 말을 하지 않았다 — 순수 함수라 **표본만 있으면 서버 없이 잡힌다**.
//
// ⭐ 기준 표본은 **운영 하늘촌 2026-1**이다(사용자 지정: 「정확하게 일치하는 산식 로직」).
//    실값으로 고정해 두면 산식을 건드릴 때 이 검사가 먼저 붉어진다.
//
// 실행: npx tsx scripts/test-step-dates.mts   (서버·DB 불필요)
import { computeStepDates } from '../src/lib/plan-step-dates'
import { DEFAULT_ACTION_PERIOD_DAYS, LEGAL_ACTION_PERIODS } from '../src/lib/action-period-legal'

let pass = 0, fail = 0
function check(name: string, ok: boolean, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? `\n       ${extra}` : ''}`) }
}

/** 운영 하늘촌 2026-1 회차의 실제 공휴일 구간(2026-09 ~ 2026-12, 운영 DB 실측) */
const HOLIDAYS = new Set([
  '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
])

console.log('── ① 운영 하늘촌 2026-1 (확정 2026-09-18 · 총 10일) ─────────────────')
{
  // 운영 inspection_steps 실값 (2026-09-21 조회)
  const EXPECTED = ['2026-09-18', '2026-09-29', '2026-10-07', '2026-10-15', '2026-10-24', '2026-11-06']
  const got = computeStepDates('2026-09-18', HOLIDAYS, 10)
  for (let i = 0; i < 6; i++) {
    check(`${i + 1}단계 = ${EXPECTED[i]}`, got[i] === EXPECTED[i], `실제 ${got[i]}`)
  }
  check('★ 기본값(인자 생략)도 같은 결과 — 법정 기본은 10일',
    JSON.stringify(computeStepDates('2026-09-18', HOLIDAYS)) === JSON.stringify(got))
}

console.log('\n── ② 총 이행기간 20일 — ⑤⑥이 함께 밀린다 ───────────────────────')
{
  const d10 = computeStepDates('2026-09-18', HOLIDAYS, 10)
  const d20 = computeStepDates('2026-09-18', HOLIDAYS, 20)
  check('①~④는 총일수와 무관하다(영업일 축)',
    d10.slice(0, 4).join() === d20.slice(0, 4).join(), `${d10.slice(0, 4)} vs ${d20.slice(0, 4)}`)
  // ⑤는 ④ 당일을 1일째로 세는 **달력일** — 10일이면 +9, 20일이면 +19
  const gap = (a: string, b: string) => Math.round((+new Date(b) - +new Date(a)) / 86400000)
  check('★ ⑤ 10일 → ④+9일', gap(d10[3], d10[4]) === 9, `실제 ${gap(d10[3], d10[4])}일`)
  check('★ ⑤ 20일 → ④+19일 (종전 결함: 10일 고정이라 9일이었다)',
    gap(d20[3], d20[4]) === 19, `실제 ${gap(d20[3], d20[4])}일`)
  check('★ ⑥도 함께 밀린다(⑤+10영업일)', d20[5] > d10[5], `10일=${d10[5]} 20일=${d20[5]}`)
}

console.log('\n── ③ 축이 섞이지 않았는가 ─────────────────────────────────────')
{
  // ⑤는 달력일이라 **주말·공휴일을 건너뛰지 않는다** — 건너뛰면 영업일 축과 섞인 것이다.
  // 확정 2026-09-18 기준 ④=10-15(목), +9일 = 10-24(토). 토요일 그대로여야 한다.
  const d = computeStepDates('2026-09-18', HOLIDAYS, 10)
  check('⑤는 달력일 — 토요일에 떨어져도 밀지 않는다',
    d[4] === '2026-10-24' && new Date(d[4]).getDay() === 6, `${d[4]} (요일 ${new Date(d[4]).getDay()})`)
  // ②③④⑥은 영업일이라 주말·공휴일에 떨어질 수 없다
  for (const i of [1, 2, 3, 5]) {
    const dow = new Date(d[i]).getDay()
    check(`${i + 1}단계는 영업일에 떨어진다`, dow !== 0 && dow !== 6 && !HOLIDAYS.has(d[i]), `${d[i]} 요일 ${dow}`)
  }
}

console.log('\n── ④ 법정 목록과 기본값 ───────────────────────────────────────')
{
  check('법정 선택지는 10·20일 두 가지',
    LEGAL_ACTION_PERIODS.map(p => p.days).join() === '10,20',
    JSON.stringify(LEGAL_ACTION_PERIODS.map(p => p.days)))
  check('기본값은 10일', DEFAULT_ACTION_PERIOD_DAYS === 10, String(DEFAULT_ACTION_PERIOD_DAYS))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
