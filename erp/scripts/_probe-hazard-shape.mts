/** sections.hazards 모양 실측 — `risks` 없는 행이 있으면 그 고객은 엑셀·PDF를 영영 못 받는다
 *  (조립기 `normHazardFactors(h.risks)`가 undefined에서 터져 500).
 *  실행: npx tsx scripts/_probe-hazard-shape.mts */
import { raw } from './_e2e-helpers.mjs'

const { data, error } = await raw.from('fire_plan_forms').select('customer_id, sections')
if (error) { console.error('🚨', error.message); throw error }
const rows = (data ?? []) as Array<{ customer_id: string; sections: Record<string, unknown> }>
console.log(`fire_plan_forms 행 ${rows.length}개`)

let withHaz = 0, bad = 0, badZones = 0
for (const r of rows) {
  const hz = r.sections?.hazards as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(hz) || hz.length === 0) continue
  withHaz++
  for (const h of hz) {
    if (!Array.isArray(h?.risks)) {
      bad++
      console.log(`  🚨 ${r.customer_id} — risks 없음: ${JSON.stringify(h).slice(0, 120)}`)
    }
  }
  // 같은 축의 이웃: zones도 조립기가 필드를 갈아 끼운다(모양이 갈라지면 같은 부류의 500)
  const zs = r.sections?.zones as Array<Record<string, unknown>> | undefined
  if (Array.isArray(zs)) for (const z of zs) if (typeof z?.zone !== 'string') badZones++
}
console.log(`\nhazards 가진 고객 ${withHaz}명 · risks 없는 행 ${bad}건 · zones 모양 이상 ${badZones}건`)
console.log(bad === 0
  ? '✅ 실데이터는 전부 정상 모양 — UI가 항상 risks:[]를 넣는다(정상 경로에선 안 터진다)'
  : '🚨 그 고객들은 지금 엑셀·PDF가 500이다 — 방어가 필요하다')
