import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ryuozdhnilfjlahorizh.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dW96ZGhuaWxmamxhaG9yaXpoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU4ODYzMSwiZXhwIjoyMDk3MTY0NjMxfQ.0HDCXsF-z2GTEhi8n50DAUOmMZrnO22_qFkMmBafunI'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const tables = [
  'inspection_report_status',
  'action_plans',
  'action_plan_status',
  'action_complete_reports',
  'inspection_defects',
  'stage_reports',
  'inspection_sheets',
  'inspection_steps',
]

for (const t of tables) {
  const { data, error } = await admin.from(t).select('*').limit(1)
  console.log(`${t}: ${error ? 'ERROR - ' + error.message : 'OK (' + (data?.length ?? 0) + ' sample rows)'}`)
}
