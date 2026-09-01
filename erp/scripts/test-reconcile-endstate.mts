/** 재계산 **최종 상태** 검사 — 경로가 아니라 *끝난 뒤의 모양*을 묻는다. (DB 필요·서버 불필요)
 *  실행: npx tsx --conditions=react-server scripts/test-reconcile-endstate.mts
 *
 *  ## 왜 이 검사가 따로 있어야 하나
 *  `test-special-slot`은 **함수가 무엇을 계획했나**를 본다 — 경로 축이라 경로가 하나 빠지면
 *  볼 수 없다. 실제로 그렇게 빠졌다: 순수 함수는 `create` 요청서를 옳게 발행했는데 집행부가
 *  읽지 않아 **법정 2차가 계획에서 사라졌고**, 그때도 경로 검사는 전부 초록이었다.
 *
 *  이 검사는 재계산을 **실제로 돌린 뒤** "계획의 모양이 desired와 같은가"만 묻는다.
 *  교체로 됐든 생성으로 됐든 무관하므로 **어느 경로가 빠져도 빨강**이 된다.
 *
 *  ⚠ 테스트 고객을 만들어 쓰고 **반드시 지운다**(잔여 0을 마지막에 단언한다).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { reconcileSpecialSlots } from '../src/lib/reconcile-special-slots.ts'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const admin = raw as never as Parameters<typeof reconcileSpecialSlots>[0]

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${n}${ok || !d ? '' : ` — ${d}`}`) }

const YEARS = [new Date().getFullYear(), new Date().getFullYear() + 1]
const made: string[] = []

async function mkCustomer(fields: Record<string, unknown>, actor: string): Promise<string> {
  const { data, error } = await raw.from('customers').insert({
    customer_code: `TEST-ENDSTATE-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: 'TEST-최종상태', address: 'X', fire_station: 'X',
    is_active: true, created_by: actor, ...fields,
  }).select('id').single()
  if (error) { console.error('고객 생성 실패:', error.message); process.exit(1) }
  const id = (data as { id: string }).id
  made.push(id)
  return id
}

async function specialsOf(customerId: string) {
  const { data } = await raw.from('inspection_plan_items')
    .select('sequence_num, plan_type, plan:inspection_plans(year, month)')
    .eq('customer_id', customerId)
  return ((data ?? []) as unknown as Array<{ sequence_num: number; plan_type: string | null; plan: { year: number; month: number } | null }>)
    .filter(r => r.plan && String(r.plan_type ?? '').startsWith('special'))
    .map(r => ({ y: r.plan!.year, m: r.plan!.month, seq: r.sequence_num, t: r.plan_type! }))
}

const { data: prof } = await raw.from('profiles').select('id').limit(1).single()
const actor = (prof as { id: string }).id

try {
  console.log('— 종합 대상: 1차(기산월) + 2차(+6개월)가 **각 해에** 있어야 한다')
  {
    // 기산월 3월 → 1차 3월 / 2차 9월. 두 달 모두 정기가 seq=1로 자리를 차지하고 있어도
    // 2차는 seq=2라 '막는 행'이 없다 → 생성 경로를 반드시 타야 한다.
    // ⚠ inspection_type은 enum('종합'|'작동'|'일반관리')이고 '소방안전관리'는 **category** 값이다.
    //   둘을 섞으면 insert가 enum 오류로 죽는다(이 검사를 짜며 실제로 한 번 밟았다).
    const id = await mkCustomer({
      inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합',
      use_approval_date: '2010-03-12', plan_anchor_date: '2010-03-12',
    }, actor)
    const res = await reconcileSpecialSlots(admin, id, YEARS, actor)
    const sp = await specialsOf(id)
    for (const y of YEARS) {
      const first = sp.filter(r => r.y === y && r.seq === 1 && r.t === 'special_종합')
      const second = sp.filter(r => r.y === y && r.seq === 2 && r.t === 'special_작동')
      check(`${y}: 1차 종합이 3월에 정확히 1건`, first.length === 1 && first[0].m === 3, JSON.stringify(first))
      // ⭐ 이 단언이 그때 없던 그물이다 — 생성 경로가 빠지면 여기서 즉시 빨강이 된다
      check(`${y}: 2차 작동이 9월에 정확히 1건`, second.length === 1 && second[0].m === 9, JSON.stringify(second))
    }
    check('결과가 모순을 스스로 말하지 않는다(needCreate>0 && created==0 아님)',
      !res.notes.some(n => n.includes('요청서가 버려졌')), res.notes.join(' / '))

    // 멱등 — 다시 돌려도 모양이 같아야 한다
    const before = JSON.stringify(sp.sort((a, b) => a.y - b.y || a.m - b.m || a.seq - b.seq))
    await reconcileSpecialSlots(admin, id, YEARS, actor)
    const after = JSON.stringify((await specialsOf(id)).sort((a, b) => a.y - b.y || a.m - b.m || a.seq - b.seq))
    check('멱등 — 두 번 돌려도 최종 모양이 같다', before === after, `${before}\n     ${after}`)
  }

  console.log('\n— 작동 대상: 1차만 있고 2차는 없어야 한다')
  {
    const id = await mkCustomer({
      inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
      use_approval_date: '2010-03-12', plan_anchor_date: '2010-03-12',
    }, actor)
    await reconcileSpecialSlots(admin, id, YEARS, actor)
    const sp = await specialsOf(id)
    for (const y of YEARS) {
      check(`${y}: 1차 작동이 3월에 1건`, sp.filter(r => r.y === y && r.seq === 1 && r.t === 'special_작동' && r.m === 3).length === 1)
      check(`${y}: 2차는 없다`, sp.filter(r => r.y === y && r.seq === 2).length === 0, JSON.stringify(sp.filter(r => r.y === y && r.seq === 2)))
    }
  }

  console.log('\n— 같은 달 중복·seq=2 정기가 남지 않는다')
  {
    const { data } = await raw.from('inspection_plan_items')
      .select('sequence_num, plan_type, plan:inspection_plans(year, month)')
      .in('customer_id', made)
    const rows = ((data ?? []) as unknown as Array<{ sequence_num: number; plan_type: string | null; plan: { year: number; month: number } | null }>)
    check('seq=2 정기 0건', rows.filter(r => r.sequence_num === 2 && r.plan_type === 'monthly').length === 0)
  }
} finally {
  console.log('\n[정리] 테스트 고객 삭제')
  for (const id of made) {
    await raw.from('inspection_plan_items').delete().eq('customer_id', id)
    await raw.from('customers').delete().eq('id', id)
  }
  const { count } = await raw.from('customers').select('id', { count: 'exact', head: true }).like('customer_code', 'TEST-ENDSTATE-%')
  check(`잔여 테스트 고객 0건`, (count ?? 0) === 0, String(count))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
