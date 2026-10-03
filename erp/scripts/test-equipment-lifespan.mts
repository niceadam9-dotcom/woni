/** 설비 대장 품목 규칙·만료 판정 순수 단언 (통합계획 C3, 2026-10-02)
 *  실행: npx tsx scripts/test-equipment-lifespan.mts — 서버·DB 불필요 */
import { normalizeYm, expiryOf, expiryState, tallyAssets, expiredSentence, DEFAULT_RULE, warrantyUntilOf } from '../src/lib/equipment-lifespan.ts'
import { gasDefectSentence } from '../src/lib/gas-storage.ts'
import { expiryBadge } from '../src/lib/equipment-expiry.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) } }

console.log('— 제조연월 정규화')
ok('2015-03', normalizeYm('2015-03') === '2015-03-01')
ok('2015.3', normalizeYm('2015.3') === '2015-03-01')
ok('201503', normalizeYm('201503') === '2015-03-01')
ok('2015-03-17 → 그 달 1일', normalizeYm('2015-03-17') === '2015-03-01')
ok('13월 거절', normalizeYm('2015-13') === null)
ok('글자 거절', normalizeYm('작년') === null)
ok('빈 값 null', normalizeYm('') === null && normalizeYm(null) === null)

console.log('— 기본 규칙')
ok('분말 = 법정 10년', DEFAULT_RULE.powder === 'legal10')
ok('호스·연기감지기 = 권장 15년', DEFAULT_RULE.hose === 'rec15' && DEFAULT_RULE.smoke_detector === 'rec15')
ok('가스용기·펌프 = 없음', DEFAULT_RULE.gas_cylinder === 'none' && DEFAULT_RULE.pump === 'none')

console.log('— 만료일·상태')
const T = '2026-10-02'
ok('분말 2015-03 → 2025-03-01', expiryOf({ manufactured_on: '2015-03-01', lifespan_rule: 'legal10' }) === '2025-03-01')
ok('연장값이 있으면 그것', expiryOf({ manufactured_on: '2015-03-01', lifespan_rule: 'legal10', extension_until: '2027-03-01' }) === '2027-03-01')
ok('2015-03 분말은 경과', expiryState({ manufactured_on: '2015-03-01', lifespan_rule: 'legal10' }, T) === 'expired')
ok('2016-12 분말은 12개월 내(soon)', expiryState({ manufactured_on: '2016-12-01', lifespan_rule: 'legal10' }, T) === 'soon')
ok('2020-01 분말은 ok', expiryState({ manufactured_on: '2020-01-01', lifespan_rule: 'legal10' }, T) === 'ok')
ok('제조연월 없음 → unknown', expiryState({ manufactured_on: null, lifespan_rule: 'legal10' }, T) === 'unknown')
ok('연수 없음 → none', expiryState({ manufactured_on: '2001-01-01', lifespan_rule: 'none' }, T) === 'none')
ok('정확히 오늘 만료는 경과', expiryState({ manufactured_on: '2016-10-01', lifespan_rule: 'legal10', extension_until: '2026-10-02' }, T) === 'expired')

console.log('— 수량 가중 집계·자동 문장')
const rows = [
  { qty: 4, category: 'powder' as const, location: '3층', manufactured_on: '2015-03-01', lifespan_rule: 'legal10' as const },
  { qty: 2, category: 'powder' as const, location: '지하1층', manufactured_on: '2014-11-01', lifespan_rule: 'legal10' as const },
  { qty: 10, category: 'powder' as const, location: '1층', manufactured_on: '2022-05-01', lifespan_rule: 'legal10' as const },
  { qty: 3, category: 'powder' as const, location: '옥상', manufactured_on: '2014-01-01', lifespan_rule: 'legal10' as const, status: 'replaced' },
  { qty: 1, category: 'gas_cylinder' as const, location: '전기실', manufactured_on: '2010-01-01', lifespan_rule: 'none' as const },
]
const t = tallyAssets(rows, T)
ok('총 17대(교체된 3대 제외)', t.total === 17, JSON.stringify(t))
ok('경과 6대', t.expired === 6)
const s = expiredSentence(rows, 'powder', T)
ok('문장', s === '내용연수 경과 분말소화기 6대: 3층 4대(2015-03), 지하1층 2대(2014-11)', s ?? '')
ok('경과 없는 품목은 null', expiredSentence(rows, 'gas_cylinder', T) === null)

console.log('— 2단계: 하자보수 · 가스 불량 문장 · 배지')
ok('완강기 완공 2025-05-01 → 2027-05-01(2년)', warrantyUntilOf('descender', '2025-05-01') === '2027-05-01')
ok('연기감지기 3년', warrantyUntilOf('smoke_detector', '2024-02-10') === '2027-02-10')
ok('윤일 2024-02-29 + 3년 → 02-28', warrantyUntilOf('gas_cylinder', '2024-02-29') === '2027-02-28')
ok('분말은 하자보수 없음 → null', warrantyUntilOf('powder', '2025-05-01') === null)
ok('형식 오류 → null', warrantyUntilOf('descender', '2025-5-1') === null)
const gs = gasDefectSentence([
  { location: '지하1층 저장실', cylNo: 2, rate: 3 / 45 },
  { location: '지하1층 저장실', cylNo: 1, rate: 1 / 45 },
  { location: '1층', cylNo: 1, rate: 0.051 },
  { location: '옥상', cylNo: 1, rate: null },
])
ok('가스 문장: 5% 초과 2병만 · 위치 정렬 · 소수 1자리', gs === '약제량 손실 5% 초과 2병: 1층 No.1(손실 5.1%), 지하1층 저장실 No.2(손실 6.7%)', gs ?? '')
ok('정확히 5%는 양호(초과만 불량)', gasDefectSentence([{ location: 'A', cylNo: 1, rate: 0.05 }]) === null)
ok('배지: 경과 있으면 빨강 「만료 n」', expiryBadge({ expired: 4, soon: 2 })?.label === '만료 4' && expiryBadge({ expired: 4, soon: 2 })?.tone === 'red')
ok('배지: 임박만 있으면 주황', expiryBadge({ expired: 0, soon: 2 })?.label === '만료 임박 2' && expiryBadge({ expired: 0, soon: 2 })?.tone === 'amber')
ok('배지: 0/0·없음 → null', expiryBadge({ expired: 0, soon: 0 }) === null && expiryBadge(undefined) === null)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
