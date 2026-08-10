/** 단계 마감일 미리보기 ↔ DB 트리거 대조 프로브 (2026-08-10, 소방계획서_14 #14 개선2)
 *  점검 등록 화면의 "6단계 예상 일정"이 등록 후 실제 생성되는 inspection_steps.due_date와 같은지 확인.
 *  종전엔 미리보기가 달력일 0/7/14/21/28/35, 실제는 영업일 산식이라 어긋났다.
 *  실행: node scripts/_probe-step-preview.mjs   (DB만 사용 — dev 서버 불필요)
 */
import { raw, check, summary, mkUser, mkCustomer, cleanupCustomer, delUser } from './_e2e-helpers.mjs'
import { previewInspectionSteps, addWorkingDays } from '../src/lib/step-dates.ts'

const EMAIL = 'e2e-steppreview@test.local'

/** 트리거가 보는 것과 같은 공휴일 집합 */
async function loadHolidays(years) {
  const { data } = await raw.from('holidays').select('date').in('year', years)
  return new Set((data ?? []).map(h => h.date))
}

let userId, custId, custId2, custId3
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

  // ── ③ 종전 미리보기(달력일 0/7/14/21/28/35)가 실제와 달랐음을 기록 ──
  // ②단계는 정정 후 우연히 같은 날이 되기도 하므로 6단계 전체로 판정한다
  const legacySeries = [0, 7, 14, 21, 28, 35].map(d =>
    new Date(new Date(START + 'T12:00:00').getTime() + d * 86400000).toISOString().split('T')[0])
  const actualSeries = (stepsA ?? []).map(s => s.due_date)
  const diffCount = actualSeries.filter((d, i) => d !== legacySeries[i]).length
  check('종전 달력일 산식은 실제와 불일치했다(수정 근거)', diffCount > 0,
    `종전 ${legacySeries.join(',')} / 실제 ${actualSeries.join(',')}`)
  const actual2 = (stepsA ?? []).find(s => s.step_num === 2)?.due_date

  // ── ④ ②단계 = 법정 기산점(점검종료일 +5영업일) — 마이그레이션 121 ──
  // 협회 계산법: "점검이 끝난 날부터 5일", 종료일 당일·토요일·공휴일 산입 제외 = 종료일 +5영업일
  const legal2 = addWorkingDays(START, 5, holidays)
  check('A: ②단계 = 점검종료일 +5영업일 (법정)', actual2 === legal2, `실제 ${actual2} / 법정 ${legal2}`)
  const oldFormula2 = addWorkingDays(stepsA[0].due_date, 5, holidays)
  check('A: 종전 기산점(①+5영업일)보다 앞당겨졌다', actual2 !== oldFormula2, `종전 산식이면 ${oldFormula2}`)

  // 사용승인일 고객도 ②단계만은 점검일 기준 — 기준일 이상치(응당일)에 영향받지 않아야 한다
  const actualB2 = (stepsB ?? []).find(s => s.step_num === 2)?.due_date
  check('B: 사용승인일 고객도 ②단계는 법정 기산점', actualB2 === legal2, `실제 ${actualB2} / 법정 ${legal2}`)

  // ── ⑤ 다일 점검 — 종료일이 있으면 그 날 기준 ────────────────────
  const END = '2026-09-17'
  custId3 = await mkCustomer({ customer_name: 'E2E단계고객C', created_by: userId })
  const { data: insC, error: eC } = await raw.from('inspections').insert({
    customer_id: custId3, assigned_employee_id: userId, inspection_type: '작동',
    inspection_start_date: START, inspection_end_date: END, inspection_days: 3,
    sequence_num: 1, status: 'scheduled', created_by: userId,
  }).select('id').single()
  if (eC) throw new Error(`점검 C 생성 실패: ${eC.message}`)
  const { data: stepsC } = await raw.from('inspection_steps')
    .select('step_num, due_date').eq('inspection_id', insC.id).order('step_num')
  const predC = previewInspectionSteps({ startDate: START, endDate: END, useApprovalDate: null, holidays })
  const actualC2 = (stepsC ?? []).find(s => s.step_num === 2)?.due_date
  check('C(다일): ②단계 = 종료일 +5영업일', actualC2 === addWorkingDays(END, 5, holidays),
    `실제 ${actualC2} / 기대 ${addWorkingDays(END, 5, holidays)}`)
  check('C(다일): 미리보기도 종료일 기준으로 일치',
    predC.find(x => x.step_num === 2)?.due_date === actualC2,
    `미리보기 ${predC.find(x => x.step_num === 2)?.due_date} / DB ${actualC2}`)
} catch (e) {
  check('예외 없음', false, String(e?.message ?? e))
} finally {
  await cleanupCustomer(custId).catch(() => {})
  await cleanupCustomer(custId2).catch(() => {})
  await cleanupCustomer(custId3).catch(() => {})
  await delUser(userId).catch(() => {})
}
summary()
