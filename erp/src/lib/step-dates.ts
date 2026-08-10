/** 점검 6단계 마감일 미리보기 — DB 트리거 `create_inspection_steps`(migrations/111_steps_plan_type_axis.sql)의
 *  산식을 그대로 옮긴 것. 실제 마감일을 만드는 유일한 원천은 트리거이므로, 산식을 고칠 때는 111과 함께 본다.
 *
 *  트리거 요약 (자체점검 = plan_type special_*·null):
 *    base   = 사용승인일이 있으면 점검 연도의 응당일, 없으면 점검시작일
 *    ① = base +1영업일 · ② = ① +5영업일 · ③ = ① +10영업일 · ④ = ① +15영업일
 *    ⑤ = ④ +9일(달력, 당일 포함 10일째) · ⑥ = ⑤ +10영업일
 *  정기(monthly)·레거시 event는 ① 하나뿐이고 마감일 = 점검시작일(영업일 보정 없음). */

export type StepPreviewRow = { step_num: number; name_ko: string; due_date: string }

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

const pad = (n: number) => String(n).padStart(2, '0')
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** SQL `add_working_days`와 동일 — 토·일·공휴일을 건너뛰며 n 영업일 뒤 */
export function addWorkingDays(iso: string, n: number, holidays: Set<string>): string {
  const d = parse(iso)
  let added = 0
  while (added < n) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6 && !holidays.has(toISO(d))) added++
  }
  return toISO(d)
}

const addCalendarDays = (iso: string, n: number) => {
  const d = parse(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** 트리거의 base_date — 사용승인일의 점검 연도 응당일(말일 초과분은 그 달 말일로) */
export function stepBaseDate(startDate: string, useApprovalDate?: string | null): string {
  if (!useApprovalDate || !ISO_RE.test(useApprovalDate.slice(0, 10))) return startDate
  const year = parse(startDate).getFullYear()
  const a = parse(useApprovalDate.slice(0, 10))
  const lastDay = new Date(year, a.getMonth() + 1, 0).getDate()
  return toISO(new Date(year, a.getMonth(), Math.min(a.getDate(), lastDay)))
}

/** 트리거의 name_ko에서 'n단계: ' 접두어를 뺀 라벨 — 화면이 단계 번호를 따로 그린다 */
const STEP_LABELS = [
  '점검일',
  '배치확인서 보고서 작성',
  '관계인 보고서 제출',
  '소방서 보고서 제출 및 이행계획서 등록',
  '소방보수 완료',
  '이행완료보고서 제출',
]

export function previewInspectionSteps({ startDate, useApprovalDate, holidays }: {
  startDate: string
  useApprovalDate?: string | null
  holidays: Set<string>
}): StepPreviewRow[] {
  if (!ISO_RE.test(startDate)) return []   // 타이핑 중인 부분 입력 — 무한 루프 방지
  const base = stepBaseDate(startDate, useApprovalDate)
  const s1 = addWorkingDays(base, 1, holidays)
  const s4 = addWorkingDays(s1, 15, holidays)
  const s5 = addCalendarDays(s4, 9)
  const dues = [s1, addWorkingDays(s1, 5, holidays), addWorkingDays(s1, 10, holidays), s4, s5, addWorkingDays(s5, 10, holidays)]
  return STEP_LABELS.map((name_ko, i) => ({ step_num: i + 1, name_ko, due_date: dues[i] }))
}
