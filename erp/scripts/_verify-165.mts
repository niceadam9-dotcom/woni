/** 마이그 165 적용 검증 — 「붙었다」를 남의 말이 아니라 값으로 확인한다 (2026-09-16)
 *
 *  🚨 컬럼이 생겼다로 끝내지 않는다. 백필이 **어느 고객에게 무엇을** 넣었는지, 합계 파생의
 *    불변식(`stairs_count = 직통+피난`)이 **한 건도 어긋나지 않는지**, 그리고 **대상 밖 건물을
 *    건드리지 않았는지**(과잉 적용)까지 본다.
 *
 *  실행: npx tsx scripts/_verify-165.mts
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: new URL('../.env.local', import.meta.url).pathname.replace(/^\//, ''), quiet: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('.env.local 접속값이 없다 — 「0건」은 무효다')
console.log(`[접속] ${url.replace(/https:\/\/([a-z]+).*/, '$1…')}\n`)
const a = createClient(url, key)

type Bld = {
  customer_id: string; is_active: boolean | null; stairs_count: number | null
  stair_direct_count: number | null; stair_escape_count: number | null
  stair_special_count: number | null; stair_outdoor_count: number | null
}
const sel = async <T>(t: string, s: string): Promise<T[]> => {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await a.from(t).select(s).range(from, from + 999)
    // 42703이면 컬럼이 없다 — 「0건」으로 흘리면 미적용을 적용으로 오인한다
    if (error) throw new Error(`${t} 조회 실패(${error.code ?? '?'}): ${error.message}`)
    out.push(...(data ?? []) as never)
    if ((data?.length ?? 0) < 1000) break
  }
  return out
}

const bs = await sel<Bld>('buildings',
  'customer_id, is_active, stairs_count, stair_direct_count, stair_escape_count, stair_special_count, stair_outdoor_count')
const cs = await sel<{ id: string; customer_name: string | null }>('customers', 'id, customer_name')
const nm = new Map(cs.map(c => [c.id, c.customer_name ?? '(무명)']))
console.log(`✅ [1] 네 컬럼이 조회된다 — 42703 없음 (건물 ${bs.length}동)`)

const act = bs.filter(b => b.is_active !== false)
const n = (v: number | null) => (v == null ? 0 : v)
const filled = act.filter(b => [b.stair_direct_count, b.stair_escape_count, b.stair_special_count, b.stair_outdoor_count].some(v => v != null))

console.log(`\n[2] 백필된 건물 ${filled.length}동 (기대 5)`)
for (const b of filled.sort((x, y) => (nm.get(x.customer_id) ?? '').localeCompare(nm.get(y.customer_id) ?? ''))) {
  const s = (v: number | null) => (v == null ? '-' : String(v))
  console.log(`  · ${(nm.get(b.customer_id) ?? '').padEnd(18)} 직통=${s(b.stair_direct_count)} 피난=${s(b.stair_escape_count)} 특별=${s(b.stair_special_count)} 옥외=${s(b.stair_outdoor_count)}  합계=${s(b.stairs_count)}`)
}

/* [3] 파생 불변식 — 이 컬럼은 이제 사람이 적는 칸이 아니다. 어긋나면 별지 9호와 서식 1.1이
 *     다시 다른 말을 하기 시작한다(이번 작업이 없앤 바로 그 결함). */
const mismatch = act.filter(b => {
  const want = n(b.stair_direct_count) + n(b.stair_escape_count)
  return b.stairs_count !== (want > 0 ? want : null)
})
console.log(`\n[3] 합계 = 직통+피난 불변식 — 어긋난 건물 ${mismatch.length}동 (0이어야 한다)`)
for (const b of mismatch.slice(0, 10)) {
  console.log(`  🚨 ${nm.get(b.customer_id)}  합계=${b.stairs_count} 인데 직통=${b.stair_direct_count} 피난=${b.stair_escape_count}`)
}

/* [4] 과잉 적용 음성 축 — 대상이 아니던 건물이 값을 얻지 않았는가.
 *     2026-09-16 실측에서 종전 `stairs_count`가 있던 건물은 3동, 1.5 탭에만 있던 고객이 2명이었다. */
const strays = filled.filter(b => !['서림사', '지평리56', '송학떡집', '별그리다(추모공원)', '강순기 건물_2'].includes(nm.get(b.customer_id) ?? ''))
console.log(`\n[4] 대상 밖인데 값이 생긴 건물 ${strays.length}동 (0이어야 한다)`)
for (const b of strays.slice(0, 10)) console.log(`  🚨 ${nm.get(b.customer_id)}`)

/* [5] 이번 작업이 고치려던 인쇄 불일치의 원천 — 특별피난계단이 건물에 실렸는가 */
const special = filled.filter(b => n(b.stair_special_count) > 0).map(b => nm.get(b.customer_id))
console.log(`\n[5] 특별피난계단이 건물 값으로 들어온 고객 ${special.length}명 (기대 2: 송학떡집·별그리다)`)
console.log(`    ${special.join(' · ')}`)

/* [6] 송학떡집 옥외계단 — `'0'`이 그대로 0으로 들어왔는가.
 *     새 판정(`checkFromCount`)은 1 이상만 켜므로 이 0이 곧 「상자 꺼짐」이다(종전엔 ■였다). */
const shp = filled.find(b => nm.get(b.customer_id) === '송학떡집')
console.log(`\n[6] 송학떡집 옥외계단 = ${shp?.stair_outdoor_count} (기대 0 → 상자 꺼짐)`)

const fails: string[] = []
if (filled.length !== 5) fails.push(`백필 ${filled.length}동(5여야 한다)`)
if (mismatch.length !== 0) fails.push(`합계 불일치 ${mismatch.length}동`)
if (strays.length !== 0) fails.push(`대상 밖 ${strays.length}동에 값이 생겼다`)
if (special.length !== 2) fails.push(`특별피난 ${special.length}명(2여야 한다)`)
if (shp?.stair_outdoor_count !== 0) fails.push(`송학떡집 옥외계단이 ${shp?.stair_outdoor_count}(0이어야 한다)`)

console.log(fails.length ? `\n❌ 검증 실패:\n  ${fails.join('\n  ')}` : '\n✅ 165 적용 검증 통과 — 다섯 축 전부')
process.exit(fails.length ? 1 : 0)
