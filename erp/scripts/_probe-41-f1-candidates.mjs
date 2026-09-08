/** 소방계획서_41 F-1 — 운영 Gotenberg 육안의 **대상 후보**를 찾는다. 읽기 전용(SELECT만).
 *
 *  8쪽 「불량 세부 사항」 육안이 의미를 가지려면 fold가 실제로 발동해야 한다:
 *    ① 자체점검(special_* 또는 plan_type null) 건이어야 하고
 *    ② 설비 대장(fire_facilities.installed)이 비어 있지 않아야 한다(Q-5: 공집합이면 fold 미발동)
 *    ③ 4상태가 섞여 있을수록 좋다 — 사용자 입력 행 / 결과참조 / 이상없음 / 해당없음
 *
 *  실행: node scripts/_probe-41-f1-candidates.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.production', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
console.log(`대상 DB: ${env.NEXT_PUBLIC_SUPABASE_URL} (.env.production)\n`)

// ⚠ data만 destructure하면 없는 컬럼 하나가 조용한 0행이 된다 — error를 함께 본다
async function q(label, builder) {
  const { data, error, count } = await builder
  if (error) { console.log(`  ❌ ${label}: ${error.code ?? '?'} ${error.message}`); return null }
  console.log(`  ${label}: ${count ?? (data?.length ?? 0)}`)
  return data
}

console.log('[1] 운영 데이터 규모 (0이면 F-1 육안 자체가 불가)')
for (const t of ['customers', 'inspections', 'inspection_defects', 'fire_facilities', 'buildings']) {
  await q(t, db.from(t).select('id', { count: 'exact', head: true }))
}

console.log('\n[2] 자체점검 건 (별지 9호 대상)')
const { data: insps, error: e2 } = await db.from('inspections')
  .select('id, customer_id, year, plan_type, inspection_start_date, customer:customers(customer_name)')
  .order('inspection_start_date', { ascending: false })
  .limit(50)
if (e2) { console.log(`  ❌ ${e2.code} ${e2.message}`); process.exit(1) }
const special = (insps ?? []).filter(i => !i.plan_type || String(i.plan_type).startsWith('special'))
console.log(`  전체 ${insps?.length ?? 0}건 중 자체점검 ${special.length}건`)

if (special.length === 0) {
  console.log('\n판정: 운영에 자체점검 건이 없다 — F-1 육안 불가(데이터 축).')
  process.exit(0)
}

console.log('\n[3] 후보별 fold 발동 재료')
for (const i of special.slice(0, 12)) {
  const { count: defects } = await db.from('inspection_defects')
    .select('id', { count: 'exact', head: true }).eq('inspection_id', i.id)
  const { data: bldgs } = await db.from('buildings').select('id').eq('customer_id', i.customer_id)
  const ids = (bldgs ?? []).map(b => b.id)
  let installed = 0
  if (ids.length) {
    const { count } = await db.from('fire_facilities')
      .select('id', { count: 'exact', head: true }).in('building_id', ids).eq('installed', true)
    installed = count ?? 0
  }
  const ok = installed > 0
  console.log(`  ${ok ? '✅' : '⚠ '} ${i.customer?.customer_name ?? '—'} / ${i.year} / ${i.inspection_start_date ?? '-'}`)
  console.log(`      inspection=${i.id}  불량행=${defects ?? 0}  건물=${ids.length}  설치대장=${installed}${ok ? '' : '  ← 대장 공집합이면 fold 미발동(Q-5)'}`)
}
