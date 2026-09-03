/** 1.4 「기타」 축(ETC_ITEMS, 2026-09-03) 회귀 가드 — 순수·무DB.
 *
 *  이 축의 위험은 하나다: **새 설비 코드를 넣으면 42칸 축이 오염될 수 있다.**
 *  sheetMatchesFacilities는 미등재 시트에 퍼지 폴백(양방향 includes)을 쓰므로, 코드가 늘면
 *  엉뚱한 시트가 우연히 '설치'로 판정될 수 있고 그러면 39의 필수 강제가 엉뚱한 데 붙는다.
 *  그래서 **바뀌는 시트가 정확히 의도한 6개뿐임을 대조로 고정**한다.
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-etc-axis.mts */
import { ALL_STANDARD_CODES, FIRE_SUB_ITEMS, ETC_ITEMS, ETC_CODES } from '../src/lib/facility-codes.ts'
import { SHEET_FACILITY_MAP, sheetMatchesFacilities, form3ItemMatchesFacility, rollUpForm3Results }
  from '../src/lib/sheet-facility-map.ts'
import { FORM3_ITEMS } from '../src/lib/doc-templates/report9.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const EXPECTED_SHEETS = ['기타사항', '기타사항 점검표', '위험물 저장·취급시설', '화기시설', '가연성 가스시설', '전기시설']

// ── [A] 단일 원천 — 체크 코드와 시트 매핑 값이 문자 그대로 같은가 ──────────────
console.log('[A] ETC_CODES ↔ SHEET_FACILITY_MAP 문자 일치')
const mappedEtc = new Set(EXPECTED_SHEETS.flatMap(s => SHEET_FACILITY_MAP[s] ?? []))
for (const c of ETC_CODES) ok(`매핑에 '${c}'가 있다`, mappedEtc.has(c))
ok('매핑 값에 ETC_CODES 밖의 코드가 없다', [...mappedEtc].every(c => ETC_CODES.includes(c)),
  [...mappedEtc].filter(c => !ETC_CODES.includes(c)).join(',') || 'none')

// ── [B] 42칸 무오염 — ETC 코드가 FORM3 항목 어느 것과도 매칭되지 않는가 ────────
console.log('\n[B] 별지 3쪽 42칸 무오염')
const collide = ETC_CODES.filter(c => FORM3_ITEMS.some(i => form3ItemMatchesFacility(i, c)))
ok('ETC 코드가 FORM3 항목과 겹치지 않는다', collide.length === 0, collide.join(',') || 'none')
ok('ETC 코드가 표준 42종·소화기구 하위와 겹치지 않는다',
  ETC_CODES.every(c => !ALL_STANDARD_CODES.includes(c) && !FIRE_SUB_ITEMS.includes(c)))

// 롤업 결과가 ETC 코드 유무에 불변인가(대조군 — 실제 함수로)
const stats = [{ sheet: '유도등', group: null, stat: { any: true, x: false, o: true } }]
const base = rollUpForm3Results(stats, FORM3_ITEMS, ['유도등'])
const withEtc = rollUpForm3Results(stats, FORM3_ITEMS, ['유도등', ...ETC_CODES])
ok('롤업 facilityChecks 불변', JSON.stringify(base.facilityChecks) === JSON.stringify(withEtc.facilityChecks))
ok('롤업 resultMarks 불변', JSON.stringify(base.resultMarks) === JSON.stringify(withEtc.resultMarks))

// ── [C] 판정이 바뀌는 시트가 정확히 6개인가 (퍼지 폴백 오염 검출) ──────────────
console.log('\n[C] installed 판정 델타 — 의도한 6시트뿐인가')
const stdCodes = [...ALL_STANDARD_CODES, ...FIRE_SUB_ITEMS]
// ⚠ 아래 등재 밖 이름은 **적대적 표본**이다 — 퍼지 폴백(양방향 includes)이 열려 있으면
//   '비상구'·'방염 처리물품'이 그대로 걸린다(수리 전 실측으로 확인). 통과의 근거는
//   sheet-facility-map의 fuzzyCodes()가 「기타」 코드를 폴백에서 빼기 때문이다.
const allSheetNames = [...new Set([...Object.keys(SHEET_FACILITY_MAP), ...EXPECTED_SHEETS,
  '소화기구 및 자동소화장치 점검표', '유도등 점검표', '전기설비', '비상구', '방염 처리물품', '기타',
  '방염물품', '전기', '화기', '가스시설', '위험물'])]
const changed = allSheetNames.filter(n =>
  sheetMatchesFacilities(n, stdCodes) !== sheetMatchesFacilities(n, [...stdCodes, ...ETC_CODES]))
ok('델타 시트가 정확히 의도한 6개', changed.length === EXPECTED_SHEETS.length
  && EXPECTED_SHEETS.every(s => changed.includes(s)), `changed=[${changed.join(' / ')}]`)

// ── [D] 딥링크 해석 — 체크 코드 하나로 그 점검표가 풀리는가 ────────────────────
console.log('\n[D] ?facility= 딥링크 해석')
for (const it of ETC_ITEMS) {
  const hits = EXPECTED_SHEETS.filter(s => sheetMatchesFacilities(s, [it.code]))
  ok(`'${it.code}' → 점검표 해석`, hits.includes(it.sheetName), `hits=[${hits.join(',')}]`)
}
// 체크 안 한 코드가 남의 시트를 열지 않는가(음성 대조)
ok('무관한 코드는 기타 시트를 열지 않는다',
  !EXPECTED_SHEETS.some(s => sheetMatchesFacilities(s, ['옥내소화전설비'])))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
