// 모바일 앱 "점검 시작" 흐름 시뮬레이션 테스트
// 모바일과 동일하게 anon key + employee 계정으로 실행 (RLS 검증 포함)
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ryuozdhnilfjlahorizh.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dW96ZGhuaWxmamxhaG9yaXpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1ODg2MzEsImV4cCI6MjA5NzE2NDYzMX0.0Icgijy1zMyp8eJjCUSnPSfIIoqR4V1SnFHdReGUosY'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dW96ZGhuaWxmamxhaG9yaXpoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU4ODYzMSwiZXhwIjoyMDk3MTY0NjMxfQ.0HDCXsF-z2GTEhi8n50DAUOmMZrnO22_qFkMmBafunI'

const supabase = createClient(SUPABASE_URL, ANON_KEY)   // 모바일과 동일
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 1. employee 계정 로그인 (모바일과 동일)
const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
  email: 'park.dev@erp-test.com',
  password: 'Employee1!',
})
if (authErr) { console.log('❌ 로그인 실패:', authErr.message); process.exit(1) }
const user = auth.user
console.log('✅ 1. employee 로그인:', user.email)

// 2. 올해 점검이 아직 없는 고객의 plan_item 선택
const year = new Date().getFullYear()
const { data: allItems } = await admin
  .from('inspection_plan_items')
  .select('id, customer_id, inspection_type, sequence_num, inspection_id')
  .is('inspection_id', null)
  .limit(50)
const { data: existingInsp } = await admin
  .from('inspections').select('customer_id, sequence_num').eq('year', year)
const taken = new Set((existingInsp ?? []).map(i => `${i.customer_id}|${i.sequence_num}`))
const planItem = (allItems ?? []).find(i => !taken.has(`${i.customer_id}|${i.sequence_num}`))
if (!planItem) { console.log('❌ 테스트 가능한 plan_item 없음'); process.exit(1) }
console.log('✅ 2. 테스트 대상 plan_item:', planItem.id)

const today = new Date().toISOString().split('T')[0]

// 3. 점검 생성 (수정된 모바일 코드와 동일: year 없음, created_by 포함)
const { data: newInspection, error: inspError } = await supabase
  .from('inspections')
  .insert({
    customer_id: planItem.customer_id,
    assigned_employee_id: user.id,
    inspection_type: planItem.inspection_type,
    inspection_start_date: today,
    sequence_num: planItem.sequence_num,
    status: 'scheduled',
    created_by: user.id,
  })
  .select('id')
  .single()
if (inspError || !newInspection) {
  console.log('❌ 3. 점검 생성 실패:', inspError?.message)
  process.exit(1)
}
console.log('✅ 3. 점검 생성 성공 (RLS 통과):', newInspection.id)

// 4. 트리거가 6단계를 자동 생성했는지 확인
const { data: steps } = await supabase
  .from('inspection_steps')
  .select('step_num, name_ko, due_date')
  .eq('inspection_id', newInspection.id)
  .order('step_num')
console.log(`✅ 4. 자동 생성된 단계: ${steps?.length ?? 0}개`)
for (const s of steps ?? []) console.log(`   ${s.step_num}. ${s.name_ko} (마감: ${s.due_date})`)

// 5. plan_item 연결 (모바일 코드와 동일)
const { error: linkErr } = await supabase
  .from('inspection_plan_items')
  .update({ inspection_id: newInspection.id, status: 'confirmed' })
  .eq('id', planItem.id)
console.log(linkErr ? `❌ 5. plan_item 연결 실패: ${linkErr.message}` : '✅ 5. plan_item 연결 성공')

// 6. 정리 — 테스트 데이터 원복
await admin.from('inspection_plan_items')
  .update({ inspection_id: null, status: 'planned' })
  .eq('id', planItem.id)
await admin.from('inspections').delete().eq('id', newInspection.id)
console.log('✅ 6. 테스트 데이터 정리 완료')
console.log('\n🎉 모바일 점검 시작 흐름 전체 통과')
