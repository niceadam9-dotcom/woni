/** 주소 본체·상세 가르기 (2026-10-06) — 직접 친 주소로 [주소 검색]을 바로 띄우고, 덧붙인 동/호수는 지킨다.
 *  의존 0. 실행: npx tsx scripts/test-address-detail.mts */
import { splitAddressDetail, joinAddressDetail } from '../src/lib/address-detail.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${m}`) } else { fail++; console.log(`  ❌ ${m}${d ? ' — ' + d : ''}`) }
}
const eq = (input: string, base: string, detail: string, m: string) => {
  const r = splitAddressDetail(input)
  ok(r.base === base && r.detail === detail, m, JSON.stringify(r))
}

eq('서울 중구 세종대로 110 3층 302호', '서울 중구 세종대로 110', '3층 302호', '🎯 층·호수는 상세로 떨어진다')
eq('경기 양평군 지평면 지평의병로 123-4, 101동', '경기 양평군 지평면 지평의병로 123-4', '101동', '🎯 부번·쉼표 뒤 동')
eq('서울특별시 중구 세종대로 110', '서울특별시 중구 세종대로 110', '', '상세가 없으면 전체가 본체')
eq('서울 강남구 테헤란로12길 7 B1', '서울 강남구 테헤란로12길 7', 'B1', '「…로12길 7」 — 번길 도로명도 본체')
eq('서울 중구 세종대로 110 (태평로1가)', '서울 중구 세종대로 110', '(태평로1가)', '괄호 참고항목은 상세로(지우지 않는다)')
eq('양평군 양평읍 양근리 123', '양평군 양평읍 양근리 123', '', '🎯 (음성) 지번 주소는 가르지 않는다 — 지어내지 않는다')
eq('  ', '', '', '빈 칸')
// 「…로 1」 같은 숫자로 시작하는 상세(예: 110 1층)에서 건물번호를 1층으로 오인하지 않는다
eq('서울 중구 세종대로 110 1층', '서울 중구 세종대로 110', '1층', '🎯 「1층」의 1을 건물번호로 먹지 않는다')

ok(joinAddressDetail('서울특별시 중구 세종대로 110', '3층 302호') === '서울특별시 중구 세종대로 110 3층 302호', '🎯 고른 도로명 뒤에 상세를 다시 붙인다')
ok(joinAddressDetail('서울특별시 중구 세종대로 110', '') === '서울특별시 중구 세종대로 110', '상세가 없으면 도로명 그대로')

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
