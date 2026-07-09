import { createClient } from '@supabase/supabase-js'

import { SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY } from './_env.mjs'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 1. 보고서 제출현황 쿼리
const q1 = await admin
  .from('inspection_plan_items')
  .select(`
    id, plan_id, customer_id, inspection_type, sequence_num,
    scheduled_date, assigned_employee_id, status,
    customers:customer_id ( customer_name, customer_code, address ),
    profiles:assigned_employee_id ( name ),
    inspection_plans:plan_id ( year, month ),
    inspection_report_status (
      inspection_completed_at, notification_date,
      notification_due_date, submission_deadline,
      sent_at, received_at, returned_at,
      fire_station_submitted, fee_billed
    )
  `)
  .neq('status', 'cancelled')
  .limit(5)
console.log('=== 1. 보고서 제출현황 ===')
console.log('error:', q1.error?.message ?? 'none')
console.log('rows:', q1.data?.length ?? 0)

// 2. 이행계획서 등록 쿼리
const q2 = await admin
  .from('action_plans')
  .select(`
    id, completion_target_date, submitted_at, sent_at, plan_file_url,
    created_at, updated_at,
    inspections:inspection_id (
      id, inspection_type, sequence_num, year,
      customers:customer_id ( customer_name, customer_code ),
      profiles:assigned_employee_id ( name )
    ),
    action_plan_status ( sent_at, fire_station_submitted_at, defect_certificate_count ),
    action_complete_reports ( id, completed_at, submitted_at )
  `)
  .limit(5)
console.log('=== 2. 이행계획서 등록 ===')
console.log('error:', q2.error?.message ?? 'none')
console.log('rows:', q2.data?.length ?? 0)

// 3. 이행계획 제출현황 쿼리 (수정판: plan_items 경유)
const q3 = await admin
  .from('action_plans')
  .select(`
    id, inspection_id, plan_file_url, completion_target_date, submitted_at, sent_at,
    created_at, updated_at,
    inspections:inspection_id (
      id, inspection_type, sequence_num,
      customers:customer_id ( customer_name, customer_code ),
      profiles:assigned_employee_id ( name ),
      inspection_plan_items ( inspection_report_status ( inspection_completed_at ) )
    ),
    action_plan_status ( sent_at, fire_station_submitted_at, defect_certificate_count ),
    action_complete_reports ( id, completed_at, submitted_at )
  `)
  .limit(5)
console.log('=== 3. 이행계획 제출현황 (plans) ===')
console.log('error:', q3.error?.message ?? 'none')
console.log('rows:', q3.data?.length ?? 0)

const q4 = await admin
  .from('inspections')
  .select(`
    id, inspection_type, sequence_num,
    customers:customer_id ( customer_name, customer_code ),
    profiles:assigned_employee_id ( name ),
    inspection_plan_items ( inspection_report_status ( inspection_completed_at ) ),
    inspection_defects ( id )
  `)
  .not('inspection_defects', 'is', null)
  .limit(5)
console.log('=== 3b. 이행계획 제출현황 (작성대기) ===')
console.log('error:', q4.error?.message ?? 'none')
console.log('rows:', q4.data?.length ?? 0)
if (q4.data?.[0]) console.log('sample:', JSON.stringify(q4.data[0], null, 2).slice(0, 600))
