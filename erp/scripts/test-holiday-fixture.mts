/** 공휴일 산출 로직의 **대조군** — date-holidays 응답을 얼려 두고 우리 코드만 판정한다.
 *  소방계획서_25 R-6.
 *
 *  왜 필요한가: `test-holiday-rules.mts`는 살아 있는 라이브러리 산출물을 API 정답과 대조한다.
 *  좋은 검사지만 **원인을 못 가른다** — date-holidays가 음력 계산을 바꾸면 설·추석이 통째로
 *  틀어지고 그 검사가 빨개지는데, 우리 코드가 깨진 것인지 라이브러리가 움직인 것인지 알 수 없다.
 *  입력을 얼려 두면 그 두 가지가 갈라진다:
 *
 *    이 검사 초록 + test-holiday-rules 빨강  →  **라이브러리가 움직였다**(우리 코드 무죄)
 *    이 검사 빨강                             →  **우리 코드가 깨졌다**
 *
 *  기대값의 출처: 코드 출력이 아니라 **공공데이터포털 특일 정보 API**(2026-09-08 실측)다.
 *  코드가 뱉은 값을 그대로 얼리면 "픽스처에 답을 박은 검사"가 되어, 로직이 틀린 채로도
 *  영원히 초록이 된다. 2026년치는 test-holiday-rules.mts의 수기 정답표(FALLBACK_EXPECT)와도
 *  교차 확인했다 — 지방선거 1건(EXCLUDED) 외에 완전히 일치한다.
 *
 *  EXCLUDED: 임시공휴일·선거일은 date-holidays가 **원리상 못 잡는** 범주(제2조 제10의2·11호)라
 *  기대값에서 뺀다. 그 범주는 수동 등록(source='manual')이 담당한다.
 *
 *  무DB·무서버·무네트워크. 실행:
 *    npx tsx --conditions=react-server scripts/test-holiday-fixture.mts */
import { resolveLibraryHolidaysFromRaw, normalizeLibraryHolidays, type LibRawHoliday } from '../src/lib/holidays'

/** date-holidays v3 KR public 응답 원문 (2026-09-08 채취 · type='public'만) */
const RAW: Record<number, LibRawHoliday[]> = {
  2026: [
    { name: '신정', type: 'public', date: '2026-01-01', start: '2025-12-31T15:00:00.000Z', end: '2026-01-01T15:00:00.000Z', rule: '01-01' },
    { name: '설날', type: 'public', date: '2026-02-17', start: '2026-02-16T15:00:00.000Z', end: '2026-02-19T15:00:00.000Z', rule: 'korean 01-0-01 P3D' },
    { name: '3·1절', type: 'public', date: '2026-03-01', start: '2026-02-28T15:00:00.000Z', end: '2026-03-01T15:00:00.000Z', rule: '03-01' },
    { name: '어린이날', type: 'public', date: '2026-05-05', start: '2026-05-04T15:00:00.000Z', end: '2026-05-05T15:00:00.000Z', rule: '05-05' },
    { name: '석가탄신일', type: 'public', date: '2026-05-24', start: '2026-05-23T15:00:00.000Z', end: '2026-05-24T15:00:00.000Z', rule: 'korean 4-0-8' },
    { name: '현충일', type: 'public', date: '2026-06-06', start: '2026-06-05T15:00:00.000Z', end: '2026-06-06T15:00:00.000Z', rule: '06-06' },
    { name: '제헌절', type: 'public', date: '2026-07-17', start: '2026-07-16T15:00:00.000Z', end: '2026-07-17T15:00:00.000Z', rule: '07-17 since 2026' },
    { name: '광복절', type: 'public', date: '2026-08-15', start: '2026-08-14T15:00:00.000Z', end: '2026-08-15T15:00:00.000Z', rule: '08-15' },
    { name: '추석', type: 'public', date: '2026-09-24', start: '2026-09-23T15:00:00.000Z', end: '2026-09-26T15:00:00.000Z', rule: 'korean 8-0-14 P3D' },
    { name: '개천절', type: 'public', date: '2026-10-03', start: '2026-10-02T15:00:00.000Z', end: '2026-10-03T15:00:00.000Z', rule: '10-03' },
    { name: '한글날', type: 'public', date: '2026-10-09', start: '2026-10-08T15:00:00.000Z', end: '2026-10-09T15:00:00.000Z', rule: '10-09' },
    { name: '기독탄신일', type: 'public', date: '2026-12-25', start: '2026-12-24T15:00:00.000Z', end: '2026-12-25T15:00:00.000Z', rule: '12-25' },
  ],
  2027: [
    { name: '신정', type: 'public', date: '2027-01-01', start: '2026-12-31T15:00:00.000Z', end: '2027-01-01T15:00:00.000Z', rule: '01-01' },
    { name: '설날', type: 'public', date: '2027-02-07', start: '2027-02-06T15:00:00.000Z', end: '2027-02-09T15:00:00.000Z', rule: 'korean 01-0-01 P3D' },
    { name: '3·1절', type: 'public', date: '2027-03-01', start: '2027-02-28T15:00:00.000Z', end: '2027-03-01T15:00:00.000Z', rule: '03-01' },
    { name: '어린이날', type: 'public', date: '2027-05-05', start: '2027-05-04T15:00:00.000Z', end: '2027-05-05T15:00:00.000Z', rule: '05-05' },
    { name: '석가탄신일', type: 'public', date: '2027-05-13', start: '2027-05-12T15:00:00.000Z', end: '2027-05-13T15:00:00.000Z', rule: 'korean 4-0-8' },
    { name: '현충일', type: 'public', date: '2027-06-06', start: '2027-06-05T15:00:00.000Z', end: '2027-06-06T15:00:00.000Z', rule: '06-06' },
    { name: '제헌절', type: 'public', date: '2027-07-17', start: '2027-07-16T15:00:00.000Z', end: '2027-07-17T15:00:00.000Z', rule: '07-17 since 2026' },
    { name: '광복절', type: 'public', date: '2027-08-15', start: '2027-08-14T15:00:00.000Z', end: '2027-08-15T15:00:00.000Z', rule: '08-15' },
    { name: '추석', type: 'public', date: '2027-09-14', start: '2027-09-13T15:00:00.000Z', end: '2027-09-16T15:00:00.000Z', rule: 'korean 8-0-14 P3D' },
    { name: '개천절', type: 'public', date: '2027-10-03', start: '2027-10-02T15:00:00.000Z', end: '2027-10-03T15:00:00.000Z', rule: '10-03' },
    { name: '한글날', type: 'public', date: '2027-10-09', start: '2027-10-08T15:00:00.000Z', end: '2027-10-09T15:00:00.000Z', rule: '10-09' },
    { name: '기독탄신일', type: 'public', date: '2027-12-25', start: '2027-12-24T15:00:00.000Z', end: '2027-12-25T15:00:00.000Z', rule: '12-25' },
  ],
}

/** 특일 정보 API 실측(2026-09-08)에서 EXCLUDED를 뺀 것 — **코드 출력이 아니다** */
const EXPECT: Record<number, string[]> = {
  2026: ['2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02',
         '2026-05-01', '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-06', '2026-07-17',
         '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03',
         '2026-10-05', '2026-10-09', '2026-12-25'],
  2027: ['2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-03-01',
         '2027-05-01', '2027-05-03', '2027-05-05', '2027-05-13', '2027-06-06', '2027-07-17',
         '2027-07-19', '2027-08-15', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16',
         '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11', '2027-12-25', '2027-12-27'],
}

/** 라이브러리가 원리상 못 잡는 범주 — 기대값에서 뺀 날 */
const EXCLUDED: Record<number, string[]> = {
  2026: ['2026-06-03'],   // 제9회 전국동시지방선거 (제2조 제10의2호)
  2027: [],
}

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? `\n     ${d}` : ''}`) }
}

for (const year of [2026, 2027]) {
  console.log(`\n===== ${year}년 (얼린 입력) =====`)
  const got = resolveLibraryHolidaysFromRaw(RAW[year], year).map(h => h.date).sort()
  const want = EXPECT[year]

  const extra = got.filter(d => !want.includes(d))
  const missing = want.filter(d => !got.includes(d))
  check(`${year} 과다 0건`, extra.length === 0, `과다: ${extra.join(' ')}`)
  check(`${year} 누락 0건`, missing.length === 0, `누락: ${missing.join(' ')}`)
  check(`${year} 선거일·임시공휴일은 산출하지 않는다(${EXCLUDED[year].length}건)`,
    EXCLUDED[year].every(d => !got.includes(d)),
    `라이브러리 경로가 잡을 수 없는 날을 만들어냈다: ${EXCLUDED[year].filter(d => got.includes(d)).join(' ')}`)
}

/* ── 개별 규칙 — 합계가 맞아도 개별 규칙이 서로 상쇄돼 맞을 수 있다 ── */
console.log('\n===== 개별 규칙 =====')

// ① 설날 전날 보정: 라이브러리 rule은 당일부터 3일(P3D)이지만 한국법은 **전날부터** 3일이다.
//    보정이 빠지면 하루씩 밀려 설 연휴 마지막 날이 근무일로 잡힌다.
const b26 = normalizeLibraryHolidays(RAW[2026], 2026).map(b => b.date)
check('2026 설날 = 02-16·17·18 (전날 보정)',
  ['2026-02-16', '2026-02-17', '2026-02-18'].every(d => b26.includes(d)) && !b26.includes('2026-02-19'),
  `실제: ${b26.filter(d => d.startsWith('2026-02')).join(' ')}`)

// ② 노동절 주입 — 라이브러리 원문에 아예 없다(위 RAW를 보면 5월 항목은 어린이날·석가탄신일뿐).
check('2026-05-01 노동절 주입 (라이브러리 원문에 없다)',
  b26.includes('2026-05-01') && !RAW[2026].some(r => r.name.includes('노동')),
  '라이브러리가 노동절을 주기 시작했다면 이 주입은 중복이 된다 — 규칙을 재검토할 것')

// ③ 겹침 보존 — 같은 날 2건을 버리면 제3조①3호(대체공휴일) 판정의 전제가 깨진다
const b27base = normalizeLibraryHolidays(RAW[2027], 2027)
check('겹침을 버리지 않고 합친다(mergeByDate)',
  b27base.every(b => Array.isArray(b.names) && b.names.length >= 1),
  'names가 배열이 아니면 겹친 이름이 소실된 것')

// ④ 반대 방향 — 빈 입력에 노동절만 만들어내는지(주입이 무조건 실행되면 안 되는 해가 있는가)
const empty = normalizeLibraryHolidays([], 2026).map(b => b.date)
check('빈 입력이면 노동절 1건만 (다른 날을 지어내지 않는다)',
  empty.length === 1 && empty[0] === '2026-05-01',
  `실제: ${empty.join(' ')}`)

console.log(`\n합계 ${pass}/${pass + fail} · 실패 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
