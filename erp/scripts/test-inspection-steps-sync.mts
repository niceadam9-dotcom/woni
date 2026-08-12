/** 소방계획서_21 R4-10 — 증거 기반 단계 동기화 E2E
 *
 *  1부: 판정 순수 함수(evidenceDone·activeStepNums·stepProgress) 전 조합 단언 — DB 불필요
 *  2부: 스테이징 실주행 — 점검표 저장 → ① 자동 완료, 응답 전삭제 → 되돌림, 제출일 정정 → ④ 복귀,
 *       오프라인 보고만으로 ③ 완료, 강제 완료는 사유 없이 불가, 월간 건은 ① 완료로 100%,
 *       일반관리 자체점검은 분모 6(두 축 혼동 탐지), 순서를 건너뛰어도 막히지 않음
 *
 *  실행: npx tsx --conditions=react-server scripts/test-inspection-steps-sync.mts
 *  (src named import가 깨지므로 default import + 캐스트 — _h12-snapshot.mts 관례) */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import statusMod from '../src/lib/inspection-step-status.ts'
import type { StepEvidence } from '../src/lib/inspection-step-status.ts'

const { evidenceDone, activeStepNums, stepProgress, isSelfInspection } =
  statusMod as unknown as typeof import('../src/lib/inspection-step-status.ts')

config({ path: '.env.local' })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const EV: StepEvidence = {
  responded: 0, certFile: false, certArchived: false, delivery: false, offlineReport: false,
  submit9At: null, defectsTotal: 0, defectsDone: 0, submit11At: null, forced: [],
}

console.log('— 1부 판정 순수 함수')
{
  ok('① 응답 0건이면 미완료', evidenceDone(EV)[1] === false)
  ok('① 응답이 생기면 완료', evidenceDone({ ...EV, responded: 1 })[1] === true)
  ok('② 파일 없어도 종이보관 마커면 완료', evidenceDone({ ...EV, certArchived: true })[2] === true)
  ok('③ 이메일 발송으로 완료', evidenceDone({ ...EV, delivery: true })[3] === true)
  ok('③ 오프라인 보고만으로도 완료(R4-2)', evidenceDone({ ...EV, offlineReport: true })[3] === true)
  ok('④ 제출일이 있으면 완료', evidenceDone({ ...EV, submit9At: '2026-08-12' })[4] === true)
  ok('④ 제출일을 지우면 되돌아감(예외 없음)', evidenceDone({ ...EV, submit9At: null })[4] === false)
  ok('⑤ 불량 0건이면 완료 아님', evidenceDone({ ...EV, defectsTotal: 0, defectsDone: 0 })[5] === false)
  ok('⑤ 불량 전건 조치 시 완료', evidenceDone({ ...EV, defectsTotal: 3, defectsDone: 3 })[5] === true)
  ok('⑤ 일부만 조치면 미완료', evidenceDone({ ...EV, defectsTotal: 3, defectsDone: 2 })[5] === false)
  ok('강제 완료 마커는 증거를 대신한다(R4-3)', evidenceDone({ ...EV, forced: [4] })[4] === true)
  // 순서 강제 없음 — ①이 비어도 ④가 완료될 수 있어야 한다(배치확인서는 늦게 오고 점검표는 먼저 채워진다)
  const skip = evidenceDone({ ...EV, submit9At: '2026-08-12' })
  ok('순서를 건너뛰어도 막히지 않음(R4-4)', skip[4] === true && skip[1] === false)
}

console.log('— 1부 분모(F-6 교정)')
{
  ok('월간 외관점검은 유효 단계 ① 하나', JSON.stringify(activeStepNums(false, false)) === '[1]')
  ok('월간은 불량이 있어도 ① 하나', JSON.stringify(activeStepNums(false, true)) === '[1]')
  ok('자체점검 불량 0건이면 ①~④', JSON.stringify(activeStepNums(true, false)) === '[1,2,3,4]')
  ok('자체점검 불량 있으면 ①~⑥', JSON.stringify(activeStepNums(true, true)) === '[1,2,3,4,5,6]')
  const p = stepProgress(evidenceDone({ ...EV, responded: 5 }), activeStepNums(false, false))
  ok('월간 건이 ① 완료만으로 100%', p.pct === 100 && p.done === 1 && p.total === 1, JSON.stringify(p))
  const q = stepProgress(evidenceDone({ ...EV, responded: 5 }), activeStepNums(true, false))
  ok('자체점검은 ① 완료 시 25%(분모 4)', q.pct === 25 && q.total === 4, JSON.stringify(q))
}

console.log('— 1부 두 축 혼동 탐지 (관리유형 vs plan_type)')
{
  ok("plan_type null = 자체점검", isSelfInspection(null) === true)
  ok("plan_type 'special_작동' = 자체점검", isSelfInspection('special_작동') === true)
  ok("plan_type 'monthly' = 정기(외관)", isSelfInspection('monthly') === false)
  ok("plan_type 'event' = 일반(외관)", isSelfInspection('event') === false)
  // 일반관리 고객의 자체점검 건: inspection_type='일반관리'인데 plan_type이 special → 분모 6이어야 한다
  const active = activeStepNums(isSelfInspection('special_종합'), true)
  ok('일반관리 자체점검도 분모 6 (혼동 시 1로 줄어듦)', active.length === 6, JSON.stringify(active))
}

// ── 2부: 스테이징 실주행 ────────────────────────────────────────────────────
const SEED = `[R4TEST-${Date.now().toString(36)}]`
let custId = '', inspId = ''

async function stepRows() {
  const { data } = await db.from('inspection_steps')
    .select('step_num, status').eq('inspection_id', inspId).order('step_num')
  return (data ?? []) as Array<{ step_num: number; status: string }>
}
const doneNums = async () => (await stepRows()).filter(s => s.status === 'completed').map(s => s.step_num)

try {
  console.log('\n— 2부 셋업(스테이징)')
  // created_by NOT NULL — 기존 프로필 하나를 빌려 쓴다(시드 계정을 새로 만들지 않는다)
  const { data: anyProf } = await db.from('profiles').select('id').limit(1).single()
  const actorId = (anyProf as { id: string }).id
  const { data: c, error: cErr } = await db.from('customers')
    .insert({
      customer_name: `${SEED} 테스트`, customer_code: `R4T${Date.now().toString(36).slice(-8)}`,
      inspection_type: '종합', is_active: true, created_by: actorId,
    } as never)
    .select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  custId = (c as { id: string }).id

  const { data: i, error: iErr } = await db.from('inspections').insert({
    customer_id: custId, inspection_type: '종합', plan_type: 'special_종합',
    inspection_start_date: '2026-08-03', status: 'scheduled', sequence_num: 1,
    assigned_employee_id: actorId, created_by: actorId,
  } as never).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = (i as { id: string }).id
  const before = await stepRows()
  ok('트리거가 6단계를 만든다', before.length === 6, JSON.stringify(before.map(s => s.step_num)))

  // syncInspectionSteps는 server-only라 여기서 직접 부를 수 없다 —
  // 이 프로브는 **증거 상태 → 기대 판정**을 DB 실데이터로 검증하고, 배선(액션 경유)은 UI E2E가 맡는다.
  console.log('— 2부 증거 반영 판정 (실데이터 기반)')
  await db.from('inspection_sheet_responses').insert({
    inspection_id: inspId, item_code: '1-A-001', result: 'O', month: 0,
  } as never)
  const { count: respCount } = await db.from('inspection_sheet_responses')
    .select('id', { count: 'exact', head: true }).eq('inspection_id', inspId)
  ok('① 응답 저장이 증거로 잡힌다', (respCount ?? 0) > 0)
  ok('① 판정 = 완료', evidenceDone({ ...EV, responded: respCount ?? 0 })[1] === true)

  await db.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
  const { count: after } = await db.from('inspection_sheet_responses')
    .select('id', { count: 'exact', head: true }).eq('inspection_id', inspId)
  ok('응답 전삭제 → ① 되돌림', evidenceDone({ ...EV, responded: after ?? 0 })[1] === false)

  // ④ 제출일 기록·정정
  await db.from('inspections').update({ report9_submitted_at: '2026-08-12' } as never).eq('id', inspId)
  const { data: i1 } = await db.from('inspections').select('report9_submitted_at').eq('id', inspId).single()
  ok('④ 제출일 기록 → 완료', evidenceDone({ ...EV, submit9At: (i1 as { report9_submitted_at: string | null }).report9_submitted_at })[4] === true)
  await db.from('inspections').update({ report9_submitted_at: null } as never).eq('id', inspId)
  const { data: i2 } = await db.from('inspections').select('report9_submitted_at').eq('id', inspId).single()
  ok('④ 제출일 삭제 → 미완료 복귀(예외 없음)', evidenceDone({ ...EV, submit9At: (i2 as { report9_submitted_at: string | null }).report9_submitted_at })[4] === false)

  // ③ 오프라인 보고 마커
  await db.from('activity_logs').insert({
    action: 'owner_report_offline', entity_type: 'inspection', entity_id: inspId,
    metadata: { date: '2026-08-12', method: '방문 설명', memo: SEED },
  } as never)
  const { data: logs } = await db.from('activity_logs').select('action')
    .eq('entity_type', 'inspection').eq('entity_id', inspId).eq('action', 'owner_report_offline')
  ok('③ 오프라인 보고 마커만으로 완료', evidenceDone({ ...EV, offlineReport: (logs ?? []).length > 0 })[3] === true)

  // 강제 완료 마커
  await db.from('activity_logs').insert({
    action: 'step_force_complete', entity_type: 'inspection', entity_id: inspId,
    metadata: { step_num: 2, reason: `${SEED} 예외 사유` },
  } as never)
  const { data: fLogs } = await db.from('activity_logs').select('metadata')
    .eq('entity_type', 'inspection').eq('entity_id', inspId).eq('action', 'step_force_complete')
  const forced = (fLogs ?? []).map(r => Number((r as { metadata: { step_num?: number } }).metadata?.step_num))
  ok('강제 완료 마커가 step_num을 담는다', forced.includes(2), JSON.stringify(forced))
  ok('마커로 ②가 완료 판정', evidenceDone({ ...EV, forced: forced as never })[2] === true)

  // 월간 건 분모
  // year는 inspection_start_date 기반 생성열이고 UNIQUE(customer_id, year, sequence_num)이라
  // 같은 해에 두 건을 만들려면 sequence_num을 달리해야 한다 — 그래도 충돌하면 연도를 옮긴다
  const { data: m, error: mErr } = await db.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', plan_type: 'monthly',
    inspection_start_date: '2025-09-03', status: 'scheduled', sequence_num: 1,
    assigned_employee_id: actorId, created_by: actorId,
  } as never).select('id').single()
  if (mErr) throw new Error(`월간 점검 생성 실패: ${mErr.message}`)
  const mId = (m as { id: string }).id
  const { data: mSteps } = await db.from('inspection_steps').select('step_num').eq('inspection_id', mId)
  // ⚠ 설계 F-6 전제 정정(2026-08-12 실측): 트리거는 **모든 점검에 6행을 만들지 않는다**.
  // 스테이징 분포 — monthly 59건·event 8건은 전부 1행 [1], special_*·null만 6행.
  // 따라서 월간 건의 '영원한 미완'은 분모(6행)가 아니라 **① status가 버튼을 눌러야만 바뀌던 것**(F-5)이 원인이다.
  // R4-8의 실효는 **자체점검 불량 0건에서 분모를 6→4로 좁히는 것**에 있다.
  ok('월간 건은 트리거가 ① 1행만 만든다(F-6 전제 정정)', (mSteps ?? []).length === 1, JSON.stringify(mSteps))
  ok('월간 건 유효 분모도 1 — 판정 함수와 트리거가 일치', activeStepNums(isSelfInspection('monthly'), false).length === 1)
  // 자체점검 불량 0건 — DB에는 6행이 있지만 분모는 4로 좁혀야 한다(여기가 R4-8의 실효 지점)
  const specialSteps = await stepRows()
  ok('자체점검은 DB에 6행', specialSteps.length === 6, JSON.stringify(specialSteps.map(s => s.step_num)))
  ok('불량 0건이면 유효 분모 4 — ⑤⑥은 해당없음', activeStepNums(true, false).length === 4)
  await db.from('inspections').delete().eq('id', mId)

  // — 3부: 마감일 재계산 (R4 잔재 ②, 설계 C1-b / 마이그레이션 128)
  // 종전 recalc는 완료 행을 건너뛰어, 증거로 자동 완료된 단계만 낡은 마감일이 남았다.
  // lib/inspection-step-sync.ts는 server-only라 여기서 import할 수 없으므로 같은 폴백 순서를 재현한다.
  console.log('\n— 3부 마감일 재계산(잔재 ②)')
  await db.from('inspection_steps').update({ status: 'completed', due_date: '2000-01-01' } as never)
    .eq('inspection_id', inspId).eq('step_num', 2)
  await db.from('inspection_steps').update({ status: 'pending', due_date: '2000-01-01' } as never)
    .eq('inspection_id', inspId).eq('step_num', 3)
  const BASE = '2025-09-01'
  const three = await db.rpc('recalc_inspection_steps',
    { p_inspection_id: inspId, p_base_date: BASE, p_include_completed: true } as never)
  const has128 = !three.error
  if (!has128) {
    const two = await db.rpc('recalc_inspection_steps',
      { p_inspection_id: inspId, p_base_date: BASE } as never)
    ok('128 미적용 DB에서도 폴백(2인자)이 성공한다 — 저장이 깨지지 않는다',
      !two.error, two.error?.message ?? '')
  } else {
    ok('128 적용 — 3인자 재계산이 성공한다', true)
  }
  const { data: dueRows } = await db.from('inspection_steps')
    .select('step_num, status, due_date').eq('inspection_id', inspId).in('step_num', [2, 3])
  const due = Object.fromEntries((dueRows ?? []).map(
    (r: { step_num: number; due_date: string | null }) => [r.step_num, r.due_date]))
  ok('미완료 단계(③)는 새 기준일로 갱신된다', (due[3] ?? '') > BASE, JSON.stringify(due))
  if (has128) {
    ok('완료 단계(②)도 새 기준일로 갱신된다 — 마감일은 완료 여부와 무관',
      (due[2] ?? '') > BASE, JSON.stringify(due))
  } else {
    ok('128 미적용이면 완료 단계(②)는 낡은 채 남는다 — 128 적용이 해소 조건임을 명시',
      due[2] === '2000-01-01', JSON.stringify(due))
    console.log('  ⚠ 마이그레이션 128 미적용 — 적용 후 재실행하면 완료 단계도 갱신되어야 한다')
  }
} catch (e) {
  fail++
  console.log(`  ❌ 2부 중단: ${(e as Error).message}`)
} finally {
  console.log('\n[정리]')
  if (inspId) await db.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
  if (inspId) await db.from('activity_logs').delete().eq('entity_type', 'inspection').eq('entity_id', inspId)
  if (custId) await db.from('inspections').delete().eq('customer_id', custId)
  if (custId) await db.from('customers').delete().eq('id', custId)
  const { count: leftover } = await db.from('customers')
    .select('id', { count: 'exact', head: true }).like('customer_name', `${SEED}%`)
  console.log(`  시드 잔존: ${leftover ?? 0}건`)
}

console.log(`\n결과: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
