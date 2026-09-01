import type { createAdminClient } from '@/lib/supabase/admin'
import { resolveAnchor, plannedDateFor } from '@/lib/plan-anchor'
import { planSpecialSlots, planDemoteStraySpecials, planStrayMonthly, type SlotRow } from '@/lib/plan-special-slot'
import { rowInspectionType } from '@/lib/inspection-round'
import { generateYearlyPlanItems, loadHolidaySet } from '@/lib/inspection-plan-generator'
import type { InspectionType } from '@/types'

type Admin = ReturnType<typeof createAdminClient>

export type ReconcileResult = {
  promoted: number
  demoted: number
  /** 지운 잔재 수 — 엉뚱한 달의 2차, 그리고 있어서는 안 되는 정기 */
  removed: number
  /** 자리가 비어 **생성기가 새로 만든** 항목 수 */
  created: number
  /** 시작된 점검이라 손대지 않은 특별 — 사람이 알아야 한다 */
  keptStarted: number
  /** 자리가 비어 교체로는 못 만든 것(생성기에 넘긴 수) */
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
  /** 생성기가 만든 행의 created_by — **필수**다. 없으면 2차를 못 만들고 조용히 빠진다 */
  createdBy: string,
): Promise<ReconcileResult> {
  const out: ReconcileResult = { promoted: 0, demoted: 0, removed: 0, created: 0, keptStarted: 0, needCreate: 0, notes: [] }

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

  /** switch가 모아 둔 생성 요청 — 생성기는 연 단위 일괄이라 루프 밖에서 한 번에 돈다 */
  const pendingCreate: Array<{ year: number; month: number; sequence_num: number; planType: string }> = []

  for (const year of years) {
    const plan = planSpecialSlots(year, desired, rows)
    out.keptStarted += plan.keptStarted.length
    out.needCreate += plan.needCreate.length
    out.notes.push(...plan.notes)

    // ⚠ 일반관리도 **치우기는 한다** — 방법만 다르다(강등 대신 삭제). 종전엔 통째로 건너뛰어
    //   옛 달의 특별이 남았고, 그래서 운영 C003에 2026-02·2026-08 종합이 **둘** 생겼다.
    //   '하면 안 되는 것'과 '안 해도 되는 것'은 다르다.
    const claimed = new Set(plan.ops.flatMap(o => (o.kind === 'create' ? [] : [o.id])))
    const demotes = planDemoteStraySpecials(year, desired, rows, claimed, !isGeneral)

    // ⭐ **op을 switch로 소진한다.** 종전엔 `filter(kind === 'toSpecial')`로 골라 쓰고
    //   `create`는 별도 배열에 남아 **아무도 안 읽어도 컴파일이 통과**했다 — 그게 결함의
    //   근본 원인이었다. 아래 `never` 가드가 새 op 종류를 빠뜨리는 순간 빌드를 깨뜨린다.
    //   무엇을 지우고 무엇을 내릴지의 **판단은 순수 계층**이 하고, 여기선 집행만 한다.
    for (const op of [...plan.ops, ...demotes]) {
      switch (op.kind) {
        case 'toSpecial': {
          const s = op.planType.slice('special_'.length) as '종합' | '작동'
          const { error } = await admin.from('inspection_plan_items').update({
            plan_type: op.planType,
            inspection_sub_type: s,
            inspection_type: rowInspectionType(c.inspection_type, sub, s === '작동' && sub === '종합' ? 2 : 1),
            status: 'planned',
            scheduled_date: null,
          } as Record<string, unknown>).eq('id', op.id)
          if (!error) out.promoted++
          break
        }
        case 'toMonthly': {
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
          break
        }
        case 'remove': {
          const { error } = await admin.from('inspection_plan_items').delete().eq('id', op.id)
          if (!error) { out.removed++; out.notes.push(`${op.year}-${String(op.month).padStart(2, '0')}: 잔재 삭제(${op.from})`) }
          break
        }
        case 'create':
          // 행 단위 update가 아니라 **생성기 일괄 호출**이라 여기서 모아 두고 아래에서 한 번에 돈다
          pendingCreate.push(op)
          break
        default: {
          // 새 op 종류를 추가하고 여기에 case를 안 넣으면 **컴파일 오류**가 난다
          const _never: never = op
          void _never
        }
      }
    }
  }

  // ⭐ **자리가 비면 만든다.** 여기가 없어서 종합 대상의 2차(작동)가 구조적으로 안 생겼다 —
  //   2차는 seq=2를 요구하는데 그 달엔 정기(seq=1)뿐이라 '막는 행'이 없고, 그래서 교체 대상이
  //   아니라 **생성 대상**으로 분류돼 세기만 하고 끝났다. 반면 옛 달의 2차는 위에서 치우므로
  //   **치우기만 하고 못 만드는 비대칭**이 되어 법정 2차가 계획에서 사라졌다.
  //
  //   생성기는 이미 seq=2를 그 달에 넣을 수 있다 — UNIQUE가 (plan_id, customer_id, sequence_num)이라
  //   같은 달 정기(seq=1)와 충돌하지 않는다. 이미 있는 항목은 충돌 무시로 건너뛴다(멱등).
  if (pendingCreate.length > 0) {
    const hd = await loadHolidaySet(admin, Math.min(...years))
    for (const y of years) {
      out.created += await generateYearlyPlanItems(
        admin,
        {
          id: customerId, inspection_type: c.inspection_type,
          inspection_category: c.inspection_category, inspection_sub_type: c.inspection_sub_type,
          plan_anchor_date: c.plan_anchor_date, use_approval_date: c.use_approval_date,
          plan_anchor_manual: manual, assigned_employee_id: null,
        },
        y, createdBy, hd,
      )
    }
    out.notes.push(`생성 필요 ${out.needCreate}건 → 생성기가 ${out.created}건 생성`)
  }

  // ⭐ **값들 사이의 관계를 본다** — needCreate와 created를 둘 다 세면서 그 둘이 모순인지는
  //   아무도 안 봤다. 이번 결함(요청서를 발행하고 아무도 안 읽음)은 이 한 줄이면 첫 실행에서
  //   드러났다. 집행부가 조용히 요청을 버리는 것을 스스로 말하게 한다.
  //   ⚠ 생성기가 정당하게 0건을 낼 수도 있다(기준일 이전은 생성 안 함 — 첫 해의 2차가 그렇다).
  //     그래서 예외가 아니라 **기록**으로 남긴다. 조용한 것보다 시끄러운 편이 낫다.
  if (out.needCreate > 0 && out.created === 0) {
    out.notes.push(`⚠ 생성 필요 ${out.needCreate}건인데 0건 생성 — 요청서가 버려졌거나 기준일 이전이다`)
  }

  // 있어서는 안 되는 정기 잔재 정리 — **생성 뒤**에 한다. 특별이 자리를 잡아야
  // '그 달이 특별월인가'를 정확히 판정할 수 있다. 일반관리는 정기 자체가 없다.
  if (!isGeneral) {
    const { data: cur } = await admin.from('inspection_plan_items')
      .select('id, sequence_num, plan_type, status, inspection_id, plan:inspection_plans(year, month)')
      .eq('customer_id', customerId)
    const now: SlotRow[] = ((cur ?? []) as unknown as Raw[]).filter(r => r.plan).map(r => ({
      id: r.id, year: r.plan!.year, month: r.plan!.month, sequence_num: r.sequence_num,
      plan_type: r.plan_type, status: r.status, started: !!r.inspection_id,
    }))
    for (const y of years) {
      for (const op of planStrayMonthly(y, desired, now)) {
        const { error } = await admin.from('inspection_plan_items').delete().eq('id', op.id)
        if (!error) { out.removed++; out.notes.push(`${op.year}-${String(op.month).padStart(2, '0')}: 정기 잔재 삭제(${op.from})`) }
      }
    }
  }
  return out
}
