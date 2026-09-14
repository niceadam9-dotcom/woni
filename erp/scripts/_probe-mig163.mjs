// 읽기 전용 — 마이그163(agency_applies/agency_grade) 및 160(is_primary) 적용 여부 실측
import { readFileSync } from 'node:fs'
const envFile = process.argv[2] ?? '.env.local'
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
console.log(`DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL} (${envFile})`)
for (const [tbl, col] of [['customers', 'agency_applies'], ['customers', 'agency_grade'], ['buildings', 'is_primary']]) {
  const { error } = await admin.from(tbl).select(col).limit(1)
  console.log(`  ${tbl}.${col}: ${error ? `MISSING (${error.code}) ${error.message.slice(0, 70)}` : 'OK'}`)
}
// 실제 소방계획서 고객 select 전문을 그대로 재현
const SEL = 'customer_name, address, use_approval_date, fire_station, inspection_type, plan_anchor_date, contract_date, '
  + 'building_grade, manager_selected_at, insurance_joined, insurance_company, insurance_period, '
  + 'insurance_amount_person, insurance_amount_property, op_hours_weekday, op_hours_holiday, '
  + 'headcount_worker, headcount_resident, headcount_max, '
  + 'agency_applies, agency_grade, '
  + 'rep_role, manager_license_grade, manager_edu_date, manager_contact_id'
const { data: any1 } = await admin.from('customers').select('id, customer_name').eq('customer_name', '지평리56').limit(1)
const target = any1?.[0]
console.log(`  대상 고객: ${target ? `${target.customer_name} ${target.id}` : '(없음 — 이 DB엔 지평리56 없음)'}`)
if (target) {
  const { data, error } = await admin.from('customers').select(SEL).eq('id', target.id).single()
  console.log(`  소방계획서 고객 조회: ${error ? `FAIL (${error.code}) ${error.message.slice(0, 90)}` : `OK (cust=${data ? 'not null' : 'NULL'})`}`)
}
