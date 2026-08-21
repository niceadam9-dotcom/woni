/** 별지 4호 1쪽 · 9호 3쪽 1절 — 설치(√) 축과 점검결과(○/×) 축의 귀속 규칙 회귀 고정.
 *  DB·서버 불필요, 결정적. 실행: npx tsx scripts/test-form3-axis.mts
 *
 *  이 파일이 지키는 것(2026-08-21):
 *    ①  한 시트가 여러 FORM3 항목을 덮을 때, 응답은 **설치된 형제**의 것이지 미설치 항목으로 번지지 않는다
 *    ②  형제가 전부 미설치면 귀속시킬 데가 없다 — 대장 누락일 수 있으므로 **결과를 지우지 않는다**
 *    ③  설치 항목의 마크는 이 규칙과 무관하게 종전과 같다(실점검이 지워지면 안 된다)
 *  ①만 하고 ②를 빠뜨리면 '미설치면 무조건 ／'가 되어, 대장에 체크를 빠뜨린 실점검이 해당없음으로
 *  덮인다. 반대로 ②만 하면 종전 상태다. 두 가지를 함께 단언해야 규칙이 고정된다.
 *
 *  어휘는 리터럴로 쓴다 — FORM3_ITEMS(report9.ts)를 끌어오면 서식 템플릿 편집이 이 검사를 흔든다.
 *  대신 그 어휘가 표준 42종에 실재하는지를 마지막에 대조해, 오타로 검사가 헛도는 걸 막는다. */
import { rollUpForm3Results, SHEET_FACILITY_MAP } from '../src/lib/sheet-facility-map.ts'
import { ALL_STANDARD_CODES } from '../src/lib/facility-codes.ts'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}
type Stat = { any: boolean; x: boolean }
const ok1: Stat = { any: true, x: false }
const bad: Stat = { any: true, x: true }

// 검사에 쓰는 어휘 — SHEET_FACILITY_MAP의 값 어휘와 같아야 한다
const 자탐 = '자동화재탐지설비 및 시각경보기'
const 화재알림 = '화재알림설비'
const 상수도 = '상수도소화용수설비'
const 소화수조 = '소화수조 및 저수조'
const 소화기구 = '소화기구 및 자동소화장치'
const 스프링클러 = '스프링클러설비'
const 조기진압 = '화재조기진압용 스프링클러설비'
const 옥내 = '옥내소화전설비'
const ITEMS = [자탐, 화재알림, 상수도, 소화수조, 소화기구, 스프링클러, 조기진압, 옥내]

console.log('── 1) 종전 동작 보존 — 설치 항목의 마크는 달라지지 않는다')
{
  const r = rollUpForm3Results([['옥내소화전설비', ok1]], ITEMS, [옥내])
  check('설치 + 응답 양호 → ○', r.resultMarks[옥내] === 'O', JSON.stringify(r.resultMarks[옥내]))
  const rx = rollUpForm3Results([['옥내소화전설비', bad]], ITEMS, [옥내])
  check('설치 + 불량 → ×', rx.resultMarks[옥내] === 'X')
  const r0 = rollUpForm3Results([], ITEMS, [옥내])
  check('설치 + 무응답 → 공란(키 없음)', r0.resultMarks[옥내] === undefined, JSON.stringify(r0.resultMarks[옥내]))
  check('미설치 + 무응답 → ／', r0.resultMarks[화재알림] === 'N')
}

console.log('\n── 2) 번짐 차단 — 응답은 설치된 형제의 것 (사용자 지적 2026-08-20)')
{
  // '자동화재탐지설비 및 시각경보장치' 시트 하나가 자탐·화재알림 두 항목을 덮는다.
  // 자탐만 설치된 건에서 시트에 응답하면 종전엔 화재알림설비까지 ○였다(서림사 실측).
  const r = rollUpForm3Results([['자동화재탐지설비 및 시각경보장치', ok1]], ITEMS, [자탐])
  check('설치된 자탐은 ○', r.resultMarks[자탐] === 'O')
  check('미설치 화재알림설비는 ／ (○로 번지지 않는다)', r.resultMarks[화재알림] === 'N',
    `실제: ${r.resultMarks[화재알림]}`)
  check('번짐 차단이 경고로 남는다', r.axisWarnings.spillSuppressed.includes(화재알림),
    JSON.stringify(r.axisWarnings))
  check('차단된 항목은 대장 누락 경고에 들어가지 않는다',
    !r.axisWarnings.respondedNotInstalled.includes(화재알림))

  const rx = rollUpForm3Results([['스프링클러설비', bad]], ITEMS, [스프링클러])
  check('불량도 형제로 번지지 않는다 (조기진압 ／)',
    rx.resultMarks[스프링클러] === 'X' && rx.resultMarks[조기진압] === 'N',
    JSON.stringify({ 스프링클러: rx.resultMarks[스프링클러], 조기진압: rx.resultMarks[조기진압] }))
}

console.log('\n── 3) 대장 누락 보존 — 형제가 전부 미설치면 결과를 지우지 않는다')
{
  // 전용 시트(1항목)에 응답이 있는데 대장에 없다 = 실제로 점검했을 가능성이 크다(지평9 실측).
  const r = rollUpForm3Results([['소화기구 및 자동소화장치', ok1]], ITEMS, [])
  check('미설치여도 ○를 유지한다 (실점검을 지우지 않는다)', r.resultMarks[소화기구] === 'O',
    `실제: ${r.resultMarks[소화기구]}`)
  check('대장 누락 경고로 표면화된다', r.axisWarnings.respondedNotInstalled.includes(소화기구),
    JSON.stringify(r.axisWarnings))

  // 다항목 시트인데 형제가 전부 미설치인 경우도 같다 — 종전 전개를 유지한다.
  // (_probe-spec-badge의 '시트 1개 → 설비 2종 전개' 단언이 기대는 동작이다)
  const r2 = rollUpForm3Results([['소화용수설비', ok1]], ITEMS, [])
  check('형제 전부 미설치 → 두 항목 모두 ○ 유지',
    r2.resultMarks[상수도] === 'O' && r2.resultMarks[소화수조] === 'O',
    JSON.stringify({ 상수도: r2.resultMarks[상수도], 소화수조: r2.resultMarks[소화수조] }))
  check('둘 다 대장 누락 경고', r2.axisWarnings.respondedNotInstalled.length === 2)
  check('이 경우 번짐 차단은 없다', r2.axisWarnings.spillSuppressed.length === 0)
}

console.log('\n── 4) 경계 — 한쪽만 설치면 그쪽만 산다')
{
  const r = rollUpForm3Results([['소화용수설비', ok1]], ITEMS, [상수도])
  check('설치된 상수도 ○ · 미설치 소화수조 ／',
    r.resultMarks[상수도] === 'O' && r.resultMarks[소화수조] === 'N',
    JSON.stringify({ 상수도: r.resultMarks[상수도], 소화수조: r.resultMarks[소화수조] }))
  // 같은 항목을 여러 시트가 덮을 때, 한 시트에서 차단돼도 다른 시트가 정당하게 마크하면 살아난다
  const r2 = rollUpForm3Results(
    [['자동화재탐지설비 및 시각경보장치', ok1], ['화재알림설비', ok1]], ITEMS, [자탐, 화재알림])
  check('둘 다 설치면 둘 다 ○', r2.resultMarks[자탐] === 'O' && r2.resultMarks[화재알림] === 'O')
  check('두 경고 모두 비어 있다',
    r2.axisWarnings.spillSuppressed.length === 0 && r2.axisWarnings.respondedNotInstalled.length === 0)
}

console.log('\n── 5) 두 경고는 서로 배타 — 같은 항목이 양쪽에 들어가지 않는다')
{
  const r = rollUpForm3Results(
    [['자동화재탐지설비 및 시각경보장치', ok1], ['소화기구 및 자동소화장치', ok1]], ITEMS, [자탐])
  const both = r.axisWarnings.spillSuppressed.filter(i => r.axisWarnings.respondedNotInstalled.includes(i))
  check('교집합 없음', both.length === 0, JSON.stringify(r.axisWarnings))
  check('한 건에서 두 갈래가 함께 잡힌다 (번짐 1 · 누락 1)',
    r.axisWarnings.spillSuppressed.length === 1 && r.axisWarnings.respondedNotInstalled.length === 1,
    JSON.stringify(r.axisWarnings))
}

console.log('\n── 6) 어휘 실재 확인 — 오타로 검사가 헛돌지 않게')
{
  const std = new Set(ALL_STANDARD_CODES.map((c: string) => c.replace(/\s+/g, '')))
  const missing = ITEMS.filter(i => !std.has(i.replace(/\s+/g, '')))
  check('검사 어휘 8종이 표준 42종에 실재', missing.length === 0, `없는 어휘: ${missing.join(', ')}`)
  const mapped = new Set(Object.values(SHEET_FACILITY_MAP).flat().map(v => v.replace(/\s+/g, '')))
  const unmapped = ITEMS.filter(i => !mapped.has(i.replace(/\s+/g, '')))
  check('검사 어휘가 시트 매핑 값에도 실재', unmapped.length === 0, `매핑에 없음: ${unmapped.join(', ')}`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
