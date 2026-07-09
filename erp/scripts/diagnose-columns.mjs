import { createClient } from '@supabase/supabase-js'

import { SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY } from './_env.mjs'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ALTER 계열 마이그레이션 검증: 테이블.컬럼 존재 여부
const checks = [
  ['003', 'customers', 'assigned_employee_id'],
  ['017', 'customers', 'use_approval_date'],
  ['018', 'customers', 'region'],
  ['021', 'customers', 'zipcode'],
  ['022', 'buildings', 'zipcode'],
  ['025(정책)', 'inspection_plan_items', 'scheduled_date'],
]

for (const [mig, table, col] of checks) {
  const { error } = await admin.from(table).select(col).limit(0)
  console.log(`[${mig}] ${table}.${col}: ${error ? '❌ ' + error.message : '✅'}`)
}
