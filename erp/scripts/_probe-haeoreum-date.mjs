// 읽기 전용 — 스테이징 유사 이름·9/18 전후 계획/점검 변화 탐색
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

for (const pat of ['%오름%', '%하늘촌%', '%해%']) {
  const { data } = await admin.from('customers').select('customer_name, customer_code, is_active').ilike('customer_name', pat).limit(20)
  console.log(pat, '→', JSON.stringify(data))
}

const { data: items } = await admin.from('inspection_plan_items')
  .select('id, customer_id, plan_type, inspection_sub_type, status, planned_date, scheduled_date, inspection_id, updated_at, customers(customer_name)')
  .gte('updated_at', '2026-09-17')
  .order('updated_at', { ascending: false })
  .limit(20)
console.log('\n9/17 이후 갱신 계획 항목:', JSON.stringify(items, null, 1))

const { data: insp } = await admin.from('inspections')
  .select('id, customer_id, inspection_type, inspection_start_date, status, created_at, customers(customer_name)')
  .gte('created_at', '2026-09-17')
  .order('created_at', { ascending: false })
  .limit(20)
console.log('\n9/17 이후 생성 inspections:', JSON.stringify(insp, null, 1))
