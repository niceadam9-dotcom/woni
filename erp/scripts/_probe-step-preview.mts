/** 단계 마감일 미리보기 ↔ DB 트리거 대조 프로브 (2026-08-10, 소방계획서_14 #14 개선2)
 *  점검 등록 화면의 "6단계 예상 일정"이 등록 후 실제 생성되는 inspection_steps.due_date와 같은지 확인.
 *  종전엔 미리보기가 달력일 0/7/14/21/28/35, 실제는 영업일 산식이라 어긋났다.
 *  실행: node scripts/_probe-step-preview.mjs   (DB만 사용 — dev 서버 불필요)
 */
import { raw, check, summary, mkUser, mkCustomer, cleanupCustomer, delUser } from './_e2e-helpers.mjs'
import { previewInspectionSteps } from '../src/lib/step-dates.ts'

const EMAIL = 'e2e-steppreview@test.local'

/** 트리거가 보는 것과 같은 공휴일 집합 */
async function loadHolidays(years) {
  const { data } = await raw.from('holidays').select('date').in('year', years)
  return new Set((data ?? []).map(h => h.date))
}

let userId, custId, custId2
try {
  const START = '2026-09-15'          // 화요일
  const APPROVAL = '2019-03-31'       // 사용승인일 있는 고객 — 응당일(3/31)이 기준이 되어야 한다
  const holidays = await loadHolidays([2026, 2027])

  userId = await mkUser({ email: EMAIL, name: 'E2E단계', employeeId: 'E2E-SP' })

  // ── ① 사용승인일 없는 고객 — 기준일 = 점검시작일 ──────────────
  custId = await mkCustomer({ customer_name: 'E2E단계고객A', created_by: userId })
  const { data: insA, error: eA } = await raw.from('inspections').insert({
    customer_id: custId, assigned_employee_id: userId, inspection_type: '작동',
    inspection_start_date: START, sequence_num: 1, status: 'scheduled', created_by: userId,
  }).select('id').single()
  if (eA) throw new Error(`점검 A 생성 실패: ${eA.message}`)

  const { data: stepsA } = await raw.from('inspection_steps')
    .select('step_num, due_date').eq('inspection_id', insA.id).order('step_num')
  const predA = previewInspectionSteps({ startDate: START, useApprovalDate: null, holidays })

  check('A: 트리거가 6단계 생성', (stepsA ?? []).length === 6, `실제: ${(stepsA ?? []).length}단계`)
  for (const s of stepsA ?? []) {
    const p = predA.find(x => x.step_num === s.step_num)
    check(`A: ${s.step_num}단계 마감일 일치 (${s.due_date})`, p?.due_date === s.due_date,
      `미리보기 ${p?.due_date} ≠ DB ${s.due_date}`)
  }

  // ── ② 사용승인일 있는 고객 — 기준일 = 점검 연도 응당일 ─────────
  custId2 = await mkCustomer({ customer_name: 'E2E단계고객B', created_by: userId, use_approval_date: APPROVAL })
  const { data: insB, error: eB } = await raw.from('inspections').insert({
    customer_id: custId2, assigned_employee_id: userId, inspection_type: '작동',
    inspection_start_date: START, sequence_num: 1, status: 'scheduled', created_by: userId,
  }).select('id').single()
  if (eB) throw new Error(`점검 B 생성 실패: ${eB.message}`)

  const { data: stepsB } = await raw.from('inspection_steps')
    .select('step_num, due_date').eq('inspection_id', insB.id).order('step_num')
  const predB = previewInspectionSteps({ startDate: START, useApprovalDate: APPROVAL, holidays })

  for (const s of stepsB ?? []) {
    const p = predB.find(x => x.step_num === s.step_num)
    check(`B(사용승인일): ${s.step_num}단계 마감일 일치 (${s.due_date})`, p?.due_date === s.due_date,
      `미리보기 ${p?.due_date} ≠ DB ${s.due_date}`)
  }
  check('B: 사용승인일 고객은 기준일이 점검일과 다르다(회귀 감지용)',
    (stepsB ?? [])[0]?.due_date !== (stepsA ?? [])[0]?.due_date,
    `A ${(stepsA ?? [])[0]?.due_date} / B ${(stepsB ?? [])[0]?.due_date}`)

  // ── ③ 종전 산식(달력일 +7)이 2단계와 실제로 달랐음을 기록 ────────
  const legacy2 = new Date(new Date(START + 'T12:00:00').getTime() + 7 * 86400000).toISOString().split('T')[0]
  const actual2 = (stepsA ?? []).find(s => s.step_num === 2)?.due_date
  check('종전 달력일 산식은 실제와 불일치했다(수정 근거)', legacy2 !== actual2,
    `종전 미리보기 ${legacy2} / 실제 ${actual2}`)
} catch (e) {
  check('예외 없음', false, String(e?.message ?? e))
} finally {
  await cleanupCustomer(custId).catch(() => {})
  await cleanupCustomer(custId2).catch(() => {})
  await delUser(userId).catch(() => {})
}
summary()
