import type { createAdminClient } from '@/lib/supabase/admin'
import type { InspectionType } from '@/types'

type Admin = ReturnType<typeof createAdminClient>

/** 예정일 영업일 계산용 공휴일 셋 로드 (targetYear~익년) */
export async function loadHolidaySet(admin: Admin, year: number): Promise<Set<string>> {
  const { data } = await admin.from('holidays').select('date')
    .gte('date', `${year}-01-01`).lte('date', `${year + 1}-12-31`)
  return new Set((data ?? []).map(h => (h as Record<string, unknown>).date as string))
}

/** 계획 기산점(기준일) 일괄 결정: 점검계획일(수동) → 최초 점검시작일
 *  점검계획일(plan_anchor_date)이 입력된 고객은 무조건 그 날짜를 기준으로 하고,
 *  없으면 실제 점검 이력의 최초 시작일로 계산.
 *  사용승인일은 기준일로 쓰지 않는다(2026-07-14 폴백 제거). 둘 다 없는 고객은 맵에서 제외(계획 생성 없음) */
export async function loadAnchorDates(
  admin: Admin,
  customers: Array<{ id: string; plan_anchor_date?: string | null }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const c of customers) {
    if (c.plan_anchor_date) map.set(c.id, c.plan_anchor_date)
  }
  const ids = customers.filter(c => !map.has(c.id)).map(c => c.id)
  if (ids.length > 0) {
    const { data } = await admin
      .from('inspections')
      .select('customer_id, inspection_start_date')
      .in('customer_id', ids)
      .order('inspection_start_date', { ascending: true })
    for (const r of (data ?? []) as Array<{ customer_id: string; inspection_start_date: string | null }>) {
      if (r.inspection_start_date && !map.has(r.customer_id)) map.set(r.customer_id, r.inspection_start_date)
    }
  }
  return map
}

/** 소방안전관리 고객의 연간 점검계획 항목 생성 — 연 12건 (첫해는 지난 달 정기 제외)
 *  - 기준일: 점검계획일(수동) → 최초 점검시작일(loadAnchorDates) — 모두 없으면 생성 없음
 *  - 기준월: 1차 특별점검(special_종합/special_작동)
 *  - 종합: +6개월 2차 특별점검 (연도를 넘겨도 targetYear 월로 배치)
 *  - 나머지 월: monthly 정기점검 — 단 이미 지난 달은 생성 생략 (중도 등록 대응)
 *  - 기준일 이전 날짜의 항목은 생성 안 함 (최초 점검 전 이행 의무 없음 — 올해 안 기준일의 2차 역행 방지)
 *  이미 존재하는 (plan, customer, sequence) 항목은 UNIQUE 충돌로 건너뜀 — 매년 재실행해도 안전(멱등)
 *  @returns 새로 생성된 항목 수 */
export async function generateYearlyPlanItems(
  admin: Admin,
  customer: { id: string; inspection_type: InspectionType; plan_anchor_date?: string | null; assigned_employee_id: string | null },
  targetYear: number,
  createdBy: string,
  hdSet: Set<string>,
): Promise<number> {
  const { inspection_type, assigned_employee_id } = customer
  if (inspection_type === '일반관리') return 0

  const anchorDate = (await loadAnchorDates(admin, [customer])).get(customer.id)
  if (!anchorDate) return 0

  const inspection_category = '소방안전관리'
  const inspection_sub_type = inspection_type === '종합' ? '종합' : '작동'

  const approvalDate  = new Date(anchorDate)
  const approvalMonth = approvalDate.getMonth() + 1
  const approvalDay   = approvalDate.getDate()

  function toStr(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  function calcPlanned(year: number, month: number): string {
    const daysInMo = new Date(year, month, 0).getDate()
    const base = new Date(year, month - 1, Math.min(approvalDay, daysInMo))
    const d = base.getDay()
    if (d === 0 || d === 6 || hdSet.has(toStr(base))) {
      const next = new Date(base)
      next.setDate(next.getDate() + 1)
      while (next.getDay() === 0 || next.getDay() === 6 || hdSet.has(toStr(next))) next.setDate(next.getDate() + 1)
      return toStr(next)
    }
    return toStr(base)
  }

  // 특별점검 월 정의
  const specialKey = new Set<string>()
  const toCreate: Array<{ year: number; month: number; sequence_num: 1 | 2; planType: string }> = []

  // 1차 특별점검 (사용승인월)
  specialKey.add(`${targetYear}-${approvalMonth}`)
  toCreate.push({
    year: targetYear, month: approvalMonth, sequence_num: 1,
    planType: inspection_type === '종합' ? 'special_종합' : 'special_작동',
  })

  // 종합: +6개월 2차 특별점검
  if (inspection_type === '종합') {
    const mo2 = ((approvalMonth - 1 + 6) % 12) + 1
    specialKey.add(`${targetYear}-${mo2}`)
    toCreate.push({ year: targetYear, month: mo2, sequence_num: 2, planType: 'special_종합' })
  }

  // targetYear 나머지 월: monthly 정기점검 (특별월 제외)
  // 단, 이미 지난 달의 정기는 생성 생략 — 중도 등록·올해 보정 시 수행 불가한 과거
  // 유령 항목이 쌓이는 것 방지. 특별점검은 법정 의무라 과거여도 생성(초과 해결 플로우 대상).
  const kstNow   = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const curYear  = kstNow.getUTCFullYear()
  const curMonth = kstNow.getUTCMonth() + 1
  for (let m = 1; m <= 12; m++) {
    if (specialKey.has(`${targetYear}-${m}`)) continue
    if (targetYear < curYear || (targetYear === curYear && m < curMonth)) continue
    toCreate.push({ year: targetYear, month: m, sequence_num: 1, planType: 'monthly' })
  }

  let created = 0
  for (const { year, month, sequence_num, planType } of toCreate) {
    let planId: string | null = null
    const { data: ep } = await admin.from('inspection_plans').select('id').eq('year', year).eq('month', month).single()
    if (ep) {
      planId = (ep as { id: string }).id
    } else {
      const { data: np } = await admin.from('inspection_plans')
        .insert({ year, month, status: 'draft', auto_generated: true, created_by: createdBy } as Record<string, unknown>)
        .select('id').single()
      if (np) {
        planId = (np as { id: string }).id
      } else {
        const { data: dp } = await admin.from('inspection_plans').select('id').eq('year', year).eq('month', month).single()
        if (dp) planId = (dp as { id: string }).id
      }
    }
    if (!planId) continue

    // 기준일 이전 항목은 생성하지 않음 — 최초 점검 전에는 이행 의무가 없다.
    // 기준일이 올해 안(최초 점검시작일)일 때 2차(+6개월)가 같은 해 과거 1월로 감겨
    // 1차보다 앞선 유령 지연 항목이 생기는 것 방지 (과거 앵커는 전부 기준일 이후라 영향 없음)
    let planned = calcPlanned(year, month)
    if (planned < anchorDate) continue

    // 당월 항목의 예정일이 생성 시점에 이미 지났으면 오늘 이후 첫 영업일로 보정 —
    // 승인일의 '일'이 등록일보다 앞설 때 등록 직후부터 지연⚠로 뜨는 것 방지 (수정사항리스트 4-1)
    const kstTodayStr = toStr(new Date(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()))
    if (year === curYear && month === curMonth && planned < kstTodayStr) {
      const d = new Date(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate())
      while (d.getDay() === 0 || d.getDay() === 6 || hdSet.has(toStr(d))) d.setDate(d.getDate() + 1)
      planned = toStr(d)
    }

    const { error } = await admin.from('inspection_plan_items').insert({
      plan_id: planId,
      customer_id: customer.id,
      inspection_type,
      inspection_category,
      inspection_sub_type,
      sequence_num,
      assigned_employee_id: assigned_employee_id || null,
      planned_date: planned,
      scheduled_date: null,
      status: 'planned',
      plan_type: planType,
    } as Record<string, unknown>)
    // 23505 중복 에러는 무시 (멱등)
    if (!error) created++
  }
  return created
}
