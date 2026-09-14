// 자체점검 2차(작동)가 **해를 넘긴다** — 1차보다 앞서는 고아 슬롯 폐지 (2026-09-14)
//
// 신고: 지평리56의 「작동(자체) 2026년 2차 03-26」이 「예정 지연 172일 ⚠」로 떠 있다.
// 파 보니 데이터 오류가 아니라 **규칙이 만든 값**이었다 — 종전 산식 `((m-1+6)%12)+1`이
// 감긴 달을 **같은 해에** 두어, 기산월 9인 고객의 2차가 1차(09-28)보다 6개월 **앞선** 3월에 앉았다.
// 그 2차의 짝이 되는 종합은 2025-09인데 그 해 계획이 없다 → **태어날 때부터 과거인 고아**.
//
// 🎯 핵심 단언은 「해를 넘기는가」가 아니라 **「정상 상태의 날짜가 그대로인가」**다.
//    2026-09 종합 → 2027-03 작동 → 2027-09 종합 → 2028-03 작동. 6개월 간격은 종전과 같고
//    사라지는 것은 첫 해의 고아 하나뿐이다. [B*]가 그 양성 대조 — 안 그러면 「2차를 아예
//    만들지 않는다」는 과잉 삭제가 전부 초록으로 통과한다.
//
// 🚨 산식이 **두 벌**이었다(plan-anchor + 생성기 인라인 사본). [D1]이 사본 부활을 막는다.
//
// 서버·DB 없이 순수 함수 + 소스 배선으로만 판정한다.
// 실행: npx tsx scripts/test-special-slot-year.mts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { desiredSlotsFor, desiredSlotsInYear, plannedDateFor } from '../src/lib/plan-anchor.ts'
import { codeOnly, strippedStats } from './_code-only.mts'

const ROOT = process.cwd()
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')
let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}
// 🚨 codeOnly 사본이 CRLF에서 불발하던 것을 공유 모듈로 올렸다 — 이 검사의 [E0]이 계측기를 단언한다.
//    실제로 [E1]이 **코드가 아니라 내 주석**에 걸려 거짓 빨강을 냈고, 그래서 이 구멍이 드러났다.

/** 기산월 → 'YYYY-MM-26'. ⚠ 반드시 두 자리로 채운다 — `1999-9-26`이면 `slice(5,7)`이 `'9-'`가 되어
 *  `Number()`가 NaN을 내고 **모든 비교가 조용히 false**가 된다(이 검사가 처음에 그렇게 틀렸다). */
const anchorOf = (m: number) => `1999-${String(m).padStart(2, '0')}-26`
const slot2 = (anchorISO: string) => desiredSlotsFor(anchorISO, '종합').find(d => d.sequence_num === 2)!

console.log('▶ 자체점검 2차 — 해를 넘기는 배치 · 첫 해 고아 폐지')

// ── A. 달 산식 — 종전과 같은 달이 나와야 한다 ────────────────────
for (const [m, want] of [[1, 7], [3, 9], [6, 12], [7, 1], [9, 3], [12, 6]] as const) {
  const s = slot2(anchorOf(m))
  check(`[A${m}] 기산월 ${m} → 2차 ${want}월 (달은 종전 그대로)`, s.month === want, `현재 ${s.month}월`)
}
check('[A-1차] 1차는 언제나 기산월·해 넘김 없음',
  desiredSlotsFor('1999-09-26', '종합')[0].month === 9 && desiredSlotsFor('1999-09-26', '종합')[0].yearOffset === 0)
check('[A-작동] 작동 대상은 2차가 없다 (종전 계약 보존)',
  desiredSlotsFor('1999-09-26', '작동').length === 1)

// ── B. 해 넘김 — 1~6월은 같은 해, 7~12월은 다음 해 ───────────────
for (const m of [1, 2, 3, 4, 5, 6]) check(`[B1] 기산월 ${m} → 2차는 **같은 해** (yearOffset 0)`, slot2(anchorOf(m)).yearOffset === 0)
for (const m of [7, 8, 9, 10, 11, 12]) check(`[B2] 기산월 ${m} → 2차는 **다음 해** (yearOffset 1)`, slot2(anchorOf(m)).yearOffset === 1)
check('[B3] 경계: 6월은 같은 해(12월), 7월은 다음 해(1월)',
  slot2(anchorOf(6)).yearOffset === 0 && slot2(anchorOf(6)).month === 12
  && slot2(anchorOf(7)).yearOffset === 1 && slot2(anchorOf(7)).month === 1)

// 🎯 양성 대조 — 2차 자체가 사라지면 안 된다
check('[B4] 종합 대상은 어느 기산월이든 2차가 **있다** (과잉 삭제 방지)',
  Array.from({ length: 12 }, (_, i) => i + 1)
    .every(m => desiredSlotsFor(`1999-${String(m).padStart(2, '0')}-26`, '종합').length === 2))
check('[B5] 2차의 종류는 언제나 special_작동 (종합 대상의 2차는 법적으로 작동점검)',
  Array.from({ length: 12 }, (_, i) => i + 1)
    .every(m => slot2(`1999-${String(m).padStart(2, '0')}-26`).planType === 'special_작동'))

// ── C. 달력 연도 필터 — 첫 해의 고아만 뺀다 ──────────────────────
const S = desiredSlotsFor('1999-09-26', '종합')   // 지평리56: 1차 9월 · 2차 3월(+1년)
{
  const y26 = desiredSlotsInYear(S, 2026, 2026)
  check('[C1] 신고 재현: 계획 첫 해(2026)에는 2차가 **없다** (짝이 될 종합이 없다)',
    y26.length === 1 && y26[0].sequence_num === 1, `${y26.length}건`)
}
{
  const y27 = desiredSlotsInYear(S, 2027, 2026)
  check('[C2] 이듬해(2027)에는 2차가 **있다** — 2026-09 종합의 짝',
    y27.length === 2 && y27.some(d => d.sequence_num === 2 && d.month === 3), `${y27.length}건`)
}
{
  // 🎯 양성 대조 — 감기지 않는 고객은 첫 해에도 2차가 있어야 한다
  const T = desiredSlotsFor('1999-03-26', '종합')   // 1차 3월 · 2차 9월(같은 해)
  const y26 = desiredSlotsInYear(T, 2026, 2026)
  check('[C3] 기산월 3(감김 없음)은 **첫 해에도** 2차가 있다',
    y26.length === 2 && y26.some(d => d.sequence_num === 2 && d.month === 9), `${y26.length}건`)
}
check('[C4] 1차는 어느 해에서도 빠지지 않는다',
  [2026, 2027, 2030].every(y => desiredSlotsInYear(S, y, 2026).some(d => d.sequence_num === 1)))

// ── D. 정상 상태의 날짜가 그대로인가 (이 차수의 가장 중요한 단언) ──
// 지평리56 실측값과 대조한다 — 기산일 1999-09-26, 공휴일 없음 가정(주말 보정만)
{
  const hd = new Set<string>()
  const dateOf = (y: number, m: number) => plannedDateFor(y, m, 26, hd)
  const timeline: string[] = []
  for (const y of [2026, 2027, 2028]) {
    for (const d of desiredSlotsInYear(S, y, 2026)) timeline.push(`${dateOf(y, d.month)} ${d.planType}`)
  }
  timeline.sort()
  const want = [
    '2026-09-28 special_종합',   // 09-26 토 → 28 월
    '2027-03-26 special_작동',
    '2027-09-27 special_종합',   // 09-26 일 → 27 월
    '2028-03-27 special_작동',   // 03-26 일 → 27 월
    '2028-09-26 special_종합',   // 창(2026~2028)의 마지막 해 1차 — 그 짝인 2029 작동은 창 밖이다
  ]
  check('[D0] 정상 상태 일정이 실측과 같다 (사라지는 것은 첫 해 고아뿐)',
    JSON.stringify(timeline) === JSON.stringify(want), timeline.join(' / '))
  check('[D0b] 2026년에 작동이 하나도 없다 (고아 제거 확인)',
    !timeline.some(t => t.startsWith('2026') && t.includes('작동')))
  check('[D0c] 2차는 언제나 그 주기 1차보다 **뒤**에 온다',
    timeline.every((t, i) => i === 0 || timeline[i - 1] < t))
}

// ── E. 배선 — 세 표면이 **같은 함수**를 쓰는가 ────────────────────
const GEN_RAW = read('src', 'lib', 'inspection-plan-generator.ts')
const GEN = codeOnly(GEN_RAW)
const REC = codeOnly(read('src', 'lib', 'reconcile-special-slots.ts'))
const ACT = codeOnly(read('src', 'app', '(dashboard)', 'customers', 'actions.ts'))

// 🎯 계측기 자기 검사 — [E1]이 「사본이 없다」를 묻는데, 그 사본의 **설명 주석**이 바로 위에 있다.
//    걷어내지 못하면 [E1]이 코드와 무관하게 빨강이 된다(실제로 이 검사가 처음에 그렇게 틀렸다).
{
  const s = strippedStats(GEN_RAW)
  check('[E0] codeOnly가 줄 주석을 실제로 걷어냈다 (계측기 자기 검사)',
    s.leftover === 0 && s.removed > 0, `남은 줄주석 ${s.leftover}줄 · 지운 글자 ${s.removed}`)
}

// 🚨 사본 부활 방지 — 생성기가 달을 다시 세면 경로에 따라 다른 달이 나온다
check('[E1] 생성기에 달 산식 사본이 없다 ((m-1+6)%12+1)',
  !/%\s*12\s*\)\s*\+\s*1/.test(GEN))
check('[E2] 생성기가 desiredSlotsFor를 쓴다', /desiredSlotsFor\(anchorDate, inspection_sub_type\)/.test(GEN))
check('[E3] 생성기가 2차를 targetYear + yearOffset에 앉힌다',
  /year: targetYear \+ d\.yearOffset/.test(GEN))
check('[E4] 생성기의 plan 조회가 (연,월) 쌍으로 묻는다 (한 해로 물으면 2차가 조용히 빠진다)',
  /\.in\('year', years\)/.test(GEN) && !/\.eq\('year', targetYear\)\.in\('month'/.test(GEN))
check('[E5] 재배치가 desiredSlotsInYear로 첫 해를 거른다',
  /desiredSlotsInYear\(desired, year, firstYear\)/.test(REC))
// 🚨 변이 M10이 뚫고 나간 자리 — 거른 목록을 **만들어 놓고 안 쓰면** 자리 계획이 고아를
//    `kind:'create'`로 다시 발행한다(잔재 청소만 고쳐서는 못 막는다. 생성과 청소는 다른 경로다).
check('[E5b] 자리 계획(planSpecialSlots)이 **거른 목록**(want)을 받는다',
  /planSpecialSlots\(year, want, rows\)/.test(REC))
check('[E6] 재배치의 잔재 청소가 **거른 목록**(want)을 쓴다 — 안 그러면 고아가 되살아난다',
  /planDemoteStraySpecials\(year, want, rows/.test(REC))
// [E7] 등록 화면 미리보기 — **아직 원격에 없는 타 세션 작업**이라 이 커밋에 못 실었다(2026-09-14).
// 그래서 「있으면 단언, 없으면 보류」로 둔다. 조용한 통과가 아니다 — **함수가 생기는 순간 스스로
// 무장**해서, 필터 없이 커밋되면 그때 빨강이 된다. 그 파일의 주석이 이미 같은 말을 하고 있다:
// "달 산식·영업일 보정·기산점 해석은 전부 실행이 쓰는 그 함수다. 화면이 따로 계산하면
//  보여준 것과 다른 일이 벌어진다."
if (/previewNewSchedule/.test(ACT)) {
  check('[E7] 등록 미리보기도 같은 필터를 쓴다 (보여준 것과 생기는 것이 같아야)',
    /desiredSlotsInYear\(slots, year, years\[0\]\)/.test(ACT))
} else {
  console.log('  ⏸ [E7] 보류 — previewNewSchedule이 이 트리에 없다(타 세션 미커밋). 생기면 자동으로 단언된다')
}

// ── F. 순수성 ────────────────────────────────────────────────────
const LIB = codeOnly(read('src', 'lib', 'plan-anchor.ts'))
check('[F1] plan-anchor가 React·Next·DB를 끌고 오지 않는다', !/from '(react|next|@supabase)/.test(LIB))
check('[F2] desiredSlotsFor가 시계를 읽지 않는다 (연도는 호출부가 준다)',
  !/new Date\(\)|Date\.now\(\)/.test(LIB))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
