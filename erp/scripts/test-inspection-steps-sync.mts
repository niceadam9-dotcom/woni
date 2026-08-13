/** 소방계획서_21 R4-10 — 증거 기반 단계 동기화 E2E
 *
 *  1부: 판정 순수 함수(evidenceDone·activeStepNums·stepProgress·resolveForcedSteps·isForced5Stale) 단언 — DB 불필요
 *  2부: 스테이징 실주행 — **syncInspectionSteps를 실제로 호출**하고 inspection_steps.status를 읽는다.
 *       점검표 저장 → ① 완료, 응답 전삭제 → 되돌림, 제출일 정정 → ④ 복귀, 순서 건너뛰기 허용,
 *       오프라인 보고만으로 ③ 완료, 사유 완료·철회·재확정, ⑤ 강제 완료 뒤 새 불량이면 무효
 *       (종전 판에서는 sync를 부르지 않고 순수 함수에 손으로 값을 넣어 단언했다 — 독립 검증 R4-10 지적)
 *  3부: 마감일 재계산 폴백(마이그레이션 128 유무 분기)
 *
 *  실행: npx tsx --conditions=react-server scripts/test-inspection-steps-sync.mts
 *  (src named import가 깨지므로 default import + 캐스트 — _h12-snapshot.mts 관례) */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import statusMod from '../src/lib/inspection-step-status.ts'
import syncMod from '../src/lib/inspection-step-sync.ts'
import type { StepEvidence } from '../src/lib/inspection-step-status.ts'

const { evidenceDone, activeStepNums, stepProgress, isSelfInspection, resolveForcedSteps, isForced5Void } =
  statusMod as unknown as typeof import('../src/lib/inspection-step-status.ts')
// 독립 검증 R4-10 지적 해소: 순수 함수에 손으로 값을 넣는 대신 **server-only 모듈을 실제로 불러**
// syncInspectionSteps를 돌리고 inspection_steps.status를 읽어 확인한다(--conditions=react-server 필요)
const { syncInspectionSteps } = syncMod as unknown as typeof import('../src/lib/inspection-step-sync.ts')

config({ path: '.env.local' })
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
if (!SB_URL.includes('nwflnzugwylhpdyodyog')) {
  console.error(`중단 — 스테이징이 아닌 DB: ${SB_URL}`)
  process.exit(2)
}
const db = createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
// syncInspectionSteps는 createAdminClient 반환형을 기대하지만 런타임엔 같은 supabase-js 클라이언트다
const admin = db as never

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

console.log('— 1부 마커 철회·낡은 강제 완료 (독립 검증 D1)')
{
  const F = 'step_force_complete', U = 'step_force_undo'
  ok('마커가 하나면 그 단계가 강제 완료',
    JSON.stringify(resolveForcedSteps([{ action: F, stepNum: 2, at: '2026-08-01T00:00:00Z' }]).steps) === '[2]')
  ok('나중 철회가 이긴다', resolveForcedSteps([
    { action: F, stepNum: 2, at: '2026-08-01T00:00:00Z' },
    { action: U, stepNum: 2, at: '2026-08-02T00:00:00Z' },
  ]).steps.length === 0)
  ok('철회 뒤 재확정하면 다시 강제 완료', JSON.stringify(resolveForcedSteps([
    { action: F, stepNum: 2, at: '2026-08-01T00:00:00Z' },
    { action: U, stepNum: 2, at: '2026-08-02T00:00:00Z' },
    { action: F, stepNum: 2, at: '2026-08-03T00:00:00Z' },
  ]).steps) === '[2]')
  ok('철회는 그 단계에만 적용된다', JSON.stringify(resolveForcedSteps([
    { action: F, stepNum: 2, at: '2026-08-01T00:00:00Z' },
    { action: F, stepNum: 3, at: '2026-08-01T00:00:00Z' },
    { action: U, stepNum: 2, at: '2026-08-02T00:00:00Z' },
  ]).steps) === '[3]')
  ok('범위 밖 step_num·다른 action은 무시', resolveForcedSteps([
    { action: F, stepNum: 9, at: '2026-08-01T00:00:00Z' },
    { action: 'owner_report_offline', stepNum: 3, at: '2026-08-01T00:00:00Z' },
  ]).steps.length === 0)

  ok('동률 시각이면 철회가 이긴다(한 트랜잭션 동시 기록 대비)', resolveForcedSteps([
    { action: F, stepNum: 4, at: '2026-08-01T00:00:00Z' },
    { action: U, stepNum: 4, at: '2026-08-01T00:00:00Z' },
  ]).steps.length === 0)

  const forced5: StepEvidence = { ...EV, forced: [5], defectsTotal: 1, defectsDone: 0 }
  ok('⑤ 사유 완료는 미조치 불량이 남아 있으면 무효', isForced5Void(forced5) === true)
  ok('그 상태의 ⑤ 판정은 미완료', evidenceDone(forced5)[5] === false)
  ok('전건 조치되면 무효가 아니다', isForced5Void({ ...forced5, defectsDone: 1 }) === false)
  ok('조치 해제(완료→미조치)도 같은 규칙으로 잡힌다 — 시각 비교가 놓치던 구멍',
    evidenceDone({ ...forced5, defectsTotal: 2, defectsDone: 1 })[5] === false)
  ok('불량 0건이면 ⑤ 사유 완료가 유효', evidenceDone({ ...EV, forced: [5] })[5] === true)
  ok('①~④·⑥의 강제 완료는 불량과 무관하게 유지',
    evidenceDone({ ...forced5, forced: [2] })[2] === true)
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
const doneList = (rows: Array<{ step_num: number; status: string }>) =>
  rows.filter(r => r.status === 'completed').map(r => r.step_num)

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

  // 2부는 **syncInspectionSteps를 실제로 돌려** DB의 inspection_steps.status를 확인한다.
  // (종전엔 순수 함수에 손으로 값을 넣어 단언해 "증거가 생기면 status가 바뀐다"를 증명하지 못했다)
  console.log('— 2부 증거 → DB status 실주행')
  const doneNow = async () => doneList(await stepRows())

  await db.from('inspection_sheet_responses').insert({
    inspection_id: inspId, item_code: '1-A-001', result: 'O', month: 0,
  } as never)
  await syncInspectionSteps(admin, inspId, actorId)
  ok('① 응답 저장 → DB status 완료', (await doneNow()).includes(1), JSON.stringify(await doneNow()))

  // 이 단언이 선행 단언에 기대지 않도록 **전제(①이 완료 상태였음)를 여기서 다시 확인**한다
  // (2차 독립 검증: 선행 sync를 지운 사본에서도 트리비얼 통과하던 비독립 단언이었다)
  const wasDone1 = (await doneNow()).includes(1)
  await db.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
  await syncInspectionSteps(admin, inspId, actorId)
  ok('응답 전삭제 → ① DB status 되돌림 (완료였던 것이 미완료로)',
    wasDone1 && !(await doneNow()).includes(1), `wasDone1=${wasDone1} now=${JSON.stringify(await doneNow())}`)

  // ④ 제출일 기록·정정 — 순서를 건너뛴 완료(①이 미완인데 ④ 완료)도 막히지 않아야 한다
  await db.from('inspections').update({ report9_submitted_at: '2026-08-12' } as never).eq('id', inspId)
  await syncInspectionSteps(admin, inspId, actorId)
  const after4 = await doneNow()
  ok('④ 제출일 기록 → DB status 완료', after4.includes(4), JSON.stringify(after4))
  ok('순서 강제 없음 — ①이 미완인데도 ④가 완료된다', after4.includes(4) && !after4.includes(1))
  await db.from('inspections').update({ report9_submitted_at: null } as never).eq('id', inspId)
  await syncInspectionSteps(admin, inspId, actorId)
  ok('④ 제출일 삭제 → 미완료 복귀(예외 없음)', !(await doneNow()).includes(4))

  // ③ 오프라인 보고 마커 — 이메일 발송 없이도 완료
  await db.from('activity_logs').insert({
    action: 'owner_report_offline', entity_type: 'inspection', entity_id: inspId,
    metadata: { date: '2026-08-12', method: '방문 설명', memo: SEED },
  } as never)
  await syncInspectionSteps(admin, inspId, actorId)
  ok('③ 오프라인 보고 마커만으로 DB status 완료', (await doneNow()).includes(3), JSON.stringify(await doneNow()))

  // 강제 완료 마커 → ② 완료, 철회 마커 → 되돌림 (독립 검증 D1)
  await db.from('activity_logs').insert({
    action: 'step_force_complete', entity_type: 'inspection', entity_id: inspId,
    metadata: { step_num: 2, reason: `${SEED} 예외 사유` },
  } as never)
  await syncInspectionSteps(admin, inspId, actorId)
  ok('사유 완료 마커로 ②가 DB에서 완료', (await doneNow()).includes(2), JSON.stringify(await doneNow()))

  await db.from('activity_logs').insert({
    action: 'step_force_undo', entity_type: 'inspection', entity_id: inspId,
    metadata: { step_num: 2, reason: `${SEED} 오기입 철회` },
  } as never)
  await syncInspectionSteps(admin, inspId, actorId)
  ok('철회 마커로 ②가 미완료로 되돌아온다 — 강제 완료는 영구가 아니다(D1)',
    !(await doneNow()).includes(2), JSON.stringify(await doneNow()))

  await db.from('activity_logs').insert({
    action: 'step_force_complete', entity_type: 'inspection', entity_id: inspId,
    metadata: { step_num: 2, reason: `${SEED} 재확정` },
  } as never)
  await syncInspectionSteps(admin, inspId, actorId)
  ok('철회 뒤 다시 사유 완료하면 최신 마커가 이긴다', (await doneNow()).includes(2))

  // ⑤ 강제 완료 뒤 **새 미조치 불량**이 들어오면 그 강제분은 낡은 것 (독립 검증 D1의 핵심 반례)
  await db.from('activity_logs').insert({
    action: 'step_force_complete', entity_type: 'inspection', entity_id: inspId,
    metadata: { step_num: 5, reason: `${SEED} 조치 완료로 간주` },
  } as never)
  await syncInspectionSteps(admin, inspId, actorId)
  ok('⑤ 사유 완료가 반영된다', (await doneNow()).includes(5), JSON.stringify(await doneNow()))
  // ⚠ inspection_defects에는 created_by 컬럼이 없다 — 넣으면 insert가 통째로 실패한다(에러를 반드시 본다)
  const { error: dErr } = await db.from('inspection_defects').insert({
    inspection_id: inspId, defect_code: 'R4T-1', defect_name: `${SEED} 신규 불량`, severity: '보통',
  } as never)
  ok('신규 불량 등록 성공 — 실패하면 아래 단언이 무의미해진다', !dErr, dErr?.message ?? '')
  await syncInspectionSteps(admin, inspId, actorId)
  ok('⑤ 강제 완료 뒤 새 미조치 불량이 오면 ⑤가 다시 미완료가 된다 — 하지 않은 일이 완료로 남지 않는다',
    !(await doneNow()).includes(5), JSON.stringify(await doneNow()))
  await db.from('inspection_defects').update({ action_completed_at: '2026-08-12' } as never)
    .eq('inspection_id', inspId)
  await syncInspectionSteps(admin, inspId, actorId)
  ok('그 불량을 조치하면 ⑤는 증거만으로 완료된다', (await doneNow()).includes(5))
  // 2차 독립 검증이 잡은 구멍: **조치완료를 해제**하면(불량은 그대로) ⑤가 다시 미완료여야 한다.
  // 종전 규칙(마커 이후 등록된 불량인지 시각 비교)은 created_at이 안 바뀌어 이 경우를 놓쳤다.
  await db.from('inspection_defects').update({ action_completed_at: null } as never)
    .eq('inspection_id', inspId)
  await syncInspectionSteps(admin, inspId, actorId)
  ok('조치완료를 해제하면 ⑤가 사유 완료에도 불구하고 미완료로 돌아온다',
    !(await doneNow()).includes(5), JSON.stringify(await doneNow()))
  await db.from('inspection_defects').delete().eq('inspection_id', inspId)
  await syncInspectionSteps(admin, inspId, actorId)
  ok('불량을 전부 지우면 ⑤ 사유 완료가 다시 유효해진다', (await doneNow()).includes(5))

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
  if (inspId) await db.from('inspection_defects').delete().eq('inspection_id', inspId)
  if (inspId) await db.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
  // 독립 검증 D5: activity_logs는 append-only(040)라 .delete()가 **조용히 실패**해 시드 마커가
  // 실행마다 쌓였다. 삭제 전용 경로인 purge_activity_logs(id[])로 지운다.
  if (inspId) {
    const { data: logIds } = await db.from('activity_logs').select('id')
      .eq('entity_type', 'inspection').eq('entity_id', inspId)
    const ids = ((logIds ?? []) as Array<{ id: string }>).map(r => r.id)
    if (ids.length > 0) {
      const { data: purged, error: pErr } = await db.rpc('purge_activity_logs', { purge_ids: ids } as never)
      console.log(`  마커 정리: ${pErr ? `실패(${pErr.message})` : `${purged ?? 0}건`}`)
    }
    const { count: logLeft } = await db.from('activity_logs')
      .select('id', { count: 'exact', head: true }).eq('entity_type', 'inspection').eq('entity_id', inspId)
    if ((logLeft ?? 0) > 0) console.log(`  ⚠ 마커 잔존 ${logLeft}건 — 수동 정리 필요`)
  }
  if (custId) await db.from('inspections').delete().eq('customer_id', custId)
  if (custId) await db.from('customers').delete().eq('id', custId)
  const { count: leftover } = await db.from('customers')
    .select('id', { count: 'exact', head: true }).like('customer_name', `${SEED}%`)
  console.log(`  시드 잔존: ${leftover ?? 0}건`)
}

console.log(`\n결과: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
