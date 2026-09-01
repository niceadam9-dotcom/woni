/** 특별점검이 **법정 달**에 앉게 하는 자리 교체 계획 — 순수 함수(DB 접근 없음).
 *
 *  ## 왜 필요한가
 *  기산월이 바뀌어도 기존 계획 항목의 **달은 옮겨지지 않는다**:
 *   · `_resetPlanItemsForCustomer`는 항목이 이미 속한 (연,월) 안에서 **날짜(일)만** 다시 계산한다.
 *   · 생성기는 insert 전용인데, 정기(monthly)도 `sequence_num=1`이라 법정 달의 자리를 이미
 *     점유하고 있으면 `UNIQUE(plan_id, customer_id, sequence_num)` 충돌로 **조용히 건너뛴다**.
 *  실측(서림사): 기산월 11인데 2026-11·2027-11이 '특별 0건 · 정기 1건'이었다.
 *
 *  ## 무엇을 하는가
 *  같은 (연) 안에서 **정기 ↔ 특별의 자리를 바꾼다**. plan_id를 옮기지 않고 **행의 종류만 바꾸므로**
 *  UNIQUE 축을 건드리지 않는다(옮기면 충돌이 되살아난다).
 *
 *  ## 절대 건드리지 않는 것
 *  **시작된 점검(started)**. 그건 사실 기록이다 — 나중에 고객 유형이 바뀌었다고 이미 수행한
 *  점검의 종류를 소급해 바꾸면 법정 서식 허위 기재가 된다. 그래서 후보에서 제외하고,
 *  그 달에 특별이 이미 '있었다'고도 치지 않는다(따로 `keptStarted`로 알린다).
 */

export type SlotRow = {
  id: string
  year: number
  month: number
  sequence_num: number
  /** 'special_종합' | 'special_작동' | 'monthly' | 'event' | null */
  plan_type: string | null
  status: string
  /** 점검이 시작된 행 — 불가침 */
  started: boolean
}

export type SlotOp =
  /** 정기 행을 특별점검으로 승격 — 법정 달의 자리를 비워 받는다 */
  | { kind: 'toSpecial'; id: string; year: number; month: number; planType: string; from: string | null }
  /** 엉뚱한 달의 미시작 특별(1차)을 정기로 강등 — 비운 자리를 정기가 메운다 */
  | { kind: 'toMonthly'; id: string; year: number; month: number; from: string | null }
  /** 엉뚱한 달의 미시작 **2차** 잔재를 삭제 — 정기로 내리면 안 된다.
   *  정기는 언제나 `sequence_num=1`로 만들어지므로 seq=2 정기는 데이터 이상이고,
   *  같은 달에 정기가 **두 건** 뜬다(실측: 2027-05에 seq=1·seq=2 정기가 나란히 찍혔다). */
  | { kind: 'remove'; id: string; year: number; month: number; from: string | null }
  /** 자리가 아예 비어 **새로 만들어야** 하는 것 — 교체할 행이 없다(2차가 늘 이 경우다).
   *
   *  ⚠ 이걸 **별도 배열로 빼 뒀던 것이 결함의 근본 원인**이었다. 이름은 "만들어 달라"는
   *  요청인데 타입은 그냥 배열이라 **집행부가 무시해도 컴파일이 통과**했고, 실제로 무시됐다.
   *  op 유니온에 넣어 집행부가 `switch`로 **소진**하게 하면 빠뜨리는 순간 빌드가 깨진다. */
  | { kind: 'create'; year: number; month: number; sequence_num: number; planType: string }

export type SlotPlan = {
  ops: SlotOp[]
  /** 시작돼서 손대지 않은 특별 행 — 사람이 알아야 한다 */
  keptStarted: Array<{ id: string; year: number; month: number; plan_type: string | null }>
  /** 자리가 비어 **생성**이 필요한 것 — `ops`의 `create` op와 **같은 것**을 보기 좋게 추린 사본이다.
   *  집행은 반드시 `ops`를 소진해서 한다(여기만 보면 다시 요청서를 버리는 구조가 된다). */
  needCreate: Array<{ year: number; month: number; sequence_num: number; planType: string }>
  notes: string[]
}

const isSpecial = (t: string | null) => !!t?.startsWith('special_')

/** 한 해의 특별점검 자리를 법정 달로 맞추는 계획을 세운다.
 *  @param desired 이 해에 있어야 할 특별점검 — [{sequence_num, month, planType}]
 *  @param rows    그 해 그 고객의 계획 항목 전부(정기 포함) */
export function planSpecialSlots(
  year: number,
  desired: Array<{ sequence_num: number; month: number; planType: string }>,
  rows: SlotRow[],
): SlotPlan {
  const ops: SlotOp[] = []
  const notes: string[] = []
  const needCreate: SlotPlan['needCreate'] = []
  const yearRows = rows.filter(r => r.year === year)
  const keptStarted = yearRows
    .filter(r => r.started && isSpecial(r.plan_type))
    .map(r => ({ id: r.id, year: r.year, month: r.month, plan_type: r.plan_type }))

  /** 이번 계획에서 이미 승격시킨 행 — 한 행이 두 자리에 쓰이면 안 된다 */
  const claimed = new Set<string>()

  for (const d of desired) {
    const atTarget = yearRows.filter(r => r.month === d.month && r.sequence_num === d.sequence_num)
    const specialAtTarget = atTarget.find(r => isSpecial(r.plan_type))
    if (specialAtTarget) {
      // 이미 법정 달에 특별이 있다 — 종류만 다르면 맞춰 준다(작동↔종합 전환 후 잔재)
      if (specialAtTarget.plan_type !== d.planType && !specialAtTarget.started && !claimed.has(specialAtTarget.id)) {
        claimed.add(specialAtTarget.id)
        ops.push({ kind: 'toSpecial', id: specialAtTarget.id, year, month: d.month, planType: d.planType, from: specialAtTarget.plan_type })
        notes.push(`${year}-${pad(d.month)} seq=${d.sequence_num}: 특별 종류 정정 ${specialAtTarget.plan_type} → ${d.planType}`)
      }
      continue
    }

    const blocker = atTarget.find(r => !isSpecial(r.plan_type) && !r.started && !claimed.has(r.id))
    if (blocker) {
      claimed.add(blocker.id)
      ops.push({ kind: 'toSpecial', id: blocker.id, year, month: d.month, planType: d.planType, from: blocker.plan_type })
      notes.push(`${year}-${pad(d.month)} seq=${d.sequence_num}: 정기가 자리를 막고 있었다 → 특별(${d.planType})로 승격`)
    } else if (atTarget.some(r => r.started)) {
      notes.push(`⚠ ${year}-${pad(d.month)} seq=${d.sequence_num}: 그 자리 항목이 이미 시작됨 — 건드리지 않는다`)
    } else {
      // 요청서를 **op로 발행한다** — 집행부가 switch로 소진하므로 빠뜨리면 컴파일이 깨진다
      ops.push({ kind: 'create', year, month: d.month, sequence_num: d.sequence_num, planType: d.planType })
      needCreate.push({ year, month: d.month, sequence_num: d.sequence_num, planType: d.planType })
      notes.push(`${year}-${pad(d.month)} seq=${d.sequence_num}: 자리가 비어 있다 → 생성 필요(교체 아님)`)
    }
  }

  // 법정 달이 아닌 곳에 남은 **미시작** 특별은 정기로 강등한다 — 안 그러면 한 해에 특별이 둘이 된다.
  // 시작된 것은 제외(사실 기록). 일반관리처럼 정기가 없는 고객은 강등 대신 그대로 두는 편이 나으므로
  // 호출부가 `demote=false`로 끌 수 있게 아래 별도 함수로 분리했다.
  return { ops, keptStarted, needCreate, notes }
}

/** 법정 달 밖의 **미시작** 특별을 치운다. **어느 고객이든 반드시 치운다** — 안 치우면 옛 달의
 *  특별이 남아 한 해에 1차가 둘이 된다(실측: 운영 C003이 2026-02·2026-08에 종합 2건).
 *
 *  치우는 **방법**만 갈린다:
 *   · 정기 체계가 있는 고객(소방안전관리) + 1차(seq=1) → **정기로 강등**(그 달엔 원래 정기가 있어야 한다)
 *   · 그 밖(2차이거나, 정기 체계가 없는 일반관리) → **삭제**
 *     2차를 정기로 내리면 seq=2 정기가 되어 같은 달에 정기가 둘로 뜬다. 일반관리는 정기 자체가
 *     없으므로(D-1) 강등하면 **있어서는 안 될 정기**를 만든다.
 *
 *  ⚠ 종전엔 일반관리를 통째로 건너뛰었다 — "강등하면 안 된다"가 "아무것도 하지 않는다"로
 *    번져 옛 특별이 그대로 남았다. **하면 안 되는 것과 안 해도 되는 것은 다르다.** */
export function planDemoteStraySpecials(
  year: number,
  desired: Array<{ sequence_num: number; month: number }>,
  rows: SlotRow[],
  alreadyClaimed: Set<string> = new Set(),
  /** 이 고객에게 정기(monthly) 체계가 있는가 — 없으면 강등 대신 삭제한다 */
  hasMonthly = true,
): Array<Extract<SlotOp, { kind: 'toMonthly' | 'remove' }>> {
  const want = new Set(desired.map(d => `${d.month}-${d.sequence_num}`))
  return rows
    .filter(r => r.year === year && isSpecial(r.plan_type) && !r.started && !alreadyClaimed.has(r.id))
    .filter(r => !want.has(`${r.month}-${r.sequence_num}`))
    .map(r => (r.sequence_num === 2 || !hasMonthly)
      ? { kind: 'remove' as const, id: r.id, year, month: r.month, from: r.plan_type }
      : { kind: 'toMonthly' as const, id: r.id, year, month: r.month, from: r.plan_type })
}

/** 있어서는 안 되는 **정기(monthly) 잔재**를 지우는 op — 기산월이 바뀐 뒤 남는 것들.
 *
 *  둘을 지운다(둘 다 **미시작**만):
 *   ① `sequence_num=2`인 정기 — 정기는 언제나 seq=1로 만들어진다. seq=2 정기는 옛 2차를
 *      강등했던 잔재이고, 같은 달에 정기가 **두 건** 뜬다(실측 2027-05).
 *   ② **특별점검 달에 있는 정기** — 생성기는 특별월을 정기에서 제외한다(`specialKey`).
 *      기산월이 바뀌어 그 달이 새로 특별이 되면 옛 정기가 남아 한 달에 방문이 둘로 보인다(실측 2026-12).
 *
 *  ⚠ 특별점검 자체는 건드리지 않는다 — 그건 `planSpecialSlots`·`planDemoteStraySpecials`의 몫이다. */
export function planStrayMonthly(
  year: number,
  desired: Array<{ sequence_num: number; month: number }>,
  rows: SlotRow[],
): Array<Extract<SlotOp, { kind: 'remove' }>> {
  const specialMonths = new Set(desired.map(d => d.month))
  return rows
    .filter(r => r.year === year && !isSpecial(r.plan_type) && r.plan_type === 'monthly' && !r.started)
    .filter(r => r.sequence_num === 2 || specialMonths.has(r.month))
    .map(r => ({ kind: 'remove' as const, id: r.id, year, month: r.month, from: r.plan_type }))
}

const pad = (n: number) => String(n).padStart(2, '0')
