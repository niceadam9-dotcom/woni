/** 운영 1회성 정정 — 하늘촌(C006) 점검일자 09-18 신고 건.
 *  등록 당시(구 코드) 생성기가 09-21로 밀고 시작도 안 했다 → 새 규칙(applyPastAnchorInspection)을
 *  **그 코드 그대로** 운영에 적용한다(수기 SQL 금지 — 경로가 다르면 마감일·최초점검 판정이 갈라진다).
 *  실행: SUPA_URL·SUPA_KEY 환경변수(운영)를 주고 npx tsx scripts/_fix-haneulchon-0920.mts
 */
import { createClient } from '@supabase/supabase-js'
import start from '../src/lib/inspection-start.ts'
const { applyPastAnchorInspection } = start as unknown as typeof import('../src/lib/inspection-start.ts')

const URL = process.env.SUPA_URL, KEY = process.env.SUPA_KEY
if (!URL || !KEY) { console.error('SUPA_URL/SUPA_KEY 필요'); process.exit(1) }
if (!URL.includes('ryuoz')) { console.error(`운영(ryuoz…)이 아니다: ${URL}`); process.exit(1) }

const raw = createClient(URL, KEY, { auth: { persistSession: false } })
const admin = raw as never as Parameters<typeof applyPastAnchorInspection>[0]

const CUST = '792f3781-ea97-4394-9b53-f2c39ebb8098'  // 하늘촌 C006
const ACTOR = 'c64f8ba2-b56f-4e44-9869-946d459f0b3c' // 이주성(등록자·담당)
const DATE = '2026-09-18'

// 전제 확인 — 이미 시작됐거나 고객이 다르면 손대지 않는다
const { data: cust } = await raw.from('customers').select('customer_name, plan_anchor_date').eq('id', CUST).single()
console.log('고객:', JSON.stringify(cust))
if (!cust || cust.plan_anchor_date !== DATE) { console.error('전제 불일치 — 중단'); process.exit(1) }
const { data: before } = await raw.from('inspection_plan_items')
  .select('id, plan_type, planned_date, scheduled_date, inspection_id')
  .eq('customer_id', CUST).in('plan_type', ['special_종합', 'special_작동']).order('planned_date')
console.log('적용 전:', JSON.stringify(before, null, 1))
if ((before ?? []).some(i => i.inspection_id)) { console.error('이미 시작된 회차 존재 — 중단'); process.exit(1) }

const res = await applyPastAnchorInspection(admin, CUST, DATE, ACTOR)
console.log('결과:', JSON.stringify(res))

const { data: after } = await raw.from('inspection_plan_items')
  .select('id, plan_type, planned_date, scheduled_date, inspection_id, status')
  .eq('customer_id', CUST).in('plan_type', ['special_종합', 'special_작동']).order('planned_date')
console.log('적용 후:', JSON.stringify(after, null, 1))
const { data: insp } = await raw.from('inspections')
  .select('id, inspection_start_date, status, assigned_employee_id').eq('customer_id', CUST)
console.log('inspections:', JSON.stringify(insp, null, 1))
const { data: steps } = await raw.from('inspection_steps')
  .select('step_num, due_date, status').eq('inspection_id', insp?.[0]?.id ?? '').order('step_num')
console.log('steps:', JSON.stringify(steps))
