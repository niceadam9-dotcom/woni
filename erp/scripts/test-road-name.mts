/**
 * extractRoadName / buildSurroundingsDraft 단위 테스트 (소방계획서_11 V-7)
 *   npx tsx scripts/test-road-name.mts
 *
 * 왜 만들었나: 독립 검증(2026-08-07)이 BLK-4(공백형 부속도로 `○○로 72번길 35`를 간선도로로 오분류)와
 * K-8b(일련번호식 `사직로8길`의 모도로 미역산)를 잡아냈는데, 순수 함수인데도 테스트가 0건이라
 * 정규식 변경이 그대로 새는 구조였다. 회귀 방지용으로 고정한다.
 */
import { extractRoadName } from '../src/lib/address-parser.ts'
import { buildSurroundingsDraft } from '../src/lib/fire-plan-suggest.ts'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

type Expect = { road: string | null; tier?: string; mainRoad?: string | null }
const CASES: Array<[string, Expect]> = [
  // 기본형
  ['경기 양평군 양평읍 마유산로 123-4', { road: '마유산로', tier: 'ro', mainRoad: '마유산로' }],
  ['강원특별자치도 동해시 천곡로 120', { road: '천곡로', tier: 'ro' }],
  ['서울시 종로구 세종대로 175', { road: '세종대로', tier: 'daero' }],
  ['경기도 광주시 초월읍 무들로 112', { road: '무들로', tier: 'ro' }],
  ['충북 청주시 상당구 1순환로 1000', { road: '1순환로', tier: 'ro' }],       // 숫자로 시작하는 도로명
  // 부속 도로명 — 붙여쓴 기초번호식
  ['서울 중구 중앙대로123번길 45', { road: '중앙대로123번길', tier: 'gil', mainRoad: '중앙대로' }],
  ['경기 성남시 분당구 대왕판교로606번길 10', { road: '대왕판교로606번길', tier: 'gil', mainRoad: '대왕판교로' }],
  // BLK-4 — 띄어쓴 기초번호식(종전엔 '중문관광로'/ro로 오분류됐다)
  ['제주 서귀포시 중문관광로 72번길 35', { road: '중문관광로 72번길', tier: 'gil', mainRoad: '중문관광로' }],
  ['경기 고양시 일산동구 중앙로 1275번길 38-4', { road: '중앙로 1275번길', tier: 'gil', mainRoad: '중앙로' }],
  ['경기 양평군 양평읍 양근로 21번길 8', { road: '양근로 21번길', tier: 'gil', mainRoad: '양근로' }],
  ['경남 창원시 의창구 창원대로 18번길 7', { road: '창원대로 18번길', tier: 'gil', mainRoad: '창원대로' }],
  // K-8b — 일련번호식(번 없음)·가길 변형. 모도로가 이름에 인코딩돼 있으므로 역산돼야 한다
  ['서울특별시 종로구 사직로8길 34', { road: '사직로8길', tier: 'gil', mainRoad: '사직로' }],
  ['서울 강남구 강남대로94길 20', { road: '강남대로94길', tier: 'gil', mainRoad: '강남대로' }],
  ['서울 송파구 올림픽로35길 137', { road: '올림픽로35길', tier: 'gil', mainRoad: '올림픽로' }],
  ['서울 종로구 새문안로5가길 28', { road: '새문안로5가길', tier: 'gil', mainRoad: '새문안로' }],
  ['양평군 양평읍 물안개로 12길 3', { road: '물안개로 12길', tier: 'gil', mainRoad: '물안개로' }],
  // 도로명이 아예 없는 경우
  ['경기도 양평군 양평읍 양평리 500', { road: null }],
  ['경기도 양평군 양평읍 마유산로', { road: null }],            // 건물번호 없음 → 오탐 방지
  ['2026년 1월 12일 점검', { road: null }],
  // 잡음이 섞여도 도로명은 잡아야 한다
  ['경기도 양평군 양평읍 경강로 2047 양평소방서', { road: '경강로' }],
  ['서울 강남구 테헤란로 12, 3층', { road: '테헤란로' }],
]

console.log('\n[extractRoadName]')
for (const [input, exp] of CASES) {
  const r = extractRoadName(input)
  if (exp.road === null) {
    check(`null: ${input}`, r === null, r ? JSON.stringify(r) : '')
    continue
  }
  const okRoad = r?.road === exp.road
  const okTier = exp.tier === undefined || r?.tier === exp.tier
  const okMain = exp.mainRoad === undefined || r?.mainRoad === exp.mainRoad
  check(`${input} → ${exp.road}${exp.mainRoad ? ` (모도로 ${exp.mainRoad})` : ''}`,
    !!r && okRoad && okTier && okMain, JSON.stringify(r))
}

console.log('\n[buildSurroundingsDraft]')
// 방위를 고르면 접도 방위와 인접 방위가 겹치지 않아야 한다(하드코딩 '동/서/남' 회귀 방지)
const d1 = buildSurroundingsDraft({ road: '마유산로', mainRoad: '마유산로', tier: 'ro', bearing: '동' })
check('방위 동 선택 시 접도=동측, 인접 목록에 동측 없음',
  d1.startsWith('동측 마유산로') && !d1.replace('동측 마유산로에 접함', '').includes('동측'), d1)
const d2 = buildSurroundingsDraft({ road: '사직로8길', mainRoad: '사직로', tier: 'gil', bearing: '북' })
check('이면도로 — 모도로 분기 문장 포함', d2.includes('사직로에서') && d2.includes('이면도로'), d2)
const d3 = buildSurroundingsDraft({ road: null, mainRoad: null, tier: null })
check('도로명 없으면 방위·도로 모두 빈칸', d3.includes('[방위]측') && d3.includes('____'), d3)
check('차로수는 항상 빈칸(자동 단정 금지)', d1.includes('__차로') && d2.includes('__차로'))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
