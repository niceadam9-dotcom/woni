// T-2a 세부제원 섹션 점검 결과 배지 로직 프로브 (소방계획서_14_점검업무 §4 T-2a)
// 서버·DB 불필요 — 배지가 쓰는 순수 로직(rollUpForm3Results + facilityHint 집계)을 실제 코드로 대조.
// 실행: npx tsx scripts/_probe-spec-badge.mjs
// (동적 import — src/lib가 확장자 없는 상대 import를 쓰므로 node 네이티브 스트리핑으로는 해석되지 않는다)
const { FACILITY_SPEC_SECTIONS } = await import('../src/lib/facility-spec-schema.ts')
const { ALL_STANDARD_CODES } = await import('../src/lib/facility-codes.ts')
const { rollUpForm3Results, legacySheetOnlyStats, form3ItemsForSheet } = await import('../src/lib/sheet-facility-map.ts')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}
const hintCodes = b => (b.facilityHint ?? '').split(',').map(c => c.trim()).filter(Boolean)

/** plan-form14-specs.tsx sectionBadge()와 같은 규칙 — 여기서 갈리면 화면도 갈린다 */
function sectionBadge(sec, sheetStats, defectsBySheet, installedCodes) {
  if (sheetStats.length === 0) return null
  const codes = [...new Set(sec.blocks.flatMap(hintCodes))]
  if (codes.length === 0) return null
  const marks0 = rollUpForm3Results(legacySheetOnlyStats(sheetStats), ALL_STANDARD_CODES, installedCodes).resultMarks
  const defByCode = {}
  for (const [sheet, n] of Object.entries(defectsBySheet)) {
    for (const c of form3ItemsForSheet(sheet, ALL_STANDARD_CODES)) defByCode[c] = (defByCode[c] ?? 0) + n
  }
  const marks = codes.map(c => marks0[c]).filter(Boolean)
  if (marks.length === 0) return { mark: null, defects: 0, codes }
  return {
    mark: marks.includes('X') ? 'X' : marks.includes('O') ? 'O' : 'N',
    defects: codes.reduce((n, c) => n + (defByCode[c] ?? 0), 0),
    codes,
  }
}

const secOf = key => FACILITY_SPEC_SECTIONS.find(s => s.key === key)

console.log('\n── 1) 섹션 ↔ 설비 연결(facilityHint)이 실제로 존재하는가 ──')
const withHint = FACILITY_SPEC_SECTIONS.filter(s => s.blocks.some(b => b.facilityHint))
check('배지를 달 수 있는 섹션이 있다(facilityHint 보유)', withHint.length > 0,
  `보유: ${withHint.map(s => s.no).join(', ')}`)
const noHint = FACILITY_SPEC_SECTIONS.filter(s => !s.blocks.some(b => b.facilityHint))
console.log(`  · 배지 없음(공통사항 섹션): ${noHint.map(s => `${s.no} ${s.label}`).join(' / ') || '없음'}`)
check('hint 없는 섹션은 배지를 만들지 않는다(공통사항에 ○/×를 붙이면 거짓말)',
  noHint.every(s => sectionBadge(s, [['옥내소화전설비', { any: true, x: false, o: true }]], {}, []) === null))

console.log('\n── 2) 마크 판정 ──')
const s31 = secOf('s31_extinguisher')   // 소화기구 및 자동소화장치
check('설비 준비 — 3-1이 소화기구를 가리킨다',
  [...new Set(s31.blocks.flatMap(hintCodes))].includes('소화기구 및 자동소화장치'))

check('불량 응답 → × + 불량 건수',
  (() => {
    const b = sectionBadge(s31, [['소화기구 및 자동소화장치', { any: true, x: true, o: false }]],
      { '소화기구 및 자동소화장치': 3 }, ['소화기구 및 자동소화장치'])
    return b.mark === 'X' && b.defects === 3
  })())
check('양호 응답 → ○',
  sectionBadge(s31, [['소화기구 및 자동소화장치', { any: true, x: false, o: true }]], {}, ['소화기구 및 자동소화장치']).mark === 'O')
check('미설치 + 무응답 → ／ 해당없음',
  sectionBadge(s31, [['옥내소화전설비', { any: true, x: false, o: true }]], {}, ['옥내소화전설비']).mark === 'N')
check('설치했는데 응답 없음 → 미입력(mark=null) — 양호로 단정하지 않는다',
  sectionBadge(s31, [['옥내소화전설비', { any: true, x: false, o: true }]], {}, ['소화기구 및 자동소화장치', '옥내소화전설비']).mark === null)
check('응답이 하나도 없으면(회차 없음) 배지 자체가 없다', sectionBadge(s31, [], {}, ['소화기구 및 자동소화장치']) === null)

console.log('\n── 3) 화면 설치 상태가 판정에 반영되는가 (미저장 토글 즉시성) ──')
{
  // 같은 응답인데 설치 목록만 다르다 — 방금 켠 설비가 ／로 보이면 거짓말
  const stats = [['옥내소화전설비', { any: true, x: false, o: true }]]
  const off = sectionBadge(s31, stats, {}, [])                              // 소화기구 미설치
  const on = sectionBadge(s31, stats, {}, ['소화기구 및 자동소화장치'])      // 방금 체크(미저장)
  check('미설치일 때 ／', off.mark === 'N')
  check('체크하는 순간 ／ → 미입력으로 바뀐다', on.mark === null, JSON.stringify(on))
}

console.log('\n── 4) 문서와 같은 판정인가 (T-2a-1 공용 함수) ──')
{
  const stats = [['소화용수설비', { any: true, x: false, o: true }]]
  const marks = rollUpForm3Results(legacySheetOnlyStats(stats), ALL_STANDARD_CODES, []).resultMarks
  check('시트 1개 → 설비 2종 전개가 배지 경로에서도 동일(상수도·소화수조 모두 ○)',
    marks['상수도소화용수설비'] === 'O' && marks['소화수조 및 저수조'] === 'O',
    JSON.stringify({ 상수도: marks['상수도소화용수설비'], 소화수조: marks['소화수조 및 저수조'] }))
  const s37 = FACILITY_SPEC_SECTIONS.find(s => s.blocks.some(b => hintCodes(b).includes('상수도소화용수설비')))
  check('소화용수 섹션 배지도 ○', !s37 || sectionBadge(s37, stats, {}, []).mark === 'O',
    s37 ? `${s37.no} ${s37.label}` : '해당 섹션 없음')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
