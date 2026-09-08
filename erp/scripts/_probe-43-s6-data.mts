/** S6 검증용 **양성 표본이 DB에 존재하는가** — 없으면 위 검증은 음성만 본 것이다 (소방계획서_43 S6).
 *  ⚠ 읽기 전용. 실행: npx tsx --conditions=react-server scripts/_probe-43-s6-data.mts */
import './_env.mjs'
import { createAdminClient } from '../src/lib/supabase/admin'
import { ETC_CODES } from '../src/lib/facility-codes'
import { isMultiUseApplicable } from '../src/lib/multi-use'

const admin = createAdminClient()

console.log('── 1.4 기타 7종(ETC_CODES) 설치 체크 현황 ──')
const { data: etc, error: e1 } = await admin.from('fire_facilities')
  .select('building_id, facility_code, installed').in('facility_code', [...ETC_CODES])
if (e1) console.error('조회 실패:', e1.message)
const etcRows = etc ?? []
const etcInstalled = etcRows.filter(r => r.installed)
console.log(`   ETC 코드 행 ${etcRows.length}건 · 그중 installed=true ${etcInstalled.length}건`)
if (etcInstalled.length) {
  const byBld = new Map<string, string[]>()
  for (const r of etcInstalled) {
    if (!byBld.has(r.building_id)) byBld.set(r.building_id, [])
    byBld.get(r.building_id)!.push(r.facility_code)
  }
  console.log(`   설치된 건물 ${byBld.size}동:`)
  for (const [b, cs] of [...byBld].slice(0, 5)) console.log(`      ${b.slice(0, 8)} → ${cs.join(', ')}`)
}

console.log('\n── 1.10.3 다중이용업소 「해당」 현황 ──')
const { data: forms, error: e2 } = await admin.from('fire_plan_forms').select('customer_id, sections')
if (e2) console.error('조회 실패:', e2.message)
const rows = forms ?? []
const applicable = rows.filter(f => {
  const mu = ((f.sections ?? {}) as Record<string, unknown>)['multiUse'] as { applicable?: boolean } | undefined
  return isMultiUseApplicable(mu ?? null)
})
console.log(`   fire_plan_forms ${rows.length}건 · 그중 multiUse.applicable=true ${applicable.length}건`)
for (const f of applicable.slice(0, 5)) console.log(`      고객 ${String(f.customer_id).slice(0, 8)}`)

console.log('\n── 대장(fire_facilities)이 있는 건물 ──')
const { data: any1 } = await admin.from('fire_facilities').select('building_id, installed')
const all = any1 ?? []
const blds = new Set(all.map(r => r.building_id))
const bldsInstalled = new Set(all.filter(r => r.installed).map(r => r.building_id))
console.log(`   대장 행 ${all.length}건 · 건물 ${blds.size}동 · 설치체크 있는 건물 ${bldsInstalled.size}동`)

console.log('\n판정:')
console.log(`   S6-1 양성 표본 ${etcInstalled.length ? '있음 ✅' : '없음 🚫 — 이 축은 실데이터로 못 만든다'}`)
console.log(`   S6-2 양성 표본 ${applicable.length ? '있음 ✅' : '없음 🚫 — 이 축은 실데이터로 못 만든다'}`)
