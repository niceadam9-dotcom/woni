/** 실측 프로브 — 별지10호/갑지 계획서의 「이행조치기간」이 왜 비는가 (2026-09-14)
 *
 *  그 칸의 값은 `resolveActionPeriod(수기 annex_inputs.report10.totalPeriod, 자동 actionPlanPeriod)`
 *  하나에서 온다. 비었다면 **둘 다 없는 것**이다 — 어느 쪽이 없는지를 고객·회차별로 센다.
 *
 *  실행: npx tsx scripts/_probe-action-period-gap.mts [고객명 일부]
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)
console.log(`DB: ${url.replace(/https:\/\/([^.]+).*/, '$1')}`)

const needle = process.argv[2] ?? ''

const { data: custs } = await admin.from('customers').select('id, customer_name')
const hit = (custs ?? []).filter(c => !needle || (c.customer_name as string).includes(needle))
console.log(`고객 ${hit.length}명 (전체 ${custs?.length ?? 0})`)

for (const c of hit) {
  // 🚨 컬럼명은 `inspection_start_date`다 — `inspection_date`로 물으면 PostgREST가 에러를 주는데
  //   구조분해(`{ data }`)가 그걸 삼켜 **「점검 0건」으로 보인다**(2026-09-14 실제로 한 번 속았다).
  const { data: insp, error } = await admin.from('inspections')
    .select('id, inspection_start_date, inspection_type, year, sequence_num').eq('customer_id', c.id)
    .order('inspection_start_date', { ascending: false }).limit(5)
  if (error) throw new Error(`inspections 조회 실패: ${error.message}`)
  if (!insp?.length) { console.log(`\n■ ${c.customer_name} — 점검 0건`); continue }
  console.log(`\n■ ${c.customer_name}`)
  for (const i of insp) {
    const { data: defects } = await admin.from('inspection_defects')
      .select('id, action_start, action_end').eq('inspection_id', i.id)
    const withRange = (defects ?? []).filter(d => d.action_start && d.action_end).length
    const { data: ai } = await admin.from('annex_inputs')
      .select('fields').eq('inspection_id', i.id).eq('kind', 'report10').maybeSingle()
    const f = (ai?.fields ?? {}) as Record<string, unknown>
    const manual = typeof f.totalPeriod === 'string' ? f.totalPeriod : ''
    const days = typeof f.totalDays === 'string' ? f.totalDays : ''
    const verdict = manual ? '수기' : withRange ? '자동' : '❌ 없음 → 인쇄 공란'
    console.log(`   ${i.inspection_start_date} ${i.inspection_type ?? ''} ${i.year}-${i.sequence_num} · 불량 ${defects?.length ?? 0}건`
      + `(기간 있는 건 ${withRange}) · 수기 totalPeriod="${manual}" totalDays="${days}" → ${verdict}`)
  }
}
