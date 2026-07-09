import { createClient } from '@supabase/supabase-js'

import { SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY } from './_env.mjs'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 마이그레이션별 생성 테이블 전체 목록
const tablesByMigration = {
  '001': ['departments', 'profiles', 'documents', 'document_approvers', 'document_attachments', 'leave_balances', 'leaves', 'notifications', 'push_subscriptions', 'activity_logs'],
  '002': ['holidays', 'customers', 'customer_contacts', 'inspections', 'inspection_steps', 'inspection_reports'],
  '005': ['inspection_plans', 'inspection_plan_items'],
  '006': ['inspection_status_log'],
  '007': ['inspection_report_status'],
  '008': ['inspection_defects', 'action_plans', 'action_complete_reports', 'action_plan_status'],
  '009': ['bills', 'tax_invoices'],
  '011': ['schedules', 'todos'],
  '012': ['messages'],
  '013': ['quotes', 'orders'],
  '014': ['account_codes', 'vouchers', 'voucher_lines'],
  '015': ['payrolls'],
  '016': ['mobile_documents'],
  '020': ['buildings'],
  '024': ['inspection_sheets', 'inspection_sheet_items'],
}

for (const [mig, tables] of Object.entries(tablesByMigration)) {
  const results = []
  for (const t of tables) {
    const { error } = await admin.from(t).select('*').limit(0)
    results.push(error ? `❌ ${t}` : `✅ ${t}`)
  }
  console.log(`[${mig}] ${results.join('  ')}`)
}
