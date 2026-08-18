/** 공휴일 대체 규칙 검증 (소방계획서_25 S-9) — 서버·DB 불필요.
 *
 *  정답의 원천은 **공공데이터포털 특일 정보 API**(확정 공휴일)다. 그 응답을 기준으로
 *  A안(date-holidays + 제3조 산출)이 과다·누락 없이 같은 값을 내는지 본다.
 *  키가 없거나 API가 막히면 아래 FALLBACK_EXPECT(수기 정답표)로 대조한다 —
 *  네트워크 없이도 회귀가 돌아야 하기 때문이다.
 *
 *  ⚠ A안은 임시공휴일·선거일(제2조 제10의2·11호)을 **원리상 못 잡는다**. 그 범주는
 *     비교에서 제외하고(EXCLUDED), 수동 등록(C안)이 담당한다.
 *
 *  실행: npx tsx scripts/test-holiday-rules.mts
 */
import { config } from 'dotenv'
import { fetchHolidaysFromOpenApi, fetchHolidaysFromLibrary } from '../src/lib/holidays'

config({ path: '.env.local', quiet: true })

const YEARS = [2024, 2025, 2026, 2027, 2028]

/** A안이 원리상 못 잡는 날 — 임시공휴일·선거일. 비교에서 뺀다(누락으로 세지 않는다) */
const EXCLUDED = new Set([
  '2024-04-10', // 제22대 국회의원선거
  '2024-10-01', // 국군의 날 임시공휴일
  '2025-01-27', // 임시공휴일
  '2025-06-03', // 제21대 대통령선거
  '2026-06-03', // 제9회 전국동시지방선거
  '2028-04-12', // 제23대 국회의원선거 (API가 이미 알고 있다 — A안은 못 잡는다)
])

/** API를 못 쓸 때 쓰는 수기 정답표 — 위 EXCLUDED를 제외한 날짜만 */
const FALLBACK_EXPECT: Record<number, string[]> = {
  2025: ['2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-01', '2025-03-03',
         '2025-05-05', '2025-05-06', '2025-06-06', '2025-08-15', '2025-10-03', '2025-10-05',
         '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09', '2025-12-25'],
  2026: ['2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02',
         '2026-05-01', '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-06', '2026-07-17',
         '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03',
         '2026-10-05', '2026-10-09', '2026-12-25'],
}

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`) } }

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const dow = (iso: string) => DOW[new Date(iso + 'T00:00:00').getDay()]

for (const year of YEARS) {
  console.log(`\n===== ${year}년 =====`)

  const lib = await fetchHolidaysFromLibrary(year)
  if (!lib.ok) { check(`${year} 라이브러리 산출`, false, lib.ok === false && 'error' in lib ? lib.error : ''); continue }
  const got = new Set(lib.holidays.map(h => h.date))

  // 정답 확보 — API 우선, 실패 시 수기표
  const api = await fetchHolidaysFromOpenApi(year)
  let expect: Set<string>
  let origin: string
  if (api.ok) {
    expect = new Set(api.holidays.map(h => h.date).filter(d => !EXCLUDED.has(d)))
    origin = 'API'
  } else if (FALLBACK_EXPECT[year]) {
    expect = new Set(FALLBACK_EXPECT[year])
    origin = '수기표'
  } else {
    console.log(`  ⏭  ${year} 건너뜀 — API 사용 불가이고 수기 정답표도 없음`)
    continue
  }

  const extra = [...got].filter(d => !expect.has(d) && !EXCLUDED.has(d)).sort()
  const missing = [...expect].filter(d => !got.has(d)).sort()

  check(`${year} 과다 0건 (기준: ${origin})`, extra.length === 0,
    extra.map(d => `${d}(${dow(d)})`).join(' '))
  check(`${year} 누락 0건 (기준: ${origin})`, missing.length === 0,
    missing.map(d => `${d}(${dow(d)})`).join(' '))
}

/* ── 회귀 고정: 이번 차수가 고친 개별 사례 ── */
console.log('\n===== 개별 회귀 =====')
const y2025 = await fetchHolidaysFromLibrary(2025)
if (y2025.ok) {
  const byDate = new Map(y2025.holidays.map(h => [h.date, h.name]))
  check('2025-05-05 겹침 보존(어린이날·부처님오신날)',
    (byDate.get('2025-05-05') ?? '').includes('어린이날') && /석가|부처/.test(byDate.get('2025-05-05') ?? ''),
    byDate.get('2025-05-05') ?? '없음')
  check('2025-05-06 대체공휴일 생성(제3조①3호)', byDate.has('2025-05-06'), '미생성')
}
const y2026 = await fetchHolidaysFromLibrary(2026)
if (y2026.ok) {
  const s = new Set(y2026.holidays.map(h => h.date))
  check('2026-05-01 노동절 포함', s.has('2026-05-01'), '누락')
  check('2026-06-08 현충일 대체 없음(제8호 비대상)', !s.has('2026-06-08'), '과다 생성됨')
  check('2026-09-28 추석 대체 없음(토요일 겹침)', !s.has('2026-09-28'), '과다 생성됨')
  check('2026-08-17 광복절 대체 있음', s.has('2026-08-17'), '누락')
}
const y2027 = await fetchHolidaysFromLibrary(2027)
if (y2027.ok) {
  const s = new Set(y2027.holidays.map(h => h.date))
  check('2027-02-09 설날 대체 1건만', s.has('2027-02-09') && !s.has('2027-02-10'),
    s.has('2027-02-10') ? '2027-02-10 중복 생성' : '2027-02-09 누락')
  check('2027-05-03 노동절 대체 있음', s.has('2027-05-03'), '누락')
  check('2027-07-19 제헌절 대체 있음', s.has('2027-07-19'), '누락')
  check('2027-06-07 현충일 대체 없음', !s.has('2027-06-07'), '과다 생성됨')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
