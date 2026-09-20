/** 운영 1회성 정정 — 해오름어린이집(C005) 점검일 09-12 → 09-18 (2026-09-20 사용자 지시).
 *  1단계가 이미 완료라 화면 확정 경로(confirmPlanItemStageOneAction)는 가드로 막힌다 —
 *  같은 정본 조각(resolveStepDates → 항목 갱신 → syncInspectionStepDates → syncInspectionVisitDate)을
 *  그대로 수행한다(plan-date-actions.ts:80~105와 동일 순서). 고객 「점검일자」 칸(plan_anchor_date)도
 *  09-10 → 09-18로 함께 맞춘다(manual=false·승인일 축이라 연간 재계산은 촉발되지 않는다).
 *  실행: SUPA_URL·SUPA_KEY(운영) 주고 npx tsx scripts/_fix-haeoreum-0920.mts
 */
import { createClient } from '@supabase/supabase-js'
import start from '../src/lib/inspection-start.ts'
import steps from '../src/lib/plan-step-dates.ts'
const { syncInspectionStepDates, syncInspectionVisitDate } = start as unknown as typeof import('../src/lib/inspection-start.ts')
const { resolveStepDates } = steps as unknown as typeof import('../src/lib/plan-step-dates.ts')

const URL = process.env.SUPA_URL, KEY = process.env.SUPA_KEY
if (!URL || !KEY) { console.error('SUPA_URL/SUPA_KEY 필요'); process.exit(1) }
if (!URL.includes('ryuoz')) { console.error(`운영(ryuoz…)이 아니다: ${URL}`); process.exit(1) }

const raw = createClient(URL, KEY, { auth: { persistSession: false } })
const admin = raw as never as Parameters<typeof syncInspectionStepDates>[0]

const CUST = 'd6cafca6-6854-4706-b5de-8f5609fe4410'  // 해오름어린이집 C005
const ITEM = '05eb8570-bbcf-4a16-930c-88c29f4aaa55'  // 1차 작동 (scheduled 09-12)
const INSP = 'ccbd46ff-ba7e-4b04-93cf-c82ae5a5a9d7'
const DATE = '2026-09-18'

// 전제 확인
const { data: item } = await raw.from('inspection_plan_items')
  .select('scheduled_date, inspection_id').eq('id', ITEM).single()
console.log('적용 전 항목:', JSON.stringify(item))
if (!item || item.inspection_id !== INSP || item.scheduled_date !== '2026-09-12') {
  console.error('전제 불일치 — 중단'); process.exit(1)
}

const { dates, error } = await resolveStepDates(admin, DATE)
if (error || !dates) { console.error('마감일 산식 실패:', error); process.exit(1) }
console.log('새 1~6단계 마감일:', dates.join(' '))

const { error: updErr } = await raw.from('inspection_plan_items').update({
  scheduled_date: DATE,
  step1_date: dates[0], step2_date: dates[1], step3_date: dates[2],
  step4_date: dates[3], step5_date: dates[4], step6_date: dates[5],
}).eq('id', ITEM)
if (updErr) { console.error('항목 갱신 실패:', updErr.message); process.exit(1) }

await syncInspectionStepDates(admin, INSP, dates)
await syncInspectionVisitDate(admin, INSP, DATE)
await raw.from('customers').update({ plan_anchor_date: DATE }).eq('id', CUST)

const { data: after } = await raw.from('inspection_plan_items')
  .select('scheduled_date, step1_date, step6_date').eq('id', ITEM).single()
const { data: insp } = await raw.from('inspections')
  .select('inspection_start_date, inspection_end_date, status').eq('id', INSP).single()
const { data: st } = await raw.from('inspection_steps')
  .select('step_num, due_date, status').eq('inspection_id', INSP).order('step_num')
const { data: cust } = await raw.from('customers').select('plan_anchor_date').eq('id', CUST).single()
console.log('적용 후 항목:', JSON.stringify(after))
console.log('적용 후 점검:', JSON.stringify(insp))
console.log('적용 후 단계:', JSON.stringify(st))
console.log('적용 후 점검일자(고객):', JSON.stringify(cust))
