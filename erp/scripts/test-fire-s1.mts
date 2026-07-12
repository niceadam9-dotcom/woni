/** FIRE-S1 시스템 테스트: 고객 등록 → 연간 계획 자동 생성 (실제 생성기 코드 + 실제 DB, 테스트 후 정리)
 *  실행: npx tsx scripts/test-fire-s1.mts */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import gen from '../src/lib/inspection-plan-generator.ts'
const { generateYearlyPlanItems, loadHolidaySet, loadAnchorDates } = gen as unknown as typeof import('../src/lib/inspection-plan-generator.ts')

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) as never as Parameters<typeof generateYearlyPlanItems>[0]

const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
const curYear = kstNow.getUTCFullYear()
const curMonth = kstNow.getUTCMonth() + 1

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

const raw = admin as unknown as ReturnType<typeof createClient>
const cleanup: string[] = []

async function getItems(custId: string) {
  const { data } = await raw.from('inspection_plan_items')
    .select('plan_type, sequence_num, planned_date, inspection_plans(year, month)')
    .eq('customer_id', custId)
  return (data ?? []) as Array<{ plan_type: string; sequence_num: number; planned_date: string; inspection_plans: { year: number; month: number } }>
}

async function createCustomer(fields: Record<string, unknown>): Promise<string> {
  const { data, error } = await raw.from('customers').insert({
    customer_code: `TEST-S1-${Math.random().toString(36).slice(2, 8)}`,
    contract_date: '2026-01-05',
    is_active: true,
    created_by: createdBy,
    ...fields,
  }).select('id').single()
  if (error) throw new Error(`고객 생성 실패: ${error.message}`)
  const id = (data as { id: string }).id
  cleanup.push(id)
  return id
}

// 계획 생성자 프로필
const { data: prof } = await raw.from('profiles').select('id').eq('is_active', true).limit(1)
const createdBy = (prof![0] as { id: string }).id
const hdSet = await loadHolidaySet(admin, curYear)

try {
  // ── 케이스 1: 작동 고객 + 사용승인일(3월) — 특별 1건(과거여도 생성) + 정기(현재월 이후만)
  console.log('\n[케이스 1] 작동 고객, 사용승인일 2020-03-15')
  const c1 = await createCustomer({ customer_name: 'TEST-FIRE-S1-작동', inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동', use_approval_date: '2020-03-15' })
  const n1 = await generateYearlyPlanItems(admin, { id: c1, inspection_type: '작동', use_approval_date: '2020-03-15', assigned_employee_id: null }, curYear, createdBy, hdSet)
  const i1 = await getItems(c1)
  const monthly1 = i1.filter(i => i.plan_type === 'monthly').map(i => i.inspection_plans.month).sort((a, b) => a - b)
  const special1 = i1.filter(i => i.plan_type === 'special_작동')
  const expMonthly1 = Array.from({ length: 12 - curMonth + 1 }, (_, k) => curMonth + k).filter(m => m !== 3)
  check(`특별(작동) 1건 — 3월(과거)에도 생성`, special1.length === 1 && special1[0].inspection_plans.month === 3, JSON.stringify(special1))
  check(`정기 ${expMonthly1.length}건 — ${curMonth}월 이후만 (지난 달 생략)`, JSON.stringify(monthly1) === JSON.stringify(expMonthly1), `실제: ${JSON.stringify(monthly1)}`)
  check(`생성 건수 반환값 일치 (${n1})`, n1 === i1.length)

  // ── 케이스 2: 종합 고객 + 사용승인일(1월) — 특별 2건(1월/7월) + 정기
  console.log('\n[케이스 2] 종합 고객, 사용승인일 2018-01-10 (2차 = 7월)')
  const c2 = await createCustomer({ customer_name: 'TEST-FIRE-S1-종합', inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합', use_approval_date: '2018-01-10' })
  await generateYearlyPlanItems(admin, { id: c2, inspection_type: '종합', use_approval_date: '2018-01-10', assigned_employee_id: null }, curYear, createdBy, hdSet)
  const i2 = await getItems(c2)
  const special2 = i2.filter(i => i.plan_type === 'special_종합').map(i => `${i.inspection_plans.month}월/${i.sequence_num}차`).sort()
  const monthly2 = i2.filter(i => i.plan_type === 'monthly').map(i => i.inspection_plans.month).sort((a, b) => a - b)
  const expMonthly2 = Array.from({ length: 12 - curMonth + 1 }, (_, k) => curMonth + k).filter(m => m !== 1 && m !== 7)
  check('특별(종합) 2건 — 1월 1차 + 7월 2차', JSON.stringify(special2) === JSON.stringify(['1월/1차', '7월/2차']), `실제: ${JSON.stringify(special2)}`)
  check(`정기 ${expMonthly2.length}건 — 특별월(1·7월) 제외`, JSON.stringify(monthly2) === JSON.stringify(expMonthly2), `실제: ${JSON.stringify(monthly2)}`)

  // ── 케이스 3: 사용승인일 없음 + 점검시작일 있음 — 점검시작일 기준 생성 (이번 수정의 핵심)
  console.log('\n[케이스 3] 작동 고객, 사용승인일 없음 + 점검시작일 2026-05-20')
  const c3 = await createCustomer({ customer_name: 'TEST-FIRE-S1-점검시작일', inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동', use_approval_date: null })
  const { error: iErr } = await raw.from('inspections').insert({
    customer_id: c3, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: `${curYear}-05-20`, status: 'scheduled', assigned_employee_id: createdBy, created_by: createdBy,
  })
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  const anchor3 = (await loadAnchorDates(admin, [{ id: c3, use_approval_date: null }])).get(c3)
  check(`기준일 = 점검시작일 (${curYear}-05-20)`, anchor3 === `${curYear}-05-20`, `실제: ${anchor3}`)
  await generateYearlyPlanItems(admin, { id: c3, inspection_type: '작동', use_approval_date: null, assigned_employee_id: null }, curYear, createdBy, hdSet)
  const i3 = await getItems(c3)
  const special3 = i3.filter(i => i.plan_type === 'special_작동')
  const monthly3 = i3.filter(i => i.plan_type === 'monthly').map(i => i.inspection_plans.month).sort((a, b) => a - b)
  const expMonthly3 = Array.from({ length: 12 - curMonth + 1 }, (_, k) => curMonth + k).filter(m => m !== 5)
  check('특별(작동) 1건 — 점검시작월(5월)', special3.length === 1 && special3[0].inspection_plans.month === 5, JSON.stringify(special3))
  check(`정기 생성됨 — 사용승인일 없어도 (${expMonthly3.length}건)`, JSON.stringify(monthly3) === JSON.stringify(expMonthly3), `실제: ${JSON.stringify(monthly3)}`)

  // ── 케이스 4: 둘 다 있으면 점검시작일 우선
  console.log('\n[케이스 4] 둘 다 있음 — 점검시작일(4월) 우선, 사용승인일(9월) 무시')
  const c4 = await createCustomer({ customer_name: 'TEST-FIRE-S1-우선순위', inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동', use_approval_date: '2019-09-01' })
  await raw.from('inspections').insert({
    customer_id: c4, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: `${curYear}-04-10`, status: 'scheduled', assigned_employee_id: createdBy, created_by: createdBy,
  })
  const anchor4 = (await loadAnchorDates(admin, [{ id: c4, use_approval_date: '2019-09-01' }])).get(c4)
  check(`기준일 = 점검시작일 우선 (${curYear}-04-10)`, anchor4 === `${curYear}-04-10`, `실제: ${anchor4}`)
  await generateYearlyPlanItems(admin, { id: c4, inspection_type: '작동', use_approval_date: '2019-09-01', assigned_employee_id: null }, curYear, createdBy, hdSet)
  const i4 = await getItems(c4)
  const special4 = i4.filter(i => i.plan_type === 'special_작동')
  check('특별월 = 4월 (점검시작월, 9월 아님)', special4.length === 1 && special4[0].inspection_plans.month === 4, JSON.stringify(special4.map(s => s.inspection_plans.month)))

  // ── 케이스 5: 멱등성 — 재실행 시 0건 추가
  console.log('\n[케이스 5] 멱등성 — 케이스 1 재실행')
  const n5 = await generateYearlyPlanItems(admin, { id: c1, inspection_type: '작동', use_approval_date: '2020-03-15', assigned_employee_id: null }, curYear, createdBy, hdSet)
  const i5 = await getItems(c1)
  check('재실행 시 신규 0건 + 총 건수 불변', n5 === 0 && i5.length === i1.length, `신규 ${n5}건, 총 ${i5.length}건`)

  // ── 케이스 6: 일반관리 — 생성 없음
  console.log('\n[케이스 6] 일반관리 고객 — 자동 생성 없음')
  const c6 = await createCustomer({ customer_name: 'TEST-FIRE-S1-일반', inspection_type: '일반관리', inspection_category: '일반관리', use_approval_date: '2020-06-01' })
  const n6 = await generateYearlyPlanItems(admin, { id: c6, inspection_type: '일반관리' as never, use_approval_date: '2020-06-01', assigned_employee_id: null }, curYear, createdBy, hdSet)
  check('일반관리 0건', n6 === 0)

  // ── 케이스 7: 기준일 없음(사용승인일 X, 점검 이력 X) — 생성 없음
  console.log('\n[케이스 7] 기준일 없음 — 생성 없음')
  const c7 = await createCustomer({ customer_name: 'TEST-FIRE-S1-무기준', inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동', use_approval_date: null })
  const n7 = await generateYearlyPlanItems(admin, { id: c7, inspection_type: '작동', use_approval_date: null, assigned_employee_id: null }, curYear, createdBy, hdSet)
  check('기준일 없으면 0건', n7 === 0)

  // ── 케이스 8: 올해 안 기준일(종합, 최초 점검 7월) — 2차가 같은 해 과거 1월로 역행하지 않음 (2026-07-10 버그 수정 회귀)
  console.log('\n[케이스 8] 종합 고객, 사용승인일 없음 + 점검시작일 7월 — 기준일 이전 항목 생성 금지')
  const anchor8 = `${curYear}-07-06`
  const c8 = await createCustomer({ customer_name: 'TEST-FIRE-S1-역행2차', inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합', use_approval_date: null })
  await raw.from('inspections').insert({
    customer_id: c8, inspection_type: '종합', sequence_num: 1,
    inspection_start_date: anchor8, status: 'scheduled', assigned_employee_id: createdBy, created_by: createdBy,
  })
  await generateYearlyPlanItems(admin, { id: c8, inspection_type: '종합', use_approval_date: null, assigned_employee_id: null }, curYear, createdBy, hdSet)
  const i8 = await getItems(c8)
  const special8 = i8.filter(i => i.plan_type === 'special_종합')
  const seq2_8 = special8.filter(i => i.sequence_num === 2)
  const monthly8 = i8.filter(i => i.plan_type === 'monthly').map(i => i.inspection_plans.month).sort((a, b) => a - b)
  const expMonthly8 = Array.from({ length: 12 }, (_, k) => k + 1).filter(m => m >= Math.max(curMonth, 8) && m !== 1 && m !== 7)
  check('특별(종합) 1차 1건 — 점검시작월(7월)', special8.filter(i => i.sequence_num === 1).length === 1 && special8[0].inspection_plans.month === 7, JSON.stringify(special8))
  check('2차(+6개월=같은 해 1월, 기준일 이전) 생성 안 됨', seq2_8.length === 0, JSON.stringify(seq2_8))
  check(`정기는 기준일 이후만 (${expMonthly8.length}건)`, JSON.stringify(monthly8) === JSON.stringify(expMonthly8), `실제: ${JSON.stringify(monthly8)}`)
  check('모든 항목 planned_date ≥ 기준일', i8.every(i => i.planned_date >= anchor8), JSON.stringify(i8.map(i => i.planned_date)))
  // 4-1: 당월 항목 예정일이 생성 시점에 과거면 오늘 이후 첫 영업일로 보정
  const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
  const curMonthItems8 = i8.filter(i => i.inspection_plans.year === curYear && i.inspection_plans.month === curMonth)
  check('4-1: 당월 항목 예정일은 오늘 이후로 보정', curMonthItems8.every(i => i.planned_date >= kstToday),
    JSON.stringify(curMonthItems8.map(i => i.planned_date)))
  // 과도 억제 방지: 다음 해 생성 시 2차는 1월(기준일 이후)로 정상 생성되어야 함
  const hdSetNext = await loadHolidaySet(admin, curYear + 1)
  await generateYearlyPlanItems(admin, { id: c8, inspection_type: '종합', use_approval_date: null, assigned_employee_id: null }, curYear + 1, createdBy, hdSetNext)
  const i8next = (await getItems(c8)).filter(i => i.inspection_plans.year === curYear + 1)
  const seq2next = i8next.filter(i => i.plan_type === 'special_종합' && i.sequence_num === 2)
  check(`다음 해(${curYear + 1}) 2차는 1월에 정상 생성`, seq2next.length === 1 && seq2next[0].inspection_plans.month === 1, JSON.stringify(seq2next))

  // ── 케이스 9: 점검계획일(수동) 최우선 — 점검시작일·사용승인일보다 우선 (2026-07-12 추가)
  console.log('\n[케이스 9] 셋 다 있음 — 점검계획일(6월) > 점검시작일(4월) > 사용승인일(9월)')
  const anchor9 = `${curYear}-06-15`
  const c9 = await createCustomer({ customer_name: 'TEST-FIRE-S1-계획일우선', inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동', use_approval_date: '2019-09-01', plan_anchor_date: anchor9 })
  await raw.from('inspections').insert({
    customer_id: c9, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: `${curYear}-04-10`, status: 'scheduled', assigned_employee_id: createdBy, created_by: createdBy,
  })
  const anchorRes9 = (await loadAnchorDates(admin, [{ id: c9, use_approval_date: '2019-09-01', plan_anchor_date: anchor9 }])).get(c9)
  check(`기준일 = 점검계획일 (${anchor9})`, anchorRes9 === anchor9, `실제: ${anchorRes9}`)
  await generateYearlyPlanItems(admin, { id: c9, inspection_type: '작동', use_approval_date: '2019-09-01', plan_anchor_date: anchor9, assigned_employee_id: null }, curYear, createdBy, hdSet)
  const i9 = await getItems(c9)
  const special9 = i9.filter(i => i.plan_type === 'special_작동')
  check('특별월 = 6월 (점검계획일 월, 4월·9월 아님)', special9.length === 1 && special9[0].inspection_plans.month === 6, JSON.stringify(special9.map(s => s.inspection_plans.month)))
  check('모든 항목 planned_date ≥ 점검계획일', i9.every(i => i.planned_date >= anchor9), JSON.stringify(i9.map(i => i.planned_date)))
} finally {
  // ── 정리: 테스트 데이터 삭제 (plan_items → inspections → customers)
  console.log('\n[정리] 테스트 데이터 삭제')
  for (const id of cleanup) {
    await raw.from('inspection_plan_items').delete().eq('customer_id', id)
    await raw.from('inspection_steps').delete().in('inspection_id',
      ((await raw.from('inspections').select('id').eq('customer_id', id)).data ?? []).map(r => (r as { id: string }).id))
    await raw.from('inspections').delete().eq('customer_id', id)
    await raw.from('customers').delete().eq('id', id)
  }
  const { data: leftover } = await raw.from('customers').select('id').like('customer_code', 'TEST-S1-%')
  console.log(`잔여 테스트 고객: ${(leftover ?? []).length}건`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
