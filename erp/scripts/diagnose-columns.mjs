import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ryuozdhnilfjlahorizh.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dW96ZGhuaWxmamxhaG9yaXpoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU4ODYzMSwiZXhwIjoyMDk3MTY0NjMxfQ.0HDCXsF-z2GTEhi8n50DAUOmMZrnO22_qFkMmBafunI'

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
