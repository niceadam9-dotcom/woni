/**
 * resolveFireStation 실DB 검증 (소방계획서_11 C-2)
 *   npx tsx scripts/test-fire-station.mts        # .env.local (스테이징)
 *
 * 독립검증이 잡은 두 실패(구 단위 주소 공란 / 성남 수정·중원구 → 분당소방서 오매핑)가
 * 실제 매핑 테이블에서 해소됐는지 확인한다.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'
// 정적 named import는 tsx v4 + node24 조합에서 해석에 실패한다(다른 스크립트와 같은 증상) —
// 동적 import는 런타임 네임스페이스라 영향을 받지 않는다.
const { resolveFireStation } = await import('../src/lib/fire-station.ts')

config({ path: resolve(process.cwd(), '.env.local') })
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

/** [주소, 기대 소방서(null=매핑 없음이 정답), 기대 source] */
const CASES: Array<[string, string | null, string | null]> = [
  // 기존 22행 — 읍·면 매핑이 그대로 살아 있어야 한다(회귀)
  ['경기도 양평군 양평읍 경강로 2047', '양평소방서', 'emd'],
  ['경기 양평군 용문면 다문리 100', '양평소방서', 'emd'],
  // 시·군 전역 대표행 — 읍면이 테이블에 없어도 잡힌다(종전엔 estimate로 떨어졌다)
  ['경기도 하남시 신장동 100', '하남소방서', 'sigun'],
  ['강원특별자치도 홍천군 북방면 100', '홍천소방서', 'sigun'],
  ['강원특별자치도 속초시 조양동 100', '속초소방서', 'sigun'],
  // 🔴 독립검증 지적 ①: 성남 수정·중원구가 분당소방서로 오매핑되던 문제
  ['경기 성남시 수정구 산성대로 100', '성남소방서', 'gu'],
  ['경기 성남시 중원구 광명로 100', '성남소방서', 'gu'],
  ['경기 성남시 분당구 판교로 255', '분당소방서', 'gu'],
  // 🔴 독립검증 지적 ②: 광역시 구 단위 주소가 전부 공란이 되던 문제
  ['서울특별시 영등포구 여의대로 24', '영등포소방서', 'gu_sido'],
  ['서울 중구 세종대로 110', '중부소방서', 'gu_sido'],          // 구명≠소방서명
  ['서울 금천구 시흥대로 100', '금천소방서', 'gu_sido'],        // 2022 개서
  // 한 시에 소방서가 여럿인 나머지
  ['경기 고양시 일산동구 중앙로 100', '일산소방서', 'gu'],
  ['경기 고양시 덕양구 화정로 100', '고양소방서', 'gu'],
  ['경기 용인시 기흥구 구성로 100', '용인서부소방서', 'gu'],    // 2024 개서
  ['경기 용인시 처인구 명지로 45', '용인소방서', 'gu'],
  ['경기 수원시 팔달구 인계로 100', '수원남부소방서', 'gu'],
  ['경기 수원시 영통구 광교로 100', '수원소방서', 'gu'],
  // 인천 — 구명≠소방서명
  ['인천 부평구 부평대로 100', '인천부평소방서', 'gu_sido'],
  ['인천광역시 강화군 강화읍 북문길 41', '인천강화소방서', 'sigun'],
  // 매핑 없는 지역 — 추정으로 떨어지되 배지 대상(source=estimate)
  ['충청북도 옥천군 옥천읍 100', '옥천소방서', 'estimate'],
  // ⚠ 의도적 미매핑 — 동 단위로 갈려 확정 불가(연수구·남동구·옹진군·평택시)
  ['인천 연수구 컨벤시아대로 100', null, null],
  ['인천 남동구 논현로 100', null, null],
]

console.log('\n[resolveFireStation — 실DB]')
for (const [addr, expStation, expSource] of CASES) {
  const r = await resolveFireStation(admin, { address: addr })
  if (expStation === null) {
    check(`매핑 없음이 정답: ${addr}`, r === null, r ? JSON.stringify(r) : '')
    continue
  }
  check(`${addr} → ${expStation} (${expSource})`,
    r?.station === expStation && r?.source === expSource, JSON.stringify(r))
}

// Daum 위젯 경로 — sigungu가 '성남시 분당구' 한 덩어리로 온다
const daum = await resolveFireStation(admin, { regionSi: '성남시 분당구', regionMyeon: '정자동' })
check('Daum sigungu 형식(성남시 분당구) 분해', daum?.station === '분당소방서', JSON.stringify(daum))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
