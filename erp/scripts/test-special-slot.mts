/** 특별점검 자리 교체 계획 — **순수·무서버·무DB**
 *  실행: npx tsx scripts/test-special-slot.mts
 *
 *  고정하는 결함: 기산월이 바뀌어도 특별점검이 법정 달로 안 간다. 재계산은 (연,월)을 안 옮기고,
 *  생성기는 insert 전용인데 정기(monthly)도 seq=1이라 그 자리를 점유하면 UNIQUE 충돌로
 *  **조용히 건너뛴다**. 실측(서림사): 기산월 11인데 2026-11이 '특별 0건 · 정기 1건'이었다.
 */
import { planSpecialSlots, planDemoteStraySpecials, type SlotRow } from '../src/lib/plan-special-slot.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${n}${ok || !d ? '' : ` — ${d}`}`) }

const row = (o: Partial<SlotRow> & { id: string; month: number }): SlotRow => ({
  year: 2026, sequence_num: 1, plan_type: 'monthly', status: 'confirmed', started: false, ...o,
})

console.log('— 서림사 실황 재현 (기산월 11 · 1차 종합 / 2차 작동 5월)')
{
  // 실제 DB 실측 그대로: 07에 시작된 작동, 05에 2차, 11에 정기
  const rows: SlotRow[] = [
    row({ id: 'jul', month: 7, plan_type: 'special_작동', status: 'completed', started: true }),
    row({ id: 'may', month: 5, sequence_num: 2, plan_type: 'special_작동', status: 'planned' }),
    row({ id: 'nov', month: 11, plan_type: 'monthly' }),
    row({ id: 'aug', month: 8, plan_type: 'monthly' }),
  ]
  const desired = [
    { sequence_num: 1, month: 11, planType: 'special_종합' },
    { sequence_num: 2, month: 5, planType: 'special_작동' },
  ]
  const p = planSpecialSlots(2026, desired, rows)
  check('11월 정기를 종합점검으로 승격한다',
    p.ops.some(o => o.kind === 'toSpecial' && o.id === 'nov' && o.planType === 'special_종합'),
    JSON.stringify(p.ops))
  check('5월 2차는 이미 제자리라 건드리지 않는다', !p.ops.some(o => o.id === 'may'))
  check('7월 완료 건은 손대지 않는다', !p.ops.some(o => o.id === 'jul'))
  check('7월 완료 건을 keptStarted로 알린다',
    p.keptStarted.length === 1 && p.keptStarted[0].id === 'jul', JSON.stringify(p.keptStarted))
  check('생성 필요 없음(교체로 해결)', p.needCreate.length === 0, JSON.stringify(p.needCreate))
  check('무관한 8월 정기는 그대로', !p.ops.some(o => o.id === 'aug'))

  // 강등: 7월은 시작됐으므로 강등 대상이 아니다
  const dem = planDemoteStraySpecials(2026, desired, rows, new Set(p.ops.map(o => o.id)))
  check('시작된 7월 특별은 강등하지 않는다', dem.length === 0, JSON.stringify(dem))
}

console.log('\n— 미시작 특별이 엉뚱한 달에 있을 때 (강등 대상)')
{
  const rows: SlotRow[] = [
    row({ id: 'jul', month: 7, plan_type: 'special_종합', status: 'planned' }),   // 미시작
    row({ id: 'nov', month: 11, plan_type: 'monthly' }),
  ]
  const desired = [{ sequence_num: 1, month: 11, planType: 'special_종합' }]
  const p = planSpecialSlots(2026, desired, rows)
  const dem = planDemoteStraySpecials(2026, desired, rows, new Set(p.ops.map(o => o.id)))
  check('11월 정기 → 특별 승격', p.ops.some(o => o.kind === 'toSpecial' && o.id === 'nov'))
  check('7월 미시작 특별 → 정기 강등', dem.some(o => o.kind === 'toMonthly' && o.id === 'jul'), JSON.stringify(dem))
  check('한 해에 특별이 둘로 남지 않는다',
    p.ops.filter(o => o.kind === 'toSpecial').length === 1 && dem.length === 1)
}

console.log('\n— 자리가 비어 있으면 교체가 아니라 생성 (일반관리처럼 정기가 없는 경우)')
{
  const rows: SlotRow[] = [row({ id: 'jul', month: 7, plan_type: 'special_작동', status: 'planned' })]
  const desired = [{ sequence_num: 1, month: 11, planType: 'special_작동' }]
  const p = planSpecialSlots(2026, desired, rows)
  check('11월은 생성 필요로 보고한다',
    p.needCreate.length === 1 && p.needCreate[0].month === 11, JSON.stringify(p.needCreate))
  check('승격 op는 없다(막는 정기가 없다)', !p.ops.some(o => o.kind === 'toSpecial'))
}

console.log('\n— 이미 법정 달에 있으면 종류만 정정')
{
  const rows: SlotRow[] = [row({ id: 'nov', month: 11, plan_type: 'special_작동', status: 'planned' })]
  const desired = [{ sequence_num: 1, month: 11, planType: 'special_종합' }]
  const p = planSpecialSlots(2026, desired, rows)
  check('작동 → 종합으로 종류만 바꾼다',
    p.ops.length === 1 && p.ops[0].kind === 'toSpecial' && p.ops[0].planType === 'special_종합')
}

console.log('\n— 멱등: 이미 맞으면 아무것도 하지 않는다')
{
  const rows: SlotRow[] = [
    row({ id: 'nov', month: 11, plan_type: 'special_종합', status: 'planned' }),
    row({ id: 'may', month: 5, sequence_num: 2, plan_type: 'special_작동', status: 'planned' }),
  ]
  const desired = [
    { sequence_num: 1, month: 11, planType: 'special_종합' },
    { sequence_num: 2, month: 5, planType: 'special_작동' },
  ]
  const p = planSpecialSlots(2026, desired, rows)
  const dem = planDemoteStraySpecials(2026, desired, rows, new Set())
  check('op 0건 · 생성 0건 · 강등 0건', p.ops.length === 0 && p.needCreate.length === 0 && dem.length === 0,
    JSON.stringify({ ops: p.ops, need: p.needCreate, dem }))
}

console.log('\n— 한 행을 두 자리에 쓰지 않는다 (claimed 축)')
{
  // 1차·2차가 같은 달을 원하는 건 불가능하지만, seq가 다르면 같은 달에 공존할 수 있어야 한다
  const rows: SlotRow[] = [
    row({ id: 'nov1', month: 11, sequence_num: 1, plan_type: 'monthly' }),
    row({ id: 'nov2', month: 11, sequence_num: 2, plan_type: 'monthly' }),
  ]
  const desired = [
    { sequence_num: 1, month: 11, planType: 'special_종합' },
    { sequence_num: 2, month: 11, planType: 'special_작동' },
  ]
  const p = planSpecialSlots(2026, desired, rows)
  const ids = p.ops.map(o => o.id)
  check('seq별로 서로 다른 행을 집는다', ids.length === 2 && new Set(ids).size === 2, JSON.stringify(ids))
}

console.log('\n— 다른 해는 건드리지 않는다')
{
  const rows: SlotRow[] = [
    row({ id: 'n26', month: 11, year: 2026, plan_type: 'monthly' }),
    row({ id: 'n27', month: 11, year: 2027, plan_type: 'monthly' }),
  ]
  const p = planSpecialSlots(2026, [{ sequence_num: 1, month: 11, planType: 'special_종합' }], rows)
  check('2026만 대상', p.ops.length === 1 && p.ops[0].id === 'n26', JSON.stringify(p.ops))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
