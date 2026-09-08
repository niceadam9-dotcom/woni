/** 서식 1.2.2 화재취약장소(보일러실·주방 등)가 ERP에 있는가 — 저장소는 `fire_plan_forms.sections`.
 *  ⚠ 표 이름을 추측하지 말 것(1차에 `fire_plan_sections`라 짐작했다 없는 표였다) — 코드에서 읽었다
 *    (fire-plan-generate.ts:106). */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { data: cs } = await db.from('customers').select('id, customer_name').ilike('customer_name', '%강순%')
for (const c of (cs ?? []) as Record<string, unknown>[]) {
  const { data, error } = await db.from('fire_plan_forms')
    .select('sections').eq('customer_id', c.id as string).maybeSingle()
  if (error) { console.log(`${c.customer_name}: ${error.message}`); continue }
  const sec = (data?.sections ?? {}) as Record<string, unknown>
  const keys = Object.keys(sec)
  console.log(`\n═══ ${c.customer_name}`)
  console.log(`  sections 키 ${keys.length}개: ${keys.join(', ') || '(빈)'}`)
  const hz = sec.hazards as Array<Record<string, unknown>> | undefined
  console.log(`  hazards: ${hz?.length ?? 0}행`)
  for (const h of hz ?? []) {
    console.log(`    · 장소=«${h.place}» 위치=«${h.loc}» 위험요소=[${(h.risks as string[] ?? []).join(', ')}]`)
  }
  const zones = sec.zones as Array<Record<string, unknown>> | undefined
  console.log(`  zones(1.2.1 구역별): ${zones?.length ?? 0}행`)
}
