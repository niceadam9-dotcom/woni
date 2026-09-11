/** 별지 9호·11호 제출 기한 산식 — `lib/annex-due` (2026-09-09)
 *
 *  실행: npx tsx scripts/test-annex-due.mts
 *
 *  이 검사가 고정하는 것 두 가지:
 *   ① ④⑥ 기한은 **영업일**이다(주말·공휴일을 건너뛴다)
 *   ② ⑥ 기한은 이행기간 종료일 **+ 10영업일**이다 — 종료일 당일이 아니다
 *
 *  🚨 두 결함이 모두 「화면 안에 인라인이라 검사가 닿지 않던」 자리에서 나왔다.
 *    그래서 **음성 대조**를 반드시 함께 둔다 — 고치기 전 값(달력일 답·종료일 그 자체)이
 *    나오면 실패해야 한다. 안 그러면 되돌려도 초록으로 남는다.
 */
import {
  report9DueISO, report11DueISO, repairEndISO, REPORT9_WORKING_DAYS,
} from '../src/lib/annex-due.ts'
import { COMPLETION_REPORT_WORKING_DAYS } from '../src/lib/action-period-legal.ts'
import { extensionRequestDue, addCalendarDays } from '../src/lib/action-period-legal.ts'

let pass = 0, fail = 0
function ok(cond: boolean, label: string, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

/* 2026년 실제 공휴일 일부 — 광복절(8/15, 토) 대체공휴일 8/17(월)이 낀 구간을 일부러 고른다.
 * 주말만 건너뛰는 계산과 **공휴일까지 건너뛰는 계산**이 다른 답을 내야 이 축이 살아 있다. */
const HOLIDAYS = new Set(['2026-08-17', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-09'])
const NONE: Set<string> = new Set()

console.log('── A. 영업일인가 (달력일 답과 달라야 한다) ──')
{
  // 2026-07-28(화) + 15영업일. 달력일이면 2026-08-12.
  const end = '2026-07-28'
  const d9 = report9DueISO(end, NONE)
  ok(d9 === '2026-08-18', `④ 점검종료 ${end} + ${REPORT9_WORKING_DAYS}영업일`, String(d9))
  // 🚨 음성 대조 — 종전 산식(달력일 15일)이면 08-12다. 그 값이 나오면 되돌아간 것이다
  ok(d9 !== addCalendarDays(end, 15), '(음성) 달력일 15일 답이 아니다', `달력일=${addCalendarDays(end, 15)}`)

  // 공휴일이 계산에 실제로 쓰이는가 — 같은 기산일, 공휴일 표만 바꿔 두 답이 갈라져야 한다
  const withHol = report9DueISO('2026-08-03', HOLIDAYS)
  const without = report9DueISO('2026-08-03', NONE)
  ok(withHol !== without, '공휴일 표가 답을 바꾼다(8/17 대체공휴일)', `표있음=${withHol} · 표없음=${without}`)
  ok(withHol === '2026-08-25' && without === '2026-08-24', '공휴일 1일만큼 밀린다', `${without} → ${withHol}`)
}

console.log('\n── B. ⑥ 이행완료 보고 기한 = 이행기간 종료일 + 10영업일 ──')
{
  const repairEnd = '2026-08-14'   // 금
  const d11 = report11DueISO(repairEnd, NONE)
  ok(d11 === '2026-08-28', `이행기간 종료 ${repairEnd} + ${COMPLETION_REPORT_WORKING_DAYS}영업일`, String(d11))
  // 🚨🚨 음성 대조 — 종전에는 **종료일 그 자체**가 기한이었다(+10일이 통째로 없었다)
  ok(d11 !== repairEnd, '(음성) 이행기간 종료일 당일이 아니다', `종료일=${repairEnd} · 기한=${d11}`)
  ok(d11 !== addCalendarDays(repairEnd, 10), '(음성) 달력일 10일 답도 아니다', `달력일=${addCalendarDays(repairEnd, 10)}`)
  // ④보다 ⑥이 늦다 — 순서가 뒤집히면 업무 흐름이 거꾸로 읽힌다
  const d9 = report9DueISO('2026-07-28', NONE)
  ok(!!d9 && !!d11 && d11 > d9, '⑥ 기한이 ④ 기한보다 늦다', `${d9} → ${d11}`)
}

console.log('\n── C. 기산점 — 총 이행기간이 정본, action_end는 폴백 ──')
{
  // 두 축에 **다른 날짜**를 넣는다. 같으면 어느 쪽을 읽어도 초록이라 규칙을 못 고정한다
  ok(repairEndISO({ totalPeriod: '2026-08-05 ~ 2026-08-15', actionEnds: ['2026-09-30'] }) === '2026-08-15',
    '총 이행기간이 있으면 그 종료일이 이긴다')
  ok(repairEndISO({ totalPeriod: '', actionEnds: ['2026-08-01', '2026-09-30', '2026-08-20'] }) === '2026-09-30',
    '총 이행기간이 없으면 action_end 최댓값')
  ok(repairEndISO({ totalPeriod: '   ', actionEnds: [null, undefined, ''] }) === '',
    '둘 다 없으면 빈 값')
  // 과거 자유 텍스트가 섞여 있어도 날짜 산술로 새지 않는다
  ok(repairEndISO({ totalPeriod: '8월 중 ~ 미정', actionEnds: ['2026-08-20'] }) === '2026-08-20',
    '자유 텍스트 기간은 무시하고 폴백으로 간다')
}

console.log('\n── D. 불량 0건 = ⑥ 해당없음 (기한을 지어내지 않는다) ──')
{
  const repairEnd = repairEndISO({ totalPeriod: '', actionEnds: [] })
  ok(repairEnd === '', '기산점이 없다')
  ok(report11DueISO(repairEnd, NONE) === null, '⑥ 기한은 null — 없는 날짜를 만들지 않는다')
  ok(report9DueISO('', NONE) === null && report9DueISO(null, NONE) === null,
    '점검 종료일이 없으면 ④ 기한도 null')
  ok(report11DueISO('아무말', NONE) === null, '날짜가 아닌 글자는 계산하지 않는다')
  // 🚨 모양만 맞고 **실재하지 않는** 날짜 — JS Date가 조용히 다음 해로 굴려 가짜 기한을 만든다
  ok(report9DueISO('2026-13-99', NONE) === null, '13월 99일을 굴리지 않는다')
  ok(report9DueISO('2026-02-30', NONE) === null, '2월 30일을 굴리지 않는다')
  ok(report9DueISO('2026-02-28', NONE) !== null, '(대조군) 실재하는 날짜는 계산한다')
}

console.log('\n── E. 연기 신청 마감 = 만료일 3일 전 (달력일) ──')
{
  ok(extensionRequestDue('2026-08-15') === '2026-08-12', '만료 8/15 → 신청 8/12')
  ok(extensionRequestDue('2026-03-02') === '2026-02-27', '월 넘김', String(extensionRequestDue('2026-03-02')))
  ok(extensionRequestDue('') === null && extensionRequestDue(null) === null, '기간이 없으면 null')
  // 달력일이다 — 주말이 껴도 밀리지 않는다(8/12은 수)
  ok(extensionRequestDue('2026-08-17') === '2026-08-14', '주말을 건너뛰지 않는다(달력일)')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
