/** 법정 이행기간(시행규칙 제23조**제5항**) 단위 검사 — 무서버·무DB.
 *  실행: npx tsx scripts/test-action-period-legal.mts
 *
 *  🚨 이 파일은 **폐지된 계약 둘을 고정하고 있었다** — 지우지 않고 갈아끼운다(그래야 다음 사람이
 *    「왜 바뀌었나」를 여기서 읽는다):
 *
 *    (가) 조문 번호 — 「제2항」으로 단언하고 있었다. 2026-09-08 법령 원문 대조로 완료기간 각 호는
 *        **제5항**임이 확인돼 제품(`action-period-legal.ts`)은 이미 고쳐졌고 배포까지 됐는데
 *        (`8f86076`), 이 검사만 낡아 붉은 채로 남아 있었다. → 제5항으로 정정.
 *
 *    (나) 셈법 — 「종료일 = 보고일 + n(양끝 포함 아님)」이었다. 2026-09-11 사용자 확정으로
 *        **시작일이 1일차(양끝 포함 N일)**가 됐다 → `종료 = 시작 + (N-1)`, 10일이면 +9·20일이면 +19.
 *        이건 새 규칙이 아니라 **기존 단계 마감일과 같은 셈법**이다(DB 트리거 111 `⑤ = ④ +9일`).
 *        종전 `+n`은 양끝 포함 11일을 만들어, 화면 라디오는 「10일」인데 문서에는 **「총 11일」**이
 *        인쇄되고 있었다(운영 실측 `2026-08-19 ~ 2026-08-29`, 저장 totalDays "10"). */
import {
  LEGAL_ACTION_PERIODS, addCalendarDays, legalActionRange, legalActionFields,
} from '../src/lib/action-period-legal'
import { manualActionPeriod } from '../src/lib/annex-total-period'
import { daysBetween } from '../src/lib/kst-date'

let pass = 0, fail = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}\n       got  ${g}\n       want ${w}`) }
}

console.log('[1] 조문 표 — 값이 10·20 둘뿐이고 순서가 조문 순서')
eq('일수 목록', LEGAL_ACTION_PERIODS.map(p => p.days), [10, 20])
eq('유형 목록', LEGAL_ACTION_PERIODS.map(p => p.label), ['수리·정비', '철거·교체'])
eq('근거 조문(제5항 — 제2항은 15일 보고 쪽이다)', LEGAL_ACTION_PERIODS.map(p => p.basis),
  ['시행규칙 제23조제5항제1호', '시행규칙 제23조제5항제2호'])

console.log('[2] 기간 채움 — 시작일이 1일차(양끝 포함)')
eq('10일 채움 → +9', legalActionFields('2026-08-05', 10),
  { totalPeriod: '2026-08-05 ~ 2026-08-14', totalDays: '10' })
eq('20일 채움 → +19', legalActionFields('2026-08-05', 20),
  { totalPeriod: '2026-08-05 ~ 2026-08-24', totalDays: '20' })

console.log('[3] 종료일 = 시작일 + (N-1) — 양끝 포함 N일')
eq('10일 종료일', legalActionRange('2026-08-05', 10)?.endISO, '2026-08-14')
eq('20일 종료일', legalActionRange('2026-08-05', 20)?.endISO, '2026-08-24')
eq('총 일수는 N 그대로', legalActionRange('2026-08-05', 10)?.days, 10)
/* 🚨 이 스위트의 **가장 중요한 단언** — 화면 라디오·저장값·인쇄값이 셋 다 같은 일수를 말하는가.
   종전에는 이 셋이 10/10/11로 갈라져 있었고, 어느 한 축만 보는 단언으로는 그걸 못 잡았다.
   `manualActionPeriod`는 인쇄 직전 기간을 **양끝 포함**으로 다시 세는 그 함수다. */
for (const n of [10, 20]) {
  const f = legalActionFields('2026-08-05', n)!
  const [s, e] = f.totalPeriod.split(' ~ ')
  eq(`${n}일 — 화면 span·저장 totalDays·인쇄 days가 모두 ${n}`,
    [daysBetween(s, e) + 1, Number(f.totalDays), manualActionPeriod({ totalPeriod: f.totalPeriod })?.days],
    [n, n, n])
}
/* 음성 대조 — 일수가 1 미만이면 종료<시작이 되므로 아예 계산하지 않는다 */
eq('0일은 null', legalActionRange('2026-08-05', 0), null)
eq('음수는 null', legalActionRange('2026-08-05', -5), null)

console.log('[4] 달·해 경계 — 로컬 TZ가 끼면 하루씩 어긋난다')
eq('월말 넘김', addCalendarDays('2026-08-25', 10), '2026-09-04')
eq('연말 넘김', addCalendarDays('2026-12-28', 20), '2027-01-17')
eq('윤년 2월', addCalendarDays('2028-02-20', 10), '2028-03-01')
eq('평년 2월', addCalendarDays('2026-02-20', 10), '2026-03-02')

console.log('[5] 영업일 보정을 하지 않는다 (조문에 단서 없음 — ⑤만 달력일)')
// 2026-08-05는 수요일 — 양끝 포함 10일이면 8/14(금)이다.
// ⚠ 이 자리는 **달력일 축**이다. ④(15영업일)·⑥(10영업일)과 상수를 돌려쓰지 말 것.
eq('공휴일·주말을 건너뛰지 않는다', legalActionRange('2026-08-05', 10)?.endISO, '2026-08-14')
// 20일이면 8/24(월) — 그 사이 8/15 광복절·주말 4일이 **그대로 포함**된다
eq('20일도 휴일 포함', legalActionRange('2026-08-05', 20)?.endISO, '2026-08-24')

console.log('[6] 기산일이 없거나 날짜꼴이 아니면 null — 조용히 오늘로 넘어가지 않는다')
eq('빈 문자열', legalActionRange('', 10), null)
eq('부분 입력', legalActionRange('2026-08', 10), null)
eq('한국어 날짜', legalActionRange('2026년 8월 5일', 10), null)
eq('필드 헬퍼도 null', legalActionFields('', 20), null)
eq('타임스탬프는 앞 10자만', legalActionRange('2026-08-05T12:00:00Z', 10)?.endISO, '2026-08-14')

console.log('[7] 기존 저장값은 재계산되지 않는다 — 이 변경이 과거 회차를 건드리지 않는 증거')
// 운영 실측값. 문자열로 저장돼 있어 `manualActionPeriod`가 그대로 읽는다(양끝 포함 11일).
// 🚨 여기가 11이라는 것이 곧 **종전 결함의 화석**이다 — 새로 고르면 10이 된다(위 [3]).
eq('운영에 남은 구 기간은 11일로 읽힌다', manualActionPeriod({ totalPeriod: '2026-08-19 ~ 2026-08-29' })?.days, 11)

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과 · 실패 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
