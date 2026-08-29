/** 소방계획서_33 — 종합 대상의 2차는 작동점검이다 (S5-2)
 *
 *  종합점검 대상 건물은 사용승인월에 종합(1차), +6개월에 작동(2차)을 한다. 즉 **2차는 법적으로
 *  작동점검**이다. 종전에는 002:126 트리거가 `seq2 AND inspection_type <> '종합'`을 막고 있어
 *  2차를 작동으로 저장하는 것 자체가 불가능했고, 그래서 생성기가 2차를 종합으로 만들었으며
 *  별지 9호 체크박스·표지 제목·갑지·점검표 범위가 전부 2차를 종합으로 인쇄했다.
 *
 *  실행: npx tsx scripts/test-second-round-operational.mts  (dev 서버 불필요 — DB·순수함수 축)
 *  전제: 마이그레이션 153 적용.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import gen from '../src/lib/inspection-plan-generator.ts'
const { generateYearlyPlanItems, loadHolidaySet } =
  gen as unknown as typeof import('../src/lib/inspection-plan-generator.ts')
// inspectionTypeLabel은 순수 모듈에서 직접 가져온다 — annex-cover-official은 server-only
// 모듈(supabase/admin 등)을 값으로 끌어와 tsx 스크립트에서 로드되지 않는다.
import { rowSubType, rowInspectionType, rowPlanType, inspectionTypeLabel } from '../src/lib/inspection-round.ts'
import { sheetScope, isItemInScope } from '../src/lib/sheet-scope.ts'
import { annexSubType } from '../src/lib/annex-filename.ts'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const admin = raw as never as Parameters<typeof generateYearlyPlanItems>[0]

const YEAR = new Date().getFullYear()
// 기준일은 **반드시 plan_anchor_date로 준다** — use_approval_date 폴백은 2026-07-14에 제거됐다.
// 그것만 주면 loadAnchorDates가 null을 돌려주고 계획이 0건 생성돼, 단정이 아니라 셋업이 무너진다.
const ANCHOR = `${YEAR}-01-10`      // 1차 = 1월, 2차 = 7월

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const madeCustomers: string[] = []
async function mkCust(fields: Record<string, unknown>, userId: string) {
  const { data, error } = await raw.from('customers').insert({
    customer_code: `TEST-S33-${Math.random().toString(36).slice(2, 8)}`,
    contract_date: '2026-01-05', is_active: true,
    created_by: userId, assigned_employee_id: userId,
    plan_anchor_date: ANCHOR,
    ...fields,
  }).select('id').single()
  if (error) throw new Error(`고객 생성 실패: ${error.message}`)
  const id = (data as { id: string }).id
  madeCustomers.push(id)
  return id
}
type Item = { plan_type: string | null; sequence_num: number; inspection_type: string; inspection_sub_type: string | null }
async function itemsOf(cid: string): Promise<Item[]> {
  const { data } = await raw.from('inspection_plan_items')
    .select('plan_type, sequence_num, inspection_type, inspection_sub_type')
    .eq('customer_id', cid)
  return (data ?? []) as Item[]
}

let userId = ''
const madeInspections: string[] = []

try {
  const { data: prof } = await raw.from('profiles').select('id').limit(1).single()
  userId = (prof as { id: string }).id
  const hdSet = await loadHolidaySet(admin, YEAR)

  // ── 1) 생성 축 — 종합 고객 ────────────────────────────────────────────────
  console.log('\n[1] 생성 — 종합 고객: 1차 종합 / 2차 작동')
  const cComp = await mkCust({
    customer_name: 'TEST-S33-종합', inspection_type: '종합',
    inspection_category: '소방안전관리', inspection_sub_type: '종합',
  }, userId)
  await generateYearlyPlanItems(admin,
    { id: cComp, inspection_type: '종합', inspection_category: '소방안전관리',
      inspection_sub_type: '종합', plan_anchor_date: ANCHOR, assigned_employee_id: userId } as never,
    YEAR, userId, hdSet)
  const iComp = await itemsOf(cComp)
  const s1 = iComp.filter(i => (i.plan_type ?? '').startsWith('special_') && i.sequence_num === 1)
  const s2 = iComp.filter(i => (i.plan_type ?? '').startsWith('special_') && i.sequence_num === 2)
  check('1차 특별점검 1건 생성', s1.length === 1, JSON.stringify(iComp))
  check('2차 특별점검 1건 생성', s2.length === 1, JSON.stringify(iComp))
  check('1차 plan_type = special_종합', s1[0]?.plan_type === 'special_종합', String(s1[0]?.plan_type))
  check('2차 plan_type = special_작동 (2차는 작동점검)', s2[0]?.plan_type === 'special_작동', String(s2[0]?.plan_type))
  check('2차 inspection_type = 작동', s2[0]?.inspection_type === '작동', String(s2[0]?.inspection_type))
  check('2차 inspection_sub_type = 작동', s2[0]?.inspection_sub_type === '작동', String(s2[0]?.inspection_sub_type))
  check('1차는 종합 유지 (행 축이 차수별로 갈린다)',
    s1[0]?.inspection_type === '종합' && s1[0]?.inspection_sub_type === '종합',
    `${s1[0]?.inspection_type}/${s1[0]?.inspection_sub_type}`)

  // ── 2) 작동 전용 고객은 2차 자체가 없다 ──────────────────────────────────
  console.log('\n[2] 생성 — 작동 고객: 2차 없음')
  const cOper = await mkCust({
    customer_name: 'TEST-S33-작동', inspection_type: '작동',
    inspection_category: '소방안전관리', inspection_sub_type: '작동',
  }, userId)
  await generateYearlyPlanItems(admin,
    { id: cOper, inspection_type: '작동', inspection_category: '소방안전관리',
      inspection_sub_type: '작동', plan_anchor_date: ANCHOR, assigned_employee_id: userId } as never,
    YEAR, userId, hdSet)
  const iOper = await itemsOf(cOper)
  check('작동 고객: 특별점검 2차 0건', iOper.filter(i => (i.plan_type ?? '').startsWith('special_') && i.sequence_num === 2).length === 0,
    JSON.stringify(iOper.filter(i => i.sequence_num === 2)))
  check('작동 고객: 1차는 special_작동',
    iOper.filter(i => (i.plan_type ?? '').startsWith('special_')).every(i => i.plan_type === 'special_작동'))

  // ── 3) 일반관리 sub=종합 — 관리유형 축은 보존된다 ────────────────────────
  console.log('\n[3] 생성 — 일반관리(sub=종합): 2차는 작동이되 inspection_type은 일반관리 유지')
  const cGen = await mkCust({
    customer_name: 'TEST-S33-일반관리', inspection_type: '일반관리',
    inspection_category: '일반관리', inspection_sub_type: '종합',
  }, userId)
  await generateYearlyPlanItems(admin,
    { id: cGen, inspection_type: '일반관리', inspection_category: '일반관리',
      inspection_sub_type: '종합', plan_anchor_date: ANCHOR, assigned_employee_id: userId } as never,
    YEAR, userId, hdSet)
  const iGen = await itemsOf(cGen)
  const g2 = iGen.filter(i => i.sequence_num === 2)
  check('일반관리 2차: plan_type = special_작동', g2.length === 1 && g2[0].plan_type === 'special_작동', JSON.stringify(g2))
  check('일반관리 2차: inspection_type = 일반관리 (관리유형 축 보존)',
    g2[0]?.inspection_type === '일반관리', String(g2[0]?.inspection_type))
  check('일반관리 2차: inspection_sub_type = 작동', g2[0]?.inspection_sub_type === '작동', String(g2[0]?.inspection_sub_type))
  check('일반관리: 정기(monthly) 미생성 (소방계획서_6 D-1)', !iGen.some(i => i.plan_type === 'monthly'))

  // ── 4) 멱등 — 재생성해도 2차가 종합으로 되돌아가지 않는다 ────────────────
  console.log('\n[4] 원복 방어 — 재생성 멱등')
  await generateYearlyPlanItems(admin,
    { id: cComp, inspection_type: '종합', inspection_category: '소방안전관리',
      inspection_sub_type: '종합', plan_anchor_date: ANCHOR, assigned_employee_id: userId } as never,
    YEAR, userId, hdSet)
  const iComp2 = await itemsOf(cComp)
  check('재생성 후에도 2차 = special_작동 1건',
    iComp2.filter(i => i.sequence_num === 2 && i.plan_type === 'special_작동').length === 1,
    JSON.stringify(iComp2.filter(i => i.sequence_num === 2)))
  check('재생성이 항목 수를 늘리지 않음(멱등)', iComp2.length === iComp.length, `${iComp.length} → ${iComp2.length}`)

  // ── 5) 가드 축 이동 — 트리거가 고객 축으로 판정하는가 ────────────────────
  console.log('\n[5] 가드 — 축은 옮기되 없애지 않는다 (D33-4)')
  async function tryInsp(cid: string, seq: number, itype: string, startDate: string) {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cid, inspection_type: itype, sequence_num: seq,
      inspection_start_date: startDate, status: 'scheduled',
      assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (data) madeInspections.push((data as { id: string }).id)
    return { ok: !error, msg: error?.message ?? '' }
  }
  const a = await tryInsp(cComp, 2, '작동', `${YEAR}-07-10`)
  check('ⓐ 종합 고객의 2차를 작동으로 저장 — 허용 (축 이동의 직접 증거)', a.ok, a.msg)
  const b = await tryInsp(cOper, 2, '작동', `${YEAR}-07-10`)
  check('ⓑ 작동 전용 고객의 2차 — 여전히 차단', !b.ok && /sequence_num=2/.test(b.msg),
    b.ok ? '통과돼 버렸다(가드 소실)' : b.msg)
  const c = await tryInsp(cComp, 1, '종합', `${YEAR}-01-10`)
  check('ⓒ 종합 고객의 1차 종합 — 허용(회귀 없음)', c.ok, c.msg)

  // ── 6) 인쇄물 축 — 데이터가 고쳐지면 라벨이 따라온다 ─────────────────────
  console.log('\n[6] 인쇄물 라벨 (순수 함수 축)')
  // 별지 9호 표지 체크박스와 같은 판정식 (report9-assemble: itype==='작동' → ckOp)
  const itype2 = s2[0]!.inspection_type
  check('별지 9호: 2차에서 ckOp=true · ckCompEtc=false',
    itype2 === '작동' && !(itype2 === '종합'), `itype=${itype2}`)
  // 표지·공문·위임장 제목
  check('표지 제목: 2차 → 작동점검', inspectionTypeLabel('작동', false, 'special_작동') === '작동점검')
  check('표지 제목: 1차 종합 → 종합점검', inspectionTypeLabel('종합', false, 'special_종합') === '종합점검')
  check('표지 제목: 최초점검 유지', inspectionTypeLabel('종합', true, 'special_종합') === '최초점검')
  // 선재 결함 — 일반관리가 fall-through로 '종합점검'이 되던 것
  check('표지 제목 선재 결함 해소: 일반관리 + special_작동 → 작동점검 (종전 종합점검 오식)',
    inspectionTypeLabel('일반관리', false, 'special_작동') === '작동점검',
    inspectionTypeLabel('일반관리', false, 'special_작동'))
  // 별지 4호 파일명
  check('파일명: 2차 → 작동점검 결과보고서 축', annexSubType('작동', 'special_작동') === '작동')
  check('파일명: 일반관리 2차도 작동 축 (plan_type 우선)', annexSubType('일반관리', 'special_작동') === '작동')

  // ── 7) 점검표 범위 — 2차는 작동 범위(종합전용 ● 제외) ────────────────────
  console.log('\n[7] 점검표 범위 (sheet-scope)')
  const sc2 = sheetScope('special_작동', '작동')
  const sc1 = sheetScope('special_종합', '종합')
  check('2차 scope: isOperational=true · v2025', sc2.isOperational === true && sc2.version === 'v2025', JSON.stringify(sc2))
  check('1차 scope: isOperational=false', sc1.isOperational === false, JSON.stringify(sc1))
  check('2차는 종합전용(●) 항목 제외', isItemInScope({ comprehensive_only: true }, sc2) === false)
  check('1차는 종합전용(●) 항목 포함', isItemInScope({ comprehensive_only: true }, sc1) === true)
  check('공통 항목은 양쪽 다 포함',
    isItemInScope({ comprehensive_only: false }, sc2) && isItemInScope({ comprehensive_only: false }, sc1))

  // ── 8) 단일 원천 헬퍼 ────────────────────────────────────────────────────
  console.log('\n[8] lib/inspection-round 규약')
  check('rowSubType: 종합 고객 2차 → 작동', rowSubType('종합', 2) === '작동')
  check('rowSubType: 종합 고객 1차 → 종합', rowSubType('종합', 1) === '종합')
  check('rowSubType: 작동 고객은 차수 무관 작동', rowSubType('작동', 1) === '작동' && rowSubType('작동', 2) === '작동')
  check('rowPlanType: 2차 → special_작동', rowPlanType('종합', 2) === 'special_작동')
  check('rowInspectionType: 일반관리는 차수 무관 보존',
    rowInspectionType('일반관리', '종합', 2) === '일반관리' && rowInspectionType('일반관리', '종합', 1) === '일반관리')
  check('rowInspectionType: 소방안전관리 2차 → 작동', rowInspectionType('종합', '종합', 2) === '작동')

  // ── 9) 결과 축 불변식 (INV-D12와 같은 술어) ──────────────────────────────
  console.log('\n[9] 결과 축 — INV-D12 술어')
  const { data: allSeq2 } = await raw.from('inspection_plan_items')
    .select('id, plan_type').eq('sequence_num', 2)
  const bad = (allSeq2 ?? []).filter((r: { plan_type: string | null }) =>
    (r.plan_type ?? '').startsWith('special') && r.plan_type !== 'special_작동')
  check('DB 전체: seq2 special_* 는 전부 special_작동', bad.length === 0, JSON.stringify(bad.slice(0, 5)))
} catch (e) {
  fail++
  console.log(`\n❌ 테스트 중단: ${(e as Error).message}`)
} finally {
  console.log('\n[정리] 테스트 데이터 삭제')
  for (const id of madeInspections) {
    await raw.from('inspection_steps').delete().eq('inspection_id', id)
    await raw.from('inspections').delete().eq('id', id)
  }
  for (const cid of madeCustomers) {
    await raw.from('inspection_plan_items').delete().eq('customer_id', cid)
    const { data: insp } = await raw.from('inspections').select('id').eq('customer_id', cid)
    for (const i of (insp ?? []) as Array<{ id: string }>) {
      await raw.from('inspection_steps').delete().eq('inspection_id', i.id)
      await raw.from('inspections').delete().eq('id', i.id)
    }
    await raw.from('customers').delete().eq('id', cid)
  }
  const { data: left } = await raw.from('customers').select('id').like('customer_code', 'TEST-S33-%')
  console.log(`잔여 테스트 고객: ${(left ?? []).length}건`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
