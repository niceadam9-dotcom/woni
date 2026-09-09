/** 인계 3건 중 2번 — 「`.in()`은 요청 URL 길이를 풀지 않는다(414 가능, **미실측**)」의 실측.
 *
 *  소방계획서_45 §S12. 이 차수가 여러 화면에 `fetchAllRows` + `.in('inspection_id', ids)`를 깔았는데,
 *  1000행 상한은 풀었어도 **id 목록 자체가 URL에 실린다**. UUID 36자 + 구분자면 1000건에 약 37KB다.
 *  게이트웨이(Kong/nginx)의 헤더·요청줄 상한을 넘으면 414/400이 오는데, 그것은 조용한 절단과 달리
 *  **오류로 표면화**되므로 fetchAllRows의 `error`에 잡힌다 — 다만 그 지점이 어디인지 아무도 안 쟀다.
 *
 *  읽기 전용. 실제 id를 쓰지 않고 **형식만 맞는 더미 UUID**를 넣어 0건을 조회한다
 *  (결과 행이 아니라 요청이 통과하는지만 본다 — 데이터 분포에 의존하지 않는 축).
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-45-in-url-limit.mts */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('환경변수 없음 — .env.local의 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요')
  process.exit(1)
}
const admin = createClient(url, key, { auth: { persistSession: false } })

function dummyIds(n: number): string[] {
  // 형식만 맞는 UUID — 실재하지 않으므로 결과는 항상 0건이다(우리가 보는 것은 요청의 성패다)
  return Array.from({ length: n }, (_, i) =>
    `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
}

const SIZES = [10, 50, 100, 200, 400, 700, 1000, 1500, 2000, 3000, 5000]

let lastOk = 0
let firstFail = 0
console.log('| ids | URL 대략 바이트 | 결과 |')
console.log('|---|---|---|')
for (const n of SIZES) {
  const ids = dummyIds(n)
  const approxBytes = ids.join(',').length + 120   // 경로·쿼리 나머지 대략치
  const { error } = await admin
    .from('inspection_steps').select('id').in('inspection_id', ids).limit(1)
  if (error) {
    console.log(`| ${n} | ~${approxBytes} | ❌ ${error.code ?? ''} ${error.message.slice(0, 80)} |`)
    if (!firstFail) firstFail = n
  } else {
    console.log(`| ${n} | ~${approxBytes} | ✅ 통과 |`)
    if (!firstFail) lastOk = n
  }
}

console.log('')
if (!firstFail) {
  console.log(`결론: ${SIZES[SIZES.length - 1]}건까지 **전부 통과**했다 — 이 게이트웨이에서 414는 재현되지 않는다.`)
  console.log('     (상한이 없다는 증명은 아니다. 잰 범위 안에서 안전하다는 것까지가 이 프로브의 주장이다)')
} else {
  console.log(`결론: **${lastOk}건 통과 / ${firstFail}건에서 실패**. 호출부는 id 목록을 ${lastOk}건 단위로 쪼개야 한다.`)
}
console.log('⚠ 이 결과는 스테이징 게이트웨이 기준이다 — 운영이 다른 프록시 설정이면 다시 재야 한다.')
