import type { createAdminClient } from '@/lib/supabase/admin'
import { resolveAnchor, plannedDateFor } from '@/lib/plan-anchor'
import { planSpecialSlots, planDemoteStraySpecials, type SlotRow } from '@/lib/plan-special-slot'
import { rowInspectionType } from '@/lib/inspection-round'
import type { InspectionType } from '@/types'

type Admin = ReturnType<typeof createAdminClient>

export type ReconcileResult = {
  promoted: number
  demoted: number
  /** 시작된 점검이라 손대지 않은 특별 — 사람이 알아야 한다 */
  keptStarted: number
  /** 자리가 비어 교체로는 못 만든 것 — 생성기가 만들어야 한다 */
  needCreate: number
  notes: string[]
}

/** **변동 = 재계산** — 기산점·점검종류가 바뀌면 특별점검이 법정 달에 앉도록 자리를 다시 맞춘다.
 *
 *  ## 왜 이게 따로 필요한가
 *  종전엔 어느 경로로도 특별점검의 **달이 옮겨지지 않았다**:
 *   · `_resetPlanItemsForCustomer`는 `plan_id`를 건드리지 않는다 — 항목이 속한 (연,월) 안에서
 *     **일자만** 다시 계산한다(전수 grep으로 확인: 그 파일에서 plan_id는 주석에만 나온다).
 *   · 생성기는 insert 전용인데 정기(monthly)도 `sequence_num=1`이라 법정 달을 점유하고 있으면
 *     `UNIQUE(plan_id, customer_id, sequence_num)` 충돌로 **조용히 건너뛴다**.
 *  결과: 소방안전관리는 특별이 **안 생기고**, 일반관리는 새 달에 **중복 생성**됐다.
 *
 *  ## 어떻게 하는가
 *  `plan_id`를 옮기지 않고 **행의 종류만 맞바꾼다**(정기↔특별). 옮기면 UNIQUE 충돌이 되살아난다.
 *
 *  ## 불가침
 *  **시작된 점검**은 건드리지 않는다. 이미 수행한 점검의 종류를 소급해 바꾸면 법정 서식
 *  허위 기재가 된다. 후보에서 빼고 `keptStarted`로 알린다.
 *
 *  ⚠ 확정된 정기를 특별로 올릴 때 `status`를 `planned`로 내리고 예정일을 비운다 —
 *    특별점검은 수동 확정이 규약이라, 정기의 자동 확정 상태를 물려받으면 '누가 언제 확정했는지'가
 *    거짓이 된다. 반대로 특별→정기는 자동 확정 규약대로 날짜를 채운다. */
export async function reconcileSpecialSlots(
  admin: Admin,
  customerId: string,
  years: number[],
): Promise<ReconcileResult> {
  const out: ReconcileResult = { promoted: 0, demoted: 0, keptStarted: 0, needCreate: 0, notes: [] }

  const { data: cRaw } = await admin.from('customers')
    .select('id, use_approval_date, plan_anchor_date, inspection_type, inspection_category, inspection_sub_type')
    .eq('id', customerId).maybeSingle()
  if (!cRaw) return out
  const c = cRaw as {
    use_approval_date: string | null; plan_anchor_date: string | null
    inspection_type: InspectionType; inspection_category: string | null; inspection_sub_type: string | null
  }

  // plan_anchor_manual은 없는 컬럼일 수 있다(155 미적용) — 관용 조회
  let manual: boolean | undefined
  {
    const { data, error } = await admin.from('customers')
      .select('plan_anchor_manual').eq('id', customerId).maybeSingle()
    if (!error) {
      const v = (data as { plan_anchor_manual?: unknown } | null)?.plan_anchor_manual
      if (typeof v === 'boolean') manual = v
    }
  }

  const anchor = resolveAnchor({
    use_approval_date: c.use_approval_date, plan_anchor_date: c.plan_anchor_date, plan_anchor_manual: manual,
  })
  if (!anchor.date) { out.notes.push('기산점 없음 — 재계산 대상 아님'); return out }
  const ad = new Date(anchor.date)
  const anchorMonth = ad.getMonth() + 1
  const anchorDay = ad.getDate()

  const sub: '종합' | '작동' = c.inspection_sub_type === '종합' ? '종합'
    : c.inspection_sub_type === '작동' ? '작동'
    : c.inspection_type === '종합' ? '종합' : '작동'
  const isGeneral = (c.inspection_category ?? (c.inspection_type === '일반관리' ? '일반관리' : '소방안전관리')) === '일반관리'

  const desired = [{ sequence_num: 1, month: anchorMonth, planType: `special_${sub}` }]
  if (sub === '종합') desired.push({ sequence_num: 2, month: ((anchorMonth - 1 + 6) % 12) + 1, planType: 'special_작동' })

  const { data: itemsRaw } = await admin.from('inspection_plan_items')
    .select('id, sequence_num, plan_type, status, inspection_id, plan:inspection_plans(year, month)')
    .eq('customer_id', customerId)
  type Raw = {
    id: string; sequence_num: number; plan_type: string | null; status: string
    inspection_id: string | null; plan: { year: number; month: number } | null
  }
  const rows: SlotRow[] = ((itemsRaw ?? []) as unknown as Raw[])
    .filter(r => r.plan)
    .map(r => ({
      id: r.id, year: r.plan!.year, month: r.plan!.month, sequence_num: r.sequence_num,
      plan_type: r.plan_type, status: r.status, started: !!r.inspection_id,
    }))

  // 강등(특별→정기)에 예정일이 필요하다 — 생성기와 **같은** 규칙을 쓴다
  let holidays: Set<string> | null = null
  const loadHolidays = async (): Promise<Set<string>> => {
    if (holidays) return holidays
    const lo = Math.min(...years), hi = Math.max(...years)
    const { data } = await admin.from('holidays').select('date')
      .gte('date', `${lo}-01-01`).lte('date', `${hi}-12-31`)
    holidays = new Set((data ?? []).map(h => (h as { date: string }).date))
    return holidays
  }

  for (const year of years) {
    const plan = planSpecialSlots(year, desired, rows)
    out.keptStarted += plan.keptStarted.length
    out.needCreate += plan.needCreate.length
    out.notes.push(...plan.notes)

    // planSpecialSlots는 승격만 낸다 — 그래도 유니온을 좁혀 두면 나중에 강등 op가 섞여도
    // 조용히 잘못 처리되지 않고 타입이 막는다.
    for (const op of plan.ops.filter(o => o.kind === 'toSpecial')) {
      const s = op.planType.slice('special_'.length) as '종합' | '작동'
      const { error } = await admin.from('inspection_plan_items').update({
        plan_type: op.planType,
        inspection_sub_type: s,
        inspection_type: rowInspectionType(c.inspection_type, sub, s === '작동' && sub === '종합' ? 2 : 1),
        status: 'planned',
        scheduled_date: null,
      } as Record<string, unknown>).eq('id', op.id)
      if (!error) out.promoted++
    }

    // 정기 체계가 없는 일반관리는 강등할 곳이 없다 — 엉뚱한 달의 특별을 정기로 바꾸면
    // 있어서는 안 될 정기가 생긴다(D-1: 일반관리는 정기 미생성).
    if (isGeneral) continue
    const claimed = new Set(plan.ops.map(o => o.id))
    const demotes = planDemoteStraySpecials(year, desired, rows, claimed)
    for (const op of demotes) {
      const hd = await loadHolidays()
      const { error } = await admin.from('inspection_plan_items').update({
        plan_type: 'monthly',
        inspection_type: c.inspection_type,
        inspection_sub_type: sub,
        // 정기는 자동 확정이 규약이다(2026-07-14 결정) — 기산일 규칙으로 날짜가 이미 정해진다
        status: 'confirmed',
        scheduled_date: plannedDateFor(op.year, op.month, anchorDay, hd),
      } as Record<string, unknown>).eq('id', op.id)
      if (!error) { out.demoted++; out.notes.push(`${op.year}-${String(op.month).padStart(2, '0')}: ${op.from} → monthly(강등)`) }
    }
  }
  return out
}
