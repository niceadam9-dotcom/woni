/** customer_contacts 실컬럼 확인 (값 안 찍음) — 추측으로 insert 하면 조용히 실패한다. */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: process.argv[2] ?? '.env.local' })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
for (const t of ['customer_contacts']) {
  const { data, error } = await db.from(t).select('*').limit(1)
  if (error) { console.log(`${t}: ${error.message}`); continue }
  console.log(`${t} (${data?.length ? Object.keys(data[0] as object).length : 0}컬럼)`)
  if (data?.length) console.log(Object.keys(data[0] as object).join(', '))
  else console.log('(행이 없어 컬럼을 못 봄)')
}
/* 강순기_2의 현재 상태 */
const { data: c } = await db.from('customers')
  .select('id, customer_name, owner_id, manager_contact_id').eq('customer_name', '강순기 건물_2').single()
console.log(`\n강순기 건물_2: ${String(c?.id).slice(0, 8)}… owner_id=${c?.owner_id ?? '(빈)'} manager_contact_id=${c?.manager_contact_id ?? '(빈)'}`)
const { data: ex } = await db.from('customer_contacts').select('id, name, role').eq('customer_id', c?.id as string)
console.log(`기존 연락처 ${ex?.length ?? 0}건`)
const { data: b } = await db.from('buildings')
  .select('id, building_name, receiver_location, structure, roof, height_m').eq('customer_id', c?.id as string)
for (const x of (b ?? []) as Record<string, unknown>[]) {
  console.log(`건물 ${String(x.id).slice(0, 8)}… 수신기=${x.receiver_location ?? '(빈)'} 구조=${x.structure ?? '(빈)'} 지붕=${x.roof ?? '(빈)'} 높이=${x.height_m ?? '(빈)'}`)
}
