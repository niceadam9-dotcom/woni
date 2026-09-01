import type { createAdminClient } from '@/lib/supabase/admin'
import type { InspectionType } from '@/types'
import { rowInspectionType, rowPlanType, rowSubType } from '@/lib/inspection-round'
import { resolveAnchor, type AnchorSource } from '@/lib/plan-anchor'

type Admin = ReturnType<typeof createAdminClient>

/** 계획 생성기가 고객에게서 필요로 하는 필드 — 롤링·연간 두 진입점이 **같은 타입**을 쓴다.
 *  사본을 두면 한쪽에만 기산점 필드를 더하고 다른 쪽을 잊는다(호출부는 타입으로만 걸린다). */
export type PlanCustomer = {
  id: string; inspection_type: InspectionType
  inspection_category?: string | null; inspection_sub_type?: string | null
  plan_anchor_date?: string | null; assigned_employee_id: string | null
  /** 기산점 축 — 없으면(select 미포함/마이그레이션 전) 종전 동작으로 떨어진다 */
  use_approval_date?: string | null; plan_anchor_manual?: boolean | null
}

/** 예정일 영업일 계산용 공휴일 셋 로드 (targetYear~익년) */
export async function loadHolidaySet(admin: Admin, year: number): Promise<Set<string>> {
  const { data } = await admin.from('holidays').select('date')
    .gte('date', `${year}-01-01`).lte('date', `${year + 1}-12-31`)
  return new Set((data ?? []).map(h => (h as Record<string, unknown>).date as string))
}

/** `plan_anchor_manual` 컬럼 존재 여부 — 프로세스당 한 번만 확인한다.
 *  마이그레이션 155 적용 전에는 첫 조회가 실패하고, 이후로는 아예 묻지 않는다. */
let hasAnchorManualCol: boolean | null = null

/** 호출부가 select에 안 실어준 기산점 필드를 **스스로 보강**한다.
 *
 *  소비처가 6곳이라 한 곳만 빠뜨려도 그 경로가 조용히 옛 축으로 되돌아간다 — 타입은
 *  optional이라 컴파일러가 못 잡는다. 그래서 여기서 메운다(이미 실려 있으면 조회하지 않는다).
 *
 *  ⚠ `plan_anchor_manual`은 **없는 컬럼일 수 있다**. select에 넣으면 PostgREST가 42703을 주고,
 *  error를 안 보면 그게 조용한 0행이 된다([[feedback_supabase_check_error]]). 그래서 별도·관용
 *  조회로 떼어 두고 실패하면 이후 재시도하지 않는다(154 `readProfileFontScale`과 같은 구조). */
async function fillAnchorFields<T extends {
  id: string; use_approval_date?: string | null; plan_anchor_manual?: boolean | null
}>(admin: Admin, customers: T[]): Promise<T[]> {
  if (customers.length === 0) return customers
  const out = customers.map(c => ({ ...c }))

  const needApproval = out.filter(c => c.use_approval_date === undefined).map(c => c.id)
  if (needApproval.length > 0) {
    const { data, error } = await admin.from('customers')
      .select('id, use_approval_date').in('id', needApproval)
    if (!error) {
      const m = new Map((data ?? []).map(r => {
        const row = r as { id: string; use_approval_date: string | null }
        return [row.id, row.use_approval_date]
      }))
      for (const c of out) if (c.use_approval_date === undefined && m.has(c.id)) c.use_approval_date = m.get(c.id)!
    }
  }

  if (hasAnchorManualCol !== false) {
    const ids = out.filter(c => c.plan_anchor_manual === undefined).map(c => c.id)
    if (ids.length > 0) {
      const { data, error } = await admin.from('customers')
        .select('id, plan_anchor_manual').in('id', ids)
      if (error) hasAnchorManualCol = false          // 컬럼 미적용 — 레거시 동작으로 간다
      else {
        hasAnchorManualCol = true
        const m = new Map((data ?? []).map(r => {
          const row = r as { id: string; plan_anchor_manual: boolean | null }
          return [row.id, row.plan_anchor_manual]
        }))
        for (const c of out) if (c.plan_anchor_manual === undefined && m.has(c.id)) c.plan_anchor_manual = m.get(c.id)!
      }
    }
  }
  return out
}

/** 계획 기산점(기준일) 일괄 결정 — 우선순위는 `lib/plan-anchor.ts`가 단일 원천으로 정한다.
 *
 *  법령은 종합점검 시기를 **사용승인일이 속하는 달**로 정하는데(시행규칙 [별표 3]) 이 앱은
 *  2026-07-14 이후 점검계획일만 봤다. 축을 사용승인일로 되돌리되, 고객별 예외
 *  (`plan_anchor_manual`)를 둬서 **이미 잡혀 있는 방문 일정이 흔들리지 않게** 한다 —
 *  스테이징 실측에서 두 날짜의 (월)이 다른 고객이 88/246(35.8%)이고, 그 불일치는 데이터 썩음이
 *  아니라 방문을 열두 달로 분산한 운영 결정이었다.
 *
 *  ⚠ `plan_anchor_manual`은 마이그레이션 155 컬럼이라 **적용 전에는 undefined**로 들어오고,
 *  그때 resolveAnchor는 종전 동작(점검계획일 최우선)을 그대로 재현한다. 즉 코드만 배포해도
 *  기산점은 한 칸도 안 움직인다. 호출부가 이 컬럼을 select에 넣지 않아도 같은 뜻이 된다.
 *
 *  기산점이 없는 고객은 맵에서 제외한다(계획 생성 없음). */
export async function loadAnchorDates(
  admin: Admin,
  customers: AnchorCustomer[],
): Promise<Map<string, string>> {
  const res = await loadAnchorResolutions(admin, customers)
  return new Map([...res].map(([id, r]) => [id, r.date]))
}

type AnchorCustomer = {
  id: string; plan_anchor_date?: string | null
  use_approval_date?: string | null; plan_anchor_manual?: boolean | null
}

/** 기산점 + **어디서 왔는지**. 화면이 '사용승인일 기준'인지 '점검계획일 기준'인지 말하려면
 *  날짜만으로는 부족하다 — 두 값이 같은 날일 수도 있고, 폴백으로 들어온 최초 점검일일 수도 있다.
 *  종전 호출부는 `anchor === c.plan_anchor_date`로 2분법 추정을 했는데, 축이 셋이 된 지금은 거짓말이 된다. */
export async function loadAnchorResolutions(
  admin: Admin,
  customers: AnchorCustomer[],
): Promise<Map<string, { date: string; source: AnchorSource; divergent: boolean }>> {
  const filled = await fillAnchorFields(admin, customers)
  const map = new Map<string, { date: string; source: AnchorSource; divergent: boolean }>()
  const needFirst: AnchorCustomer[] = []
  const divergentOf = new Map<string, boolean>()
  for (const c of filled) {
    const r = resolveAnchor(c)
    divergentOf.set(c.id, r.divergent)
    if (r.date) map.set(c.id, { date: r.date, source: r.source, divergent: r.divergent })
    else needFirst.push(c)
  }
  const ids = needFirst.map(c => c.id)
  if (ids.length > 0) {
    const { data } = await admin
      .from('inspections')
      .select('customer_id, inspection_start_date')
      .in('customer_id', ids)
      .order('inspection_start_date', { ascending: true })
    for (const r of (data ?? []) as Array<{ customer_id: string; inspection_start_date: string | null }>) {
      if (r.inspection_start_date && !map.has(r.customer_id)) {
        map.set(r.customer_id, {
          date: r.inspection_start_date, source: 'first', divergent: divergentOf.get(r.customer_id) ?? false,
        })
      }
    }
  }
  return map
}

/** 올해+내년 롤링 생성 — 어느 시점에 호출돼도 향후 12개월 이상의 계획이 항상 존재하게 한다.
 *  종전에는 내년분이 12/1 크론에서만 생겨 1~11월 내내 "기준일부터 1년치"의 후반부가
 *  조회되지 않았다(예: 8월에 내년 상반기 정기가 안 보임). baseYear와 baseYear+1을 함께
 *  생성하며 멱등이라 반복 호출 안전. 공휴일 셋은 loadHolidaySet이 baseYear~익년을 커버하므로
 *  한 번만 로드해 두 해에 공용한다. */
export async function generateRollingPlanItems(
  admin: Admin,
  customer: PlanCustomer,
  baseYear: number,
  createdBy: string,
): Promise<number> {
  const hdSet = await loadHolidaySet(admin, baseYear)
  let created = 0
  for (const y of [baseYear, baseYear + 1]) {
    created += await generateYearlyPlanItems(admin, customer, y, createdBy, hdSet)
  }
  return created
}

/** 고객의 연간 점검계획 항목 생성 — 소방안전관리 연 12건 / 일반관리 연 1~2건 (자체점검만, 정기 없음)
 *  - 기준일: loadAnchorDates(사용승인일/점검계획일 축은 resolveAnchor가 정한다) → 최초 점검시작일
 *    — 모두 없으면 생성 없음
 *  - 기준월: 1차 특별점검(special_종합/special_작동)
 *  - 종합 대상: +6개월 2차 특별점검 (연도를 넘겨도 targetYear 월로 배치).
 *    2차 행은 **작동**으로 저장한다(special_작동) — 종합 대상의 2차는 법적으로 작동점검이다.
 *    '종합 대상인가'는 고객 축(inspection_sub_type), '이 행이 무슨 점검인가'는 행 축으로 갈린다 (소방계획서_33)
 *  - 나머지 월: monthly 정기점검 — 단 이미 지난 달은 생성 생략 (중도 등록 대응).
 *    일반관리는 정기 미생성 (소방계획서_6 D-1 — 유일한 관리유형 분기)
 *  - 정기(monthly)는 생성 즉시 자동 확정(confirmed, scheduled=planned) — 기준일 규칙으로 날짜가
 *    이미 결정되는 루틴 방문이라 수동 확정 불필요 (2026-07-14 결정). 특별점검만 planned(수동 확정)
 *  - 기준일 이전 날짜의 항목은 생성 안 함 (최초 점검 전 이행 의무 없음 — 올해 안 기준일의 2차 역행 방지)
 *  이미 존재하는 (plan, customer, sequence) 항목은 UNIQUE 충돌로 건너뜀 — 매년 재실행해도 안전(멱등)
 *  @returns 새로 생성된 항목 수 */
export async function generateYearlyPlanItems(
  admin: Admin,
  customer: PlanCustomer,
  targetYear: number,
  createdBy: string,
  hdSet: Set<string>,
): Promise<number> {
  const { inspection_type, assigned_employee_id } = customer

  const anchorDate = (await loadAnchorDates(admin, [customer])).get(customer.id)
  if (!anchorDate) return 0

  // 고객 컬럼(category/sub_type) 기준 유도 — inspection_type 유도식은 일반관리를 전부 '작동'으로
  // 오판했음 (소방계획서_6 W-7 버그 수정). 컬럼 미보유 레거시만 inspection_type 폴백
  const inspection_category = customer.inspection_category
    ?? (inspection_type === '일반관리' ? '일반관리' : '소방안전관리')
  const inspection_sub_type: '종합' | '작동' = customer.inspection_sub_type === '종합' ? '종합'
    : customer.inspection_sub_type === '작동' ? '작동'
    : inspection_type === '종합' ? '종합' : '작동'
  const isGeneral = inspection_category === '일반관리'

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

  // 행 단위 유형 — 고객 단위 값을 전 행에 그대로 주입하면 2차가 종합으로 저장된다.
  // **2차는 법적으로 작동점검**이므로 행마다 실제 유형을 실어 보낸다 (소방계획서_33 D33-1, lib/inspection-round).
  // 관리유형 판정은 category 축(isGeneral)이 정본이라 inspection_type 대신 그것으로 넘긴다.
  const rowTypeFor = (seq: 1 | 2): InspectionType =>
    isGeneral ? inspection_type : rowInspectionType(inspection_sub_type, inspection_sub_type, seq)

  // 특별점검 월 정의
  const specialKey = new Set<string>()
  const toCreate: Array<{
    year: number; month: number; sequence_num: 1 | 2; planType: string
    rowType: InspectionType; rowSub: '종합' | '작동'
  }> = []

  // 1차 특별점검 (사용승인월) — 고객의 점검 종류 그대로
  specialKey.add(`${targetYear}-${approvalMonth}`)
  toCreate.push({
    year: targetYear, month: approvalMonth, sequence_num: 1,
    planType: rowPlanType(inspection_sub_type, 1),
    rowType: rowTypeFor(1), rowSub: rowSubType(inspection_sub_type, 1),
  })

  // 종합 대상: +6개월 2차 특별점검 — 2차 자체는 **작동**점검이다.
  // (판정은 고객 축 inspection_sub_type으로, 저장은 행 축 '작동'으로 — 두 축이 다르다)
  if (inspection_sub_type === '종합') {
    const mo2 = ((approvalMonth - 1 + 6) % 12) + 1
    specialKey.add(`${targetYear}-${mo2}`)
    toCreate.push({
      year: targetYear, month: mo2, sequence_num: 2, planType: rowPlanType(inspection_sub_type, 2),
      rowType: rowTypeFor(2), rowSub: rowSubType(inspection_sub_type, 2),
    })
  }

  // targetYear 나머지 월: monthly 정기점검 (특별월 제외) — 일반관리는 정기 미생성(D-1)
  // 단, 이미 지난 달의 정기는 생성 생략 — 중도 등록·올해 보정 시 수행 불가한 과거
  // 유령 항목이 쌓이는 것 방지. 특별점검은 법정 의무라 과거여도 생성(초과 해결 플로우 대상).
  const kstNow   = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const curYear  = kstNow.getUTCFullYear()
  const curMonth = kstNow.getUTCMonth() + 1
  if (!isGeneral) {
    for (let m = 1; m <= 12; m++) {
      if (specialKey.has(`${targetYear}-${m}`)) continue
      if (targetYear < curYear || (targetYear === curYear && m < curMonth)) continue
      toCreate.push({
        year: targetYear, month: m, sequence_num: 1, planType: 'monthly',
        rowType: inspection_type, rowSub: inspection_sub_type,
      })
    }
  }

  // ── 왕복 줄이기 ──────────────────────────────────────────────────────────
  // 종전에는 항목마다 `inspection_plans` 조회 + 없으면 insert + `plan_items` insert를 **직렬로** 돌았다.
  // 고객 등록 한 번이 최대 12개월 × 2~3왕복이라, 왕복 200ms인 원격 DB에서 계획 생성에만
  // 2.4초(6건)~5초(12건)가 들었다(실측 — _probe-customer-create-latency.mts).
  // 월은 최대 12개로 정해져 있으므로 **한 번에 조회하고 없는 것만 한 번에 만든다**.
  const months = [...new Set(toCreate.map(c => c.month))]
  const planIdOf = new Map<string, string>()   // `${year}-${month}` → plan_id
  {
    const { data: plans } = await admin.from('inspection_plans')
      .select('id, year, month').eq('year', targetYear).in('month', months)
    for (const p of (plans ?? []) as Array<{ id: string; year: number; month: number }>) {
      planIdOf.set(`${p.year}-${p.month}`, p.id)
    }
    const missing = months.filter(m => !planIdOf.has(`${targetYear}-${m}`))
    if (missing.length > 0) {
      // 동시 등록이 겹치면 UNIQUE 충돌이 날 수 있다 — 무시하고 아래에서 다시 읽는다(멱등)
      await admin.from('inspection_plans').upsert(
        missing.map(m => ({ year: targetYear, month: m, status: 'draft', auto_generated: true, created_by: createdBy })) as Record<string, unknown>[],
        { onConflict: 'year,month', ignoreDuplicates: true },
      )
      const { data: after } = await admin.from('inspection_plans')
        .select('id, year, month').eq('year', targetYear).in('month', missing)
      for (const p of (after ?? []) as Array<{ id: string; year: number; month: number }>) {
        planIdOf.set(`${p.year}-${p.month}`, p.id)
      }
    }
  }

  const rows: Record<string, unknown>[] = []
  for (const { year, month, sequence_num, planType, rowType, rowSub } of toCreate) {
    const planId = planIdOf.get(`${year}-${month}`) ?? null
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

    const isMonthly = planType === 'monthly'
    rows.push({
      plan_id: planId,
      customer_id: customer.id,
      inspection_type: rowType,
      inspection_category,
      inspection_sub_type: rowSub,
      sequence_num,
      assigned_employee_id: assigned_employee_id || null,
      planned_date: planned,
      scheduled_date: isMonthly ? planned : null,
      status: isMonthly ? 'confirmed' : 'planned',
      plan_type: planType,
    })
  }
  if (rows.length === 0) return 0

  // 이미 있는 (plan, customer, sequence)는 건너뛴다 — 종전 건별 insert의 23505 무시와 같은 멱등성을
  // 한 번의 왕복으로 얻는다(005의 UNIQUE(plan_id, customer_id, sequence_num)).
  // ignoreDuplicates 이므로 select()로 돌아오는 건 **실제로 새로 만들어진 행**뿐이다.
  const { data: inserted, error } = await admin.from('inspection_plan_items')
    .upsert(rows, { onConflict: 'plan_id,customer_id,sequence_num', ignoreDuplicates: true })
    .select('id')
  if (error) return 0
  return (inserted ?? []).length
}
