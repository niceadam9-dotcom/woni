/** 「강순」 후보 전건을 나란히 — 어느 것이 정본인지 고르기 위해. 값은 가려서 찍는다. */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: process.argv[2] ?? '.env.local' })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const red = (v: unknown, keep = 4) => {
  const s = v == null ? '' : String(v).trim()
  return s ? (s.length <= keep ? s : `${s.slice(0, keep)}…(${s.length})`) : '(빈)'
}
const { data: cs } = await db.from('customers')
  .select('id, customer_name, address, is_active, created_at, inspection_type, building_grade, owner_id, manager_contact_id, use_approval_date')
  .ilike('customer_name', '%강순%').order('created_at')

for (const c of (cs ?? []) as Record<string, unknown>[]) {
  const { data: bs } = await db.from('buildings')
    .select('id, building_name, is_active, total_area, floors_above, purpose, structure, roof, height_m, receiver_location, building_area, permit_date')
    .eq('customer_id', c.id as string)
  const { count: inspCnt } = await db.from('inspections').select('id', { count: 'exact', head: true }).eq('customer_id', c.id as string)
  const { count: facCnt } = await db.from('fire_facilities').select('id', { count: 'exact', head: true }).eq('customer_id', c.id as string)
  console.log(`\n═══ ${String(c.customer_name)}  (${String(c.id).slice(0, 8)}…)`)
  console.log(`   활성=${c.is_active} · 생성 ${String(c.created_at).slice(0, 10)} · 관리유형 ${red(c.inspection_type, 8)} · 급수 ${red(c.building_grade, 4)}`)
  console.log(`   주소 ${red(c.address, 6)} · 사용승인일 ${red(c.use_approval_date, 10)} · 대표자ID ${c.owner_id ? '있음' : '(빈)'} · 관리자ID ${c.manager_contact_id ? '있음' : '(빈)'}`)
  console.log(`   점검 ${inspCnt ?? 0}건 · 소방시설 ${facCnt ?? 0}행 · 건물 ${bs?.length ?? 0}동`)
  for (const b of (bs ?? []) as Record<string, unknown>[]) {
    console.log(`     · ${red(b.building_name, 8)} 활성=${b.is_active} 연면적=${red(b.total_area, 8)} 층=${red(b.floors_above, 3)} 용도=${red(b.purpose, 6)}`)
    console.log(`       구조=${red(b.structure, 8)} 지붕=${red(b.roof, 6)} 높이=${red(b.height_m, 5)} 수신기=${red(b.receiver_location, 6)} 건축면적=${red(b.building_area, 8)} 허가일=${red(b.permit_date, 10)}`)
  }
}
console.log(`\n후보 ${cs?.length ?? 0}건`)
