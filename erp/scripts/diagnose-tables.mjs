import { createClient } from '@supabase/supabase-js'

import { SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY } from './_env.mjs'

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
