// T-3 스냅샷 비교 — 별지9호 3쪽/8쪽 매칭을 퍼지(nameMatch) vs 명시(FORM3_SHEET_MAP)로 대조 (소방계획서_14_점검업무 §5)
// 서버·DB 불필요(순수 함수 대조). 실행: npx tsx scripts/_probe-form3-map.mjs
const { FORM3_ITEMS } = await import('../src/lib/doc-templates/report9.ts')
const { SHEET_FACILITY_MAP, form3ItemsForSheet, rollUpForm3Results, legacySheetOnlyStats } = await import('../src/lib/sheet-facility-map.ts')
const { ALL_STANDARD_CODES } = await import('../src/lib/facility-codes.ts')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}
const norm = s => s.replace(/\s+/g, '')
const f3 = sheet => form3ItemsForSheet(sheet, FORM3_ITEMS)
// 교체 전 동작 재현 — report9-actions.ts:31-35 nameMatch 원본
const nameMatch = (a, b) => {
  const x = a.replace(/ /g, ''), y = b.replace(/ /g, '')
  return !!x && !!y && (x.includes(y) || y.includes(x))
}

console.log('\n── 1) 어휘 정합 — SHEET_FACILITY_MAP 값이 전부 FORM3_ITEMS 어휘인가 ──')
const form3Norm = new Set(FORM3_ITEMS.map(norm))
const strayValues = [...new Set(Object.values(SHEET_FACILITY_MAP).flat())].filter(v => !form3Norm.has(norm(v)))
check('SHEET_FACILITY_MAP의 모든 값이 FORM3_ITEMS에 존재 (역인덱스 파생의 전제)',
  strayValues.length === 0, `미등재: ${JSON.stringify(strayValues)}`)
const stdNorm = new Set(ALL_STANDARD_CODES.map(norm))
const form3NotStd = FORM3_ITEMS.filter(i => !stdNorm.has(norm(i)))
const stdNotForm3 = ALL_STANDARD_CODES.filter(c => !form3Norm.has(norm(c)))
check('FACILITY_STANDARD ↔ FORM3_ITEMS 어휘 일치(정규화 후) — facilityChecks를 정확 매칭으로 바꿀 근거',
  form3NotStd.length === 0 && stdNotForm3.length === 0,
  `FORM3에만: ${JSON.stringify(form3NotStd)} / 표준에만: ${JSON.stringify(stdNotForm3)}`)

console.log('\n── 2) 시트 → FORM3 항목: 퍼지 vs 명시 ──')
const sheetNames = Object.keys(SHEET_FACILITY_MAP)
let diffSheet = 0
for (const sheet of sheetNames) {
  const fuzzy = FORM3_ITEMS.filter(i => nameMatch(sheet, i))
  const explicit = f3(sheet)
  const same = JSON.stringify([...fuzzy].sort()) === JSON.stringify([...explicit].sort())
  if (!same) {
    diffSheet++
    const missed = explicit.filter(e => !fuzzy.includes(e))
    const wrong = fuzzy.filter(f => !explicit.includes(f))
    console.log(`  · ${sheet}`)
    if (wrong.length) console.log(`      오검(퍼지가 잘못 잡던 것): ${JSON.stringify(wrong)}`)
    if (missed.length) console.log(`      누락(퍼지가 놓치던 것):   ${JSON.stringify(missed)}`)
  }
}
console.log(`  → 카탈로그 시트 ${sheetNames.length}개 중 ${diffSheet}개에서 판정이 달라진다`)

// 3쪽 resultMarks는 '시트당 FORM3 1개'가 아니라 'FORM3 항목당 시트 1개'를 찾는 구조 — 역방향도 본다
console.log('\n── 3) FORM3 항목 → 시트: 퍼지 vs 명시 (resultMarks 경로) ──')
let diffItem = 0
for (const item of FORM3_ITEMS) {
  const fuzzy = sheetNames.filter(s => nameMatch(s, item))
  const explicit = sheetNames.filter(s => f3(s).includes(item))
  const same = JSON.stringify([...fuzzy].sort()) === JSON.stringify([...explicit].sort())
  if (!same) {
    diffItem++
    const wrong = fuzzy.filter(f => !explicit.includes(f))
    const missed = explicit.filter(e => !fuzzy.includes(e))
    console.log(`  · ${item}`)
    if (wrong.length) console.log(`      오검: ${JSON.stringify(wrong)}`)
    if (missed.length) console.log(`      누락: ${JSON.stringify(missed)}`)
  }
}
console.log(`  → FORM3 ${FORM3_ITEMS.length}개 중 ${diffItem}개에서 판정이 달라진다`)

console.log('\n── 4) 설치 설비 → FORM3 항목(facilityChecks): 퍼지 vs 정규화 정확 매칭 ──')
let diffFac = 0
for (const code of ALL_STANDARD_CODES) {
  const fuzzy = FORM3_ITEMS.filter(i => nameMatch(code, i))
  const exact = FORM3_ITEMS.filter(i => norm(i) === norm(code))
  if (JSON.stringify(fuzzy) !== JSON.stringify(exact)) {
    diffFac++
    console.log(`  · 설치="${code}" → 퍼지 ${JSON.stringify(fuzzy)} / 정확 ${JSON.stringify(exact)}`)
  }
}
console.log(`  → 표준 코드 ${ALL_STANDARD_CODES.length}개 중 ${diffFac}개에서 판정이 달라진다`)

console.log('\n── 5) 회귀 방지 단언 ──')
check('명시 매핑이 알려진 오검을 제거: 설치 "스프링클러설비"가 "간이스프링클러설비" 항목을 켜지 않는다',
  !FORM3_ITEMS.filter(i => norm(i) === norm('스프링클러설비')).includes('간이스프링클러설비'))
check('명시 매핑이 알려진 누락을 해소: 시트 "자동화재탐지설비 및 시각경보장치" → "자동화재탐지설비 및 시각경보기" 연결',
  f3('자동화재탐지설비 및 시각경보장치').includes('자동화재탐지설비 및 시각경보기'))
check('미등재 시트는 퍼지 폴백 유지 — "연소방지설비"(카탈로그 밖) 시트도 항목을 찾는다',
  f3('연소방지설비').includes('연소방지설비'))
check('시트 "소화용수설비" → 상수도·소화수조 2개 항목 모두 연결(퍼지는 1개도 못 잡던 축)',
  f3('소화용수설비').length === 2)

console.log('\n── 6) 실제 롤업 함수(rollUpForm3Results) — assembleReport9가 쓰는 그 코드 ──')
{
  // 시트 3개 응답 + 설치 2종. '소화용수설비' 시트 하나가 FORM3 2항목을 덮는 케이스가 핵심
  const stat = new Map([
    ['옥내소화전설비', { any: true, x: false, o: true }],          // 양호 → ○
    ['소화기구 및 자동소화장치', { any: true, x: true, o: false }], // 불량 → ×
    ['소화용수설비', { any: true, x: false, o: true }],            // 항목 2개로 전개 → 둘 다 ○
  ])
  const installed = ['옥내소화전설비', '소화기구 및 자동소화장치', '스프링클러설비']
  const { facilityChecks, resultMarks } = rollUpForm3Results(legacySheetOnlyStats(stat), FORM3_ITEMS, installed)

  check('6) 응답 양호 → ○', resultMarks['옥내소화전설비'] === 'O', JSON.stringify(resultMarks['옥내소화전설비']))
  check('6) 응답 불량 → ×', resultMarks['소화기구 및 자동소화장치'] === 'X')
  check('6) 시트 1개가 FORM3 2항목을 덮는다 — 상수도·소화수조 모두 ○ (퍼지 시절엔 둘 다 놓쳤다)',
    resultMarks['상수도소화용수설비'] === 'O' && resultMarks['소화수조 및 저수조'] === 'O',
    JSON.stringify({ 상수도: resultMarks['상수도소화용수설비'], 소화수조: resultMarks['소화수조 및 저수조'] }))
  check('6) 설치했지만 응답 없음 → 공란(키 없음, 단정 금지)',
    !('스프링클러설비' in resultMarks), JSON.stringify(resultMarks['스프링클러설비']))
  check('6) 미설치·무응답 → 해당없음 N', resultMarks['거실제연설비'] === 'N')
  check('6) 오검 제거 — 설치 "스프링클러설비"가 간이/화재조기진압용을 켜지 않는다',
    facilityChecks.includes('스프링클러설비')
    && !facilityChecks.includes('간이스프링클러설비') && !facilityChecks.includes('화재조기진압용스프링클러설비'),
    JSON.stringify(facilityChecks))
  check('6) 미설치 항목이 설치 체크에 들어가지 않는다', !facilityChecks.includes('옥외소화전설비'))
}

// ── 7) F-1f 이중 귀속 — 전용 시트 분리 + 레거시 간선 (2026-08-22, 마이그레이션 150과 짝) ──
//
// 고정하는 것: ①서림사 무퇴행(할론 단독 설치 + 과거 묶음 시트 응답 → 할론 ○ 유지)
// ②선택 분리(묶음 시트는 조기진압·할론 '설치'만으로는 안 잡힌다 — 신규 입력은 전용 시트로)
// ③전용 시트 정방향. 레거시 간선을 지우면 ①이, LEGACY를 선택에 합치면 ②가 깨진다(돌연변이 양방향).
{
  console.log('\n── 7) F-1f 이중 귀속 — 전용 시트 분리 + 레거시 간선 ──')
  const { sheetMatchesFacilities, facilitiesForSheet, LEGACY_ROLLUP_MAP } = await import('../src/lib/sheet-facility-map.ts')
  // resultMarks의 키는 FORM3 표기다(예: '화재조기진압용스프링클러설비' — 공백 없음) — 표기 축을 지우지 않고 해석만
  const f3key = name => FORM3_ITEMS.find(i => norm(i) === norm(name)) ?? `(FORM3에 없음: ${name})`

  const legacyStray = [...new Set(Object.values(LEGACY_ROLLUP_MAP).flat())].filter(v => !form3Norm.has(norm(v)))
  check('7) LEGACY_ROLLUP_MAP 값도 전부 FORM3 어휘', legacyStray.length === 0, JSON.stringify(legacyStray))
  const legacyKeysInMain = Object.keys(LEGACY_ROLLUP_MAP).every(k => k in SHEET_FACILITY_MAP)
  check('7) 레거시 키는 전부 본 매핑의 시트 (없는 시트에 간선을 걸지 않는다)', legacyKeysInMain)

  // ① 무퇴행 — 서림사 실측 시나리오: 할론 단독 설치, 응답은 옛 묶음 시트(할로겐)에만
  const seorimsa = rollUpForm3Results(
    legacySheetOnlyStats(new Map([['할로겐화합물 및 불활성기체소화설비', { any: true, x: false, o: true }]])),
    FORM3_ITEMS, ['할론소화설비'])
  check('7) 서림사 무퇴행 — 묶음 시트 응답이 할론 결과칸에 계속 귀속(○)',
    seorimsa.resultMarks[f3key('할론소화설비')] === 'O', JSON.stringify(seorimsa.resultMarks[f3key('할론소화설비')]))
  check('7) 그 응답이 미설치 할로겐화합물로는 번지지 않는다(／)',
    seorimsa.resultMarks[f3key('할로겐화합물 및 불활성기체소화설비')] === 'N',
    JSON.stringify(seorimsa.resultMarks[f3key('할로겐화합물 및 불활성기체소화설비')]))
  check('7) 대장 누락 경고 아님 — 설치된 레거시 형제(할론)가 응답 주인',
    !seorimsa.axisWarnings.respondedNotInstalled.includes(f3key('할론소화설비')))

  // ① 조기진압 방향 — 스프링클러 시트 과거 응답이 조기진압 단독 설치에 귀속
  const early = rollUpForm3Results(
    legacySheetOnlyStats(new Map([['스프링클러설비', { any: true, x: true, o: false }]])),
    FORM3_ITEMS, ['화재조기진압용 스프링클러설비'])
  check('7) 조기진압 무퇴행 — 스프링클러 시트 과거 불량이 조기진압 ×로 귀속',
    early.resultMarks[f3key('화재조기진압용 스프링클러설비')] === 'X',
    JSON.stringify(early.resultMarks[f3key('화재조기진압용 스프링클러설비')]))

  // ② 선택 분리 — 설치만으로는 묶음 시트가 잡히지 않는다(전용 시트가 잡힌다)
  check('7) 선택 분리 — 할론 설치로 묶음 시트(할로겐)가 잡히지 않는다',
    !sheetMatchesFacilities('할로겐화합물 및 불활성기체소화설비', ['할론소화설비']))
  check('7) 선택 분리 — 조기진압 설치로 묶음 시트(스프링클러)가 잡히지 않는다',
    !sheetMatchesFacilities('스프링클러설비', ['화재조기진압용 스프링클러설비']))
  check('7) 전용 시트 정방향 — 할론 설치 → 할론소화설비 시트',
    sheetMatchesFacilities('할론소화설비', ['할론소화설비'])
    && sheetMatchesFacilities('화재조기진압용 스프링클러설비', ['화재조기진압용 스프링클러설비']))
  check('7) 전용 시트 롤업 — 할론 시트 응답 → 할론 ○',
    rollUpForm3Results(legacySheetOnlyStats(new Map([['할론소화설비', { any: true, x: false, o: true }]])),
      FORM3_ITEMS, ['할론소화설비']).resultMarks[f3key('할론소화설비')] === 'O')

  // ③ 형제 고지는 간선을 숨기지 않는다(D-5) — 묶음 시트에 쓰면 할론 배지도 바뀐다는 사실
  check('7) 형제 고지 — 묶음 시트(할로겐)가 레거시 형제(할론)를 함께 표시',
    facilitiesForSheet('할로겐화합물 및 불활성기체소화설비', ALL_STANDARD_CODES).some(c => norm(c) === '할론소화설비'))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
