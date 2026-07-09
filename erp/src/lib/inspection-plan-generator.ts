import type { createAdminClient } from '@/lib/supabase/admin'
import type { InspectionType } from '@/types'

type Admin = ReturnType<typeof createAdminClient>

/** 예정일 영업일 계산용 공휴일 셋 로드 (targetYear~익년) */
export async function loadHolidaySet(admin: Admin, year: number): Promise<Set<string>> {
  const { data } = await admin.from('holidays').select('date')
    .gte('date', `${year}-01-01`).lte('date', `${year + 1}-12-31`)
  return new Set((data ?? []).map(h => (h as Record<string, unknown>).date as string))
}

/** 소방안전관리 고객의 연간 점검계획 항목 생성 — 연 12건
 *  - 사용승인월: 1차 특별점검(special_종합/special_작동)
 *  - 종합: +6개월 2차 특별점검 (연도를 넘겨도 targetYear 월로 배치하여 연 12건 유지)
 *  - 나머지 월: monthly 정기점검
 *  이미 존재하는 (plan, customer, sequence) 항목은 UNIQUE 충돌로 건너뜀 — 매년 재실행해도 안전(멱등)
 *  @returns 새로 생성된 항목 수 */
export async function generateYearlyPlanItems(
  admin: Admin,
  customer: { id: string; inspection_type: InspectionType; use_approval_date: string; assigned_employee_id: string | null },
  targetYear: number,
  createdBy: string,
  hdSet: Set<string>,
): Promise<number> {
  const { inspection_type, use_approval_date, assigned_employee_id } = customer
  if (inspection_type === '일반관리') return 0

  const inspection_category = '소방안전관리'
  const inspection_sub_type = inspection_type === '종합' ? '종합' : '작동'

  const approvalDate  = new Date(use_approval_date)
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

  // targetYear 나머지 월: 모두 monthly 정기점검 → 항상 연 12건
  for (let m = 1; m <= 12; m++) {
    if (!specialKey.has(`${targetYear}-${m}`)) {
      toCreate.push({ year: targetYear, month: m, sequence_num: 1, planType: 'monthly' })
    }
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

    const { error } = await admin.from('inspection_plan_items').insert({
      plan_id: planId,
      customer_id: customer.id,
      inspection_type,
      inspection_category,
      inspection_sub_type,
      sequence_num,
      assigned_employee_id: assigned_employee_id || null,
      planned_date: calcPlanned(year, month),
      scheduled_date: null,
      status: 'planned',
      plan_type: planType,
    } as Record<string, unknown>)
    // 23505 중복 에러는 무시 (멱등)
    if (!error) created++
  }
  return created
}
