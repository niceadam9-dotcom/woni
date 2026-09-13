/** 특별점검 자리 교체 계획 — **순수·무서버·무DB**
 *  실행: npx tsx scripts/test-special-slot.mts
 *
 *  고정하는 결함: 기산월이 바뀌어도 특별점검이 법정 달로 안 간다. 재계산은 (연,월)을 안 옮기고,
 *  생성기는 insert 전용인데 정기(monthly)도 seq=1이라 그 자리를 점유하면 UNIQUE 충돌로
 *  **조용히 건너뛴다**. 실측(서림사): 기산월 11인데 2026-11이 '특별 0건 · 정기 1건'이었다.
 *
 *  ⚠ 불가침 축은 `started`이지 `status`가 아니다. 종전 픽스처는 미시작을 `status:'planned'`로
 *  적어 뒀는데, 점검확정 폐지(마이그 161·162)로 그 enum 값이 **DB에서 사라졌다**. 그런데도
 *  검사는 초록이었다 — 알고리즘이 status를 **한 번도 읽지 않기 때문**이다(전부 started로 판정).
 *  존재할 수 없는 값을 픽스처가 계약처럼 들고 있으면 다음 사람이 "status가 판정에 쓰인다"고
 *  읽는다. 그래서 중복 지정을 걷어내고(=row()의 기본값 confirmed), 그 계약을 아래에서 단언한다.
 */
import { readFileSync } from 'node:fs'
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
    row({ id: 'may', month: 5, sequence_num: 2, plan_type: 'special_작동' }),
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
    row({ id: 'jul', month: 7, plan_type: 'special_종합' }),   // 미시작
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

console.log('\n— 2차(seq=2) 잔재는 강등이 아니라 삭제')
{
  // 기산월이 11 → 6으로 바뀐 상황: 옛 2차(5월)가 남고, 새 2차는 12월이어야 한다.
  const rows: SlotRow[] = [
    row({ id: 'may2', month: 5, sequence_num: 2, plan_type: 'special_작동' }),
    row({ id: 'jul1', month: 7, sequence_num: 1, plan_type: 'special_종합' }),
    row({ id: 'dec1', month: 12, sequence_num: 1, plan_type: 'monthly' }),
  ]
  const desired = [
    { sequence_num: 1, month: 6, planType: 'special_종합' },
    { sequence_num: 2, month: 12, planType: 'special_작동' },
  ]
  const p = planSpecialSlots(2026, desired, rows)
  const dem = planDemoteStraySpecials(2026, desired, rows, new Set(p.ops.map(o => o.id)))
  const rm = dem.filter(o => o.kind === 'remove')
  const dn = dem.filter(o => o.kind === 'toMonthly')
  check('옛 2차(5월 seq=2)는 삭제한다', rm.length === 1 && rm[0].id === 'may2', JSON.stringify(dem))
  check('옛 1차(7월 seq=1)는 정기로 강등한다', dn.length === 1 && dn[0].id === 'jul1', JSON.stringify(dn))
  // ⭐ 이 결함의 핵심 — 2차가 앉을 12월에는 정기(seq=1)뿐이라 '막는 행'이 없다.
  //    그래서 교체 대상이 아니라 **생성 대상**으로 넘어간다.
  //
  //    ⚠⚠ 이 단언의 **한때 이름이 '교체로는 못 만든다'였고, 그게 결함을 사양으로 승격시켰다**.
  //    한계를 초록으로 박아두면 그게 *중간 상태*인지 *최종 상태*인지 검사가 말하지 않는다.
  //    규칙: **부정형·한계를 단언하는 검사에는 "그럼 누가 하는가"를 단언하는 짝을 반드시 붙인다.**
  //    짝이 없으면 그 초록은 결함의 알리바이가 된다. 아래 짝 단언이 그것이다.
  check('12월 2차는 생성 대상으로 넘어간다(교체가 아니라)',
    p.needCreate.some(n => n.month === 12 && n.sequence_num === 2), JSON.stringify(p.needCreate))
  check('12월 정기(seq=1)는 건드리지 않는다 — seq가 달라 공존한다',
    !p.ops.some(o => o.id === 'dec1') && !dem.some(o => o.id === 'dec1'))
}

console.log('\n— 자리가 비어 있으면 교체가 아니라 생성 (일반관리처럼 정기가 없는 경우)')
{
  const rows: SlotRow[] = [row({ id: 'jul', month: 7, plan_type: 'special_작동' })]
  const desired = [{ sequence_num: 1, month: 11, planType: 'special_작동' }]
  const p = planSpecialSlots(2026, desired, rows)
  check('11월은 생성 필요로 보고한다',
    p.needCreate.length === 1 && p.needCreate[0].month === 11, JSON.stringify(p.needCreate))
  check('승격 op는 없다(막는 정기가 없다)', !p.ops.some(o => o.kind === 'toSpecial'))
}

console.log('\n— 이미 법정 달에 있으면 종류만 정정')
{
  const rows: SlotRow[] = [row({ id: 'nov', month: 11, plan_type: 'special_작동' })]
  const desired = [{ sequence_num: 1, month: 11, planType: 'special_종합' }]
  const p = planSpecialSlots(2026, desired, rows)
  check('작동 → 종합으로 종류만 바꾼다',
    p.ops.length === 1 && p.ops[0].kind === 'toSpecial' && p.ops[0].planType === 'special_종합')
}

console.log('\n— 멱등: 이미 맞으면 아무것도 하지 않는다')
{
  const rows: SlotRow[] = [
    row({ id: 'nov', month: 11, plan_type: 'special_종합' }),
    row({ id: 'may', month: 5, sequence_num: 2, plan_type: 'special_작동' }),
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

console.log('\n— 판정은 status가 아니라 started로 한다 (폐지된 enum에 다시 묶이지 않게)')
{
  // 같은 배치를 status만 바꿔 두 번 돌린다. 결과가 한 글자라도 다르면 알고리즘이 status를
  // 읽고 있다는 뜻이고, 그 순간 이 모듈은 plan_item_status enum의 변경에 다시 묶인다
  // ('planned'가 사라진 것처럼). 미시작·불가침의 유일한 축은 started여야 한다.
  const mk = (status: string): SlotRow[] => [
    row({ id: 'jul', month: 7, plan_type: 'special_종합', status }),
    row({ id: 'nov', month: 11, plan_type: 'monthly', status }),
    row({ id: 'may', month: 5, sequence_num: 2, plan_type: 'special_작동', status }),
  ]
  const desired = [{ sequence_num: 1, month: 11, planType: 'special_종합' }]
  const run = (s: string) => {
    const rows = mk(s)
    const p = planSpecialSlots(2026, desired, rows)
    const dem = planDemoteStraySpecials(2026, desired, rows, new Set(p.ops.map(o => o.id)))
    return JSON.stringify({ ops: p.ops, need: p.needCreate, kept: p.keptStarted, dem })
  }
  const a = run('confirmed'), b = run('completed'), c = run('cancelled')
  check('status가 달라도 계획이 같다 (confirmed=completed=cancelled)', a === b && b === c,
    `confirmed=${a}\n     completed=${b}\n     cancelled=${c}`)

  // 짝 단언 — 위가 "status를 안 본다"는 **음성**이므로, "그럼 무엇을 보는가"를 함께 고정한다.
  // 짝이 없으면 알고리즘이 아무것도 안 해도(전건 무시) 위 단언이 초록이 된다.
  const rowsA = mk('confirmed')
  const rowsB = mk('confirmed').map(r => r.id === 'jul' ? { ...r, started: true } : r)
  const pA = planSpecialSlots(2026, desired, rowsA)
  const pB = planSpecialSlots(2026, desired, rowsB)
  const demA = planDemoteStraySpecials(2026, desired, rowsA, new Set(pA.ops.map(o => o.id)))
  const demB = planDemoteStraySpecials(2026, desired, rowsB, new Set(pB.ops.map(o => o.id)))
  check('started를 켜면 계획이 실제로 달라진다 (강등 1건 → 0건)',
    demA.some(o => o.id === 'jul') && !demB.some(o => o.id === 'jul'),
    `A=${JSON.stringify(demA)} B=${JSON.stringify(demB)}`)
  check('started 행은 keptStarted로 알린다', pB.keptStarted.some(k => k.id === 'jul'), JSON.stringify(pB.keptStarted))
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

console.log('\n— 짝 단언: "그럼 누가 만드는가" (⑤ 규칙)')
{
  // 위 '생성 대상으로 넘어간다'는 **중간 상태**를 말할 뿐이다. 그 요청서를 실제로 집행하는
  // 코드가 있는지까지 물어야 그 초록이 알리바이가 되지 않는다. 순수 검사라 DB를 못 쓰므로
  // **집행부 소스에 그 배선이 실재하는지**를 정적으로 단언한다.
  const src = readFileSync(new URL('../src/lib/reconcile-special-slots.ts', import.meta.url), 'utf8')
  check('집행부가 needCreate를 생성기로 넘긴다', /needCreate\s*>\s*0/.test(src) && /generateYearlyPlanItems\(/.test(src),
    '생성 분기가 없다 — needCreate가 다시 버려진다')
  check('집행부가 생성 결과를 센다(created)', /out\.created\s*\+=/.test(src))
  check('집행부가 needCreate>0 · created==0 모순을 스스로 말한다',
    /needCreate\s*>\s*0\s*&&\s*out\.created\s*===\s*0/.test(src),
    '값만 세고 값들 사이의 관계를 안 보면 요청서가 조용히 버려진다')
  // 음성 대조군 — 이 정적 단언이 아무 문자열이나 통과시키는 것이 아님을 보인다
  check('[대조군] 없는 배선은 잡아낸다', !/zzzNoSuchWiring\(/.test(src))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
