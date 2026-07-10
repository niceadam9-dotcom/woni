// 불변식 검출력 테스트 (DET-1~9) — 위반 데이터를 의도 주입해 두 검사 스크립트가 실제로 잡아내는지 확인
// 실행: node scripts/test-inv-detection.mjs  (dev DB, 테스트 데이터 자동 정리)
// 주입: INV-P1(지난달 정기)·P2(기준일 이전)·P3(마커 불일치)·P7/INV-3(완료 무점검)·INV-1(비활성 미취소)·INV-4(확정 step 누락)·INV-5(취소 step 잔재)
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

const erpDir = dirname(dirname(fileURLToPath(import.meta.url)))
const repoDir = dirname(erpDir)
const raw = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

let pass = 0, fail = 0
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${d}`) } }
const run = (cmd, cwd) => {
  try { return { out: execSync(cmd, { cwd, encoding: 'utf8' }), code: 0 } }
  catch (e) { return { out: (e.stdout ?? '') + (e.stderr ?? ''), code: e.status ?? 1 } }
}

const custIds = []
const createdPlanIds = []
let sysId = ''
async function planId(year, month) {
  const { data: ep } = await raw.from('inspection_plans').select('id').eq('year', year).eq('month', month).maybeSingle()
  if (ep) return ep.id
  const { data: np } = await raw.from('inspection_plans')
    .insert({ year, month, status: 'draft', auto_generated: true, created_by: sysId }).select('id').single()
  createdPlanIds.push(np.id)
  return np.id
}

try {
  const { data: sys } = await raw.from('profiles').select('id').eq('is_system', true).single()
  sysId = sys.id

  // ── 주입: 활성 고객 D1 (승인일 2026-06-01 → 기준일 6/1) ──
  console.log('\n[주입] 위반 데이터 7종 생성')
  const { data: d1 } = await raw.from('customers').insert({
    customer_code: `TEST-DET1-${Math.random().toString(36).slice(2, 6)}`,
    customer_name: 'TEST-검출-활성', inspection_type: '작동',
    inspection_category: '소방안전관리', inspection_sub_type: '작동',
    use_approval_date: '2026-06-01', contract_date: '2026-01-05',
    is_active: true, created_by: sysId,
  }).select('id').single()
  custIds.push(d1.id)
  const { data: d2 } = await raw.from('customers').insert({
    customer_code: `TEST-DET2-${Math.random().toString(36).slice(2, 6)}`,
    customer_name: 'TEST-검출-비활성', inspection_type: '작동',
    inspection_category: '소방안전관리', inspection_sub_type: '작동',
    use_approval_date: '2026-06-01', contract_date: '2026-01-05',
    is_active: false, created_by: sysId,
  }).select('id').single()
  custIds.push(d2.id)

  const p06 = await planId(2026, 6)
  const p08 = await planId(2026, 8)
  const base = (plan, seq, extra) => ({
    plan_id: plan, customer_id: d1.id, inspection_type: '작동',
    inspection_category: '소방안전관리', inspection_sub_type: '작동',
    sequence_num: seq, plan_type: 'monthly', status: 'planned', ...extra,
  })
  const seeds = [
    ['DET-1 INV-P1: 지난달(6월) 정기 planned',      base(p06, 1, { planned_date: '2026-06-10' })],
    ['DET-2 INV-P2: 기준일(6/1) 이전 예정일',        base(p08, 2, { planned_date: '2026-05-01' })],
    ['DET-3 INV-P3: 마커 있으나 planned',            base(p08, 1, { planned_date: '2026-08-10', notes: '⟦자동취소:planned⟧' })],
    ['DET-7 INV-P7/INV-3: 완료인데 점검 없음',       { ...base(p08, 1, { planned_date: '2026-08-11', status: 'completed' }), customer_id: d2.id, plan_id: p08 }],
    ['DET-8 INV-4: 확정인데 step1 누락',             base(p08, 2, { planned_date: '2026-08-12', scheduled_date: '2026-08-12', status: 'confirmed', customer_id: d2.id })],
    ['DET-9 INV-5: 취소인데 step 잔재',              base(p08, 1, { planned_date: '2026-08-13', status: 'cancelled', step1_date: '2026-08-13', customer_id: d2.id, sequence_num: 2 })],
  ]
  // 주의: (plan, customer, sequence) UNIQUE — d1: p06/1, p08/2, p08/1 / d2: p08/1, p08/2 → DET-9는 (p06, d2)로 회피
  seeds[5][1].plan_id = p06
  // DET-6 INV-1: 비활성 고객의 planned 항목 (d2, p08 seq... p08/d2 seq1·2 사용됨 → p06/d2 seq1)
  seeds.push(['DET-6 INV-1: 비활성 고객 미취소 계획', { ...base(p06, 1, { planned_date: '2026-06-15' }), customer_id: d2.id }])
  // seeds[5](DET-9)는 p06/d2/seq2, seeds[6](DET-6)은 p06/d2/seq1 — 충돌 없음
  for (const [name, row] of seeds) {
    const { error } = await raw.from('inspection_plan_items').insert(row)
    if (error) throw new Error(`${name} 주입 실패: ${error.message}`)
    console.log('  주입:', name)
  }

  // ── 검출 확인 ──
  console.log('\n[검출] 불변식 스크립트 실행')
  const nu = run('node scripts/check-plan-invariants.mjs', erpDir)
  check('신형 스크립트 exit 1 (위반 검출)', nu.code === 1)
  check('DET-1: INV-P1 검출', nu.out.includes('❌ INV-P1') && nu.out.includes('TEST-검출'), nu.out.split('\n').find(l => l.includes('INV-P1')))
  check('DET-2: INV-P2 검출', nu.out.includes('❌ INV-P2'))
  check('DET-3: INV-P3 검출', nu.out.includes('❌ INV-P3'))
  check('DET-7: INV-P7 검출', nu.out.includes('❌ INV-P7'))

  const legacy = run('node victory_test/invariant_check.mjs', repoDir)
  check('DET-6: INV-1 검출(구형)', /INV-1[^\n]*WARN|\[WARN\] INV-1/.test(legacy.out), legacy.out.split('\n').find(l => l.includes('INV-1')))
  check('DET-7: INV-3 검출(구형)', /\[WARN\] INV-3/.test(legacy.out))
  check('DET-8: INV-4 검출(구형)', /\[WARN\] INV-4/.test(legacy.out))
  check('DET-9: INV-5 검출(구형)', /\[WARN\] INV-5/.test(legacy.out))
  check('🔍 INV-2는 오탐 없음(PASS 유지)', /\[PASS\] INV-2/.test(legacy.out))
} catch (e) {
  fail++
  console.error('❌ 중단:', e.message)
} finally {
  console.log('\n[정리] 주입 데이터 삭제')
  for (const id of custIds) {
    await raw.from('inspection_plan_items').delete().eq('customer_id', id)
    await raw.from('customers').delete().eq('id', id)
  }
  for (const pid of createdPlanIds) {
    const { count } = await raw.from('inspection_plan_items').select('id', { count: 'exact', head: true }).eq('plan_id', pid)
    if ((count ?? 0) === 0) await raw.from('inspection_plans').delete().eq('id', pid)
  }
  // 청정 상태 복귀 확인
  const clean = run('node scripts/check-plan-invariants.mjs', erpDir)
  console.log(clean.code === 0 ? '  ✅ 정리 후 불변식 전부 성립' : '  ⚠ 정리 후에도 위반 잔존!')
  if (clean.code !== 0) fail++
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
