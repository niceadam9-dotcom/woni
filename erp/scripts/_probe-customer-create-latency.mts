/** 고객 등록이 왜 오래 걸리는가 — 단계별 실측 (스테이징 실데이터)
 *  실행: node --conditions=react-server --import tsx scripts/_probe-customer-create-latency.mts
 *  시드는 끝에 전량 삭제한다. */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import genMod from '../src/lib/inspection-plan-generator.ts'

const { loadHolidaySet, generateYearlyPlanItems } =
  genMod as unknown as typeof import('../src/lib/inspection-plan-generator.ts')

config({ path: '.env.local' })
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
if (!URL.includes('nwflnzugwylhpdyodyog')) { console.error(`중단 — 스테이징이 아님: ${URL}`); process.exit(2) }
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const admin = db as never

const t = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const s = Date.now()
  const r = await fn()
  const ms = Date.now() - s
  marks.push([label, ms])
  console.log(`  ${String(ms).padStart(6)}ms  ${label}`)
  return r
}
const marks: Array<[string, number]> = []

const SEED = `[LATTEST-${Date.now().toString(36)}]`
let custId = '', actorId = ''

try {
  const { data: p } = await db.from('profiles').select('id').limit(1).single()
  actorId = (p as { id: string }).id

  console.log('\n— 왕복 1회 기준선(RTT)')
  await t('baseline: profiles 1행 select', async () => {
    await db.from('profiles').select('id').limit(1)
  })

  console.log('\n— createCustomerAction이 하는 일 (순서대로)')
  await t('① 고객코드 중복 검사', async () => {
    await db.from('customers').select('id').eq('customer_code', 'ZZZ-NOPE').single()
  })
  custId = await t('② customers insert', async () => {
    const { data, error } = await db.from('customers').insert({
      customer_name: `${SEED} 지연측정`, customer_code: `LAT${Date.now().toString(36).slice(-8)}`,
      inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합',
      plan_anchor_date: '2026-03-10', is_active: true, created_by: actorId,
    } as never).select('id').single()
    if (error) throw new Error(`고객 생성 실패: ${error.message}`)
    return (data as { id: string }).id
  })
  await t('③ customer_contacts insert(1건)', async () => {
    await db.from('customer_contacts').insert({
      customer_id: custId, role: '대표', name: `${SEED} 대표`,
    } as never)
  })
  await t('④ 담당자 이름 조회(profiles)', async () => {
    await db.from('profiles').select('name').eq('id', actorId).single()
  })
  await t('⑤ activity_logs insert', async () => {
    await db.from('activity_logs').insert({
      actor_id: actorId, action: 'customer_created', entity_type: 'customer', entity_id: custId,
      metadata: { seed: SEED },
    } as never)
  })
  await t('⑥ buildings insert', async () => {
    await db.from('buildings').insert({
      customer_id: custId, building_name: `${SEED} 건물`, created_by: actorId,
    } as never)
  })

  console.log('\n— ⑦ 연간 점검계획 자동 생성 (여기가 의심 지점)')
  const hdSet = await t('  ⑦-a 공휴일 로드', () => loadHolidaySet(admin, 2026))
  const created = await t('  ⑦-b generateYearlyPlanItems', () => generateYearlyPlanItems(
    admin,
    { id: custId, inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합',
      plan_anchor_date: '2026-03-10', assigned_employee_id: actorId },
    2026, actorId, hdSet,
  ))
  console.log(`         → 생성된 항목 ${created}건`)

  // 배치로 바꾸면서 멱등성이 깨지지 않았는지 — 같은 인자로 다시 부르면 0건이어야 한다
  const again = await t('  ⑦-c 재실행(멱등성 확인)', () => generateYearlyPlanItems(
    admin,
    { id: custId, inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합',
      plan_anchor_date: '2026-03-10', assigned_employee_id: actorId },
    2026, actorId, hdSet,
  ))
  const { count: itemCount } = await db.from('inspection_plan_items')
    .select('id', { count: 'exact', head: true }).eq('customer_id', custId)
  console.log(`         → 재실행 생성 ${again}건(0이어야 정상) · DB 총 항목 ${itemCount}건(${created}이어야 정상)`)
  if (again !== 0 || itemCount !== created) console.log('  ❌ 멱등성 깨짐 — 중복 생성')
  else console.log('  ✅ 멱등성 유지')

  // 종전 구현과 같은 결과인지 — 특별점검 2건(1차·2차) + 남은 달 정기
  const { data: kinds } = await db.from('inspection_plan_items')
    .select('plan_type, sequence_num, status, planned_date').eq('customer_id', custId)
  const list = (kinds ?? []) as Array<{ plan_type: string; sequence_num: number; status: string; planned_date: string }>
  const special = list.filter(r => r.plan_type.startsWith('special'))
  const monthly = list.filter(r => r.plan_type === 'monthly')
  console.log(`         → 특별 ${special.length}건(seq ${special.map(s => s.sequence_num).sort().join(',')}) · 정기 ${monthly.length}건`)
  console.log(`         → 정기는 전부 confirmed·scheduled 세팅: ${monthly.every(m => m.status === 'confirmed')}`)
  console.log(`         → 예정일 정렬: ${list.map(r => r.planned_date).sort().join(' ')}`)

  // 실제 액션의 새 구조(①② 직렬 → 나머지 병렬)를 그대로 재현해 총 체감 시간을 잰다
  console.log('\n— 새 구조 재현: ①② 직렬 뒤 ③~⑦ 병렬')
  let cust2 = ''
  const t0 = Date.now()
  {
    await db.from('customers').select('id').eq('customer_code', 'ZZZ-NOPE2').single()
    const { data } = await db.from('customers').insert({
      customer_name: `${SEED} 병렬측정`, customer_code: `LAP${Date.now().toString(36).slice(-8)}`,
      inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합',
      plan_anchor_date: '2026-03-10', is_active: true, created_by: actorId,
    } as never).select('id').single()
    cust2 = (data as { id: string }).id
    await Promise.all([
      db.from('customer_contacts').insert({ customer_id: cust2, role: '대표', name: `${SEED} 대표2` } as never),
      (async () => {
        await db.from('profiles').select('name').eq('id', actorId).single()
        await db.from('activity_logs').insert({
          actor_id: actorId, action: 'customer_created', entity_type: 'customer', entity_id: cust2,
          metadata: { seed: SEED },
        } as never)
      })(),
      db.from('buildings').insert({ customer_id: cust2, building_name: `${SEED} 건물2`, created_by: actorId } as never),
      (async () => {
        const hd = await loadHolidaySet(admin, 2026)
        await generateYearlyPlanItems(admin,
          { id: cust2, inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합',
            plan_anchor_date: '2026-03-10', assigned_employee_id: actorId }, 2026, actorId, hd)
      })(),
    ])
  }
  const newTotal = Date.now() - t0
  console.log(`  ${String(newTotal).padStart(6)}ms  새 구조 총 소요 (DB 작업만 — 서버 액션 왕복·리다이렉트 제외)`)
  // 정리
  await db.from('inspection_plan_items').delete().eq('customer_id', cust2)
  await db.from('buildings').delete().eq('customer_id', cust2)
  await db.from('customer_contacts').delete().eq('customer_id', cust2)
  const { data: l2 } = await db.from('activity_logs').select('id').eq('entity_type', 'customer').eq('entity_id', cust2)
  const ids2 = ((l2 ?? []) as Array<{ id: string }>).map(r => r.id)
  if (ids2.length) await db.rpc('purge_activity_logs', { purge_ids: ids2 } as never)
  await db.from('customers').delete().eq('id', cust2)

  const total = marks.reduce((a, [, ms]) => a + ms, 0)
  const rtt = marks[0][1]
  const gen = marks.find(m => m[0].includes('generateYearlyPlanItems'))![1]
  console.log(`\n합계 ${total}ms  (그중 계획 생성 ${gen}ms = ${Math.round(gen / total * 100)}%)`)
  console.log(`왕복 1회 ≈ ${rtt}ms → 계획 생성은 왕복 약 ${Math.round(gen / Math.max(rtt, 1))}회분`)
  console.log(`생성 항목 ${created}건 × (계획 조회 + 항목 insert) 직렬 루프가 원인인지 위 수치로 판단`)
} catch (e) {
  console.log(`\n❌ 중단: ${(e as Error).message}`)
} finally {
  console.log('\n[정리]')
  if (custId) {
    await db.from('inspection_plan_items').delete().eq('customer_id', custId)
    await db.from('buildings').delete().eq('customer_id', custId)
    await db.from('customer_contacts').delete().eq('customer_id', custId)
    const { data: logs } = await db.from('activity_logs').select('id')
      .eq('entity_type', 'customer').eq('entity_id', custId)
    const ids = ((logs ?? []) as Array<{ id: string }>).map(r => r.id)
    if (ids.length) await db.rpc('purge_activity_logs', { purge_ids: ids } as never)
    await db.from('customers').delete().eq('id', custId)
  }
  const { count } = await db.from('customers')
    .select('id', { count: 'exact', head: true }).like('customer_name', `${SEED}%`)
  console.log(`  시드 잔존: ${count ?? 0}건`)
}
