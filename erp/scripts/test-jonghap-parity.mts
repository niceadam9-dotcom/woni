/** 종합 대상 동등성 — **일반관리 종합이 소방안전관리 종합과 사용승인일 축에서 같은 동작인가**.
 *  (DB 필요·서버 불필요)
 *  실행: npx tsx --conditions=react-server scripts/test-jonghap-parity.mts [--with-start]
 *
 *  ## 왜 이 검사가 따로 있어야 하나
 *  화면(점검유형 변경 모달)은 두 종합의 차이를 "정기 매월 유무"로만 약속한다 — 자체점검 축
 *  (종합=기산월·작동=+6개월·최초점검 60일, 전부 사용승인일 기산)은 동일해야 한다.
 *  그런데 이 축의 결함은 늘 **관리유형 분기에서** 났다: F-1(일반관리 종합은 최초점검이 될 수
 *  없었다)·F-3(별지 9호 3분기 빈칸)·재계산 비대칭(소방은 안 생기고 일반은 중복 생성)·
 *  toSpecial 예정일 미재계산(2026-09-02, 이 검사가 잡았다 — 정기 행이 있는 소방안전관리에서만
 *  승격 경로가 옛 기산일의 '일'을 남겼다). 기존 검사는 두 유형을 **따로** 봤고, 나란히 대조하는
 *  축이 없어 이런 갈라짐이 조용히 지나갔다.
 *
 *  ## 설계 — 쌍둥이 고객
 *  같은 사용승인일의 A(소방안전관리 종합)·B(일반관리 종합)를 만들어 생성→기산점 변경→재계산을
 *  나란히 돌리고, **특별점검 축의 최종 상태가 문자열까지 같은가**를 묻는다. 점검계획일은 일부러
 *  다른 달로 둔다(기산이 정말 사용승인일을 따르는지 함께 증명 — plan_anchor_manual=false).
 *
 *  다르도록 설계된 유일한 축: 정기(monthly) — A>0 · B=0 (소방계획서_6 D-1).
 *
 *  ⚠ --with-start: startInspectionCore로 is_initial 판정 동등성까지 실측한다(F-1 재발 축).
 *    activity_logs 1행씩 남으므로(append-only — 프로브가 못 지운다) 기본은 끈다.
 *    is_initial 배선은 planTypeSub(plan_type) 공유 코드라, 계획 행이 같으면(위에서 단언)
 *    구조적으로 같지만 — 그 '구조적으로'가 깨진 게 F-1이었으니 수동 실측 경로를 남겨 둔다.
 *  ⚠ 테스트 고객을 만들어 쓰고 반드시 지운다(잔여 0을 마지막에 단언). */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { generateRollingPlanItems } from '../src/lib/inspection-plan-generator.ts'
import { reconcileSpecialSlots } from '../src/lib/reconcile-special-slots.ts'
import { startInspectionCore } from '../src/lib/inspection-start.ts'

const WITH_START = process.argv.includes('--with-start')

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const admin = raw as never as Parameters<typeof reconcileSpecialSlots>[0]

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

const APPROVAL = '2009-02-13'          // 종합 2월 / 작동 8월 (운영 C003과 같은 축)
const PLAN_DATE = '2009-08-27'         // 일부러 다른 달 — 기산이 이걸 따르면 축이 틀린 것
const YEAR = new Date().getFullYear()
const made: string[] = []
const startedInspections: string[] = []

async function mkCustomer(name: string, fields: Record<string, unknown>, actor: string): Promise<string> {
  const { data, error } = await raw.from('customers').insert({
    customer_code: `TEST-PARITY-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: name, address: 'X', fire_station: 'X',
    is_active: true, created_by: actor,
    use_approval_date: APPROVAL, plan_anchor_date: PLAN_DATE, plan_anchor_manual: false,
    ...fields,
  }).select('id').single()
  if (error) { console.error('고객 생성 실패:', error.message); process.exit(1) }
  const id = (data as { id: string }).id
  made.push(id)
  return id
}

type Row = {
  id: string; sequence_num: number; plan_type: string | null; status: string
  planned_date: string | null; scheduled_date: string | null
  inspection_type: string | null; inspection_sub_type: string | null
  plan: { year: number; month: number } | null
}
async function itemsOf(customerId: string): Promise<Row[]> {
  const { data } = await raw.from('inspection_plan_items')
    .select('id, sequence_num, plan_type, status, planned_date, scheduled_date, inspection_type, inspection_sub_type, plan:inspection_plans(year, month)')
    .eq('customer_id', customerId)
  return ((data ?? []) as unknown as Row[]).filter(r => r.plan)
}
/** 특별점검 축만 추려 비교 가능한 문자열 집합으로 — id·관리유형 라벨은 뺀다(그 축은 다르도록 설계됨) */
const specialKey = (rows: Row[]) => rows
  .filter(r => String(r.plan_type ?? '').startsWith('special'))
  .map(r => `${r.plan!.year}-${String(r.plan!.month).padStart(2, '0')} seq=${r.sequence_num} ${r.plan_type} ${r.planned_date} ${r.status}`)
  .sort()
const eqSets = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)

const { data: prof } = await raw.from('profiles').select('id').limit(1).single()
const actor = (prof as { id: string }).id

try {
  console.log(`— 쌍둥이: 사용승인일 ${APPROVAL} · 점검계획일 ${PLAN_DATE}(다른 달 — 축 증명 겸) · manual=false`)
  const A = await mkCustomer('TEST-소방종합', { inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합' }, actor)
  const B = await mkCustomer('TEST-일반종합', { inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: '종합' }, actor)

  // ── [1] 생성 — 특별점검 축이 동일한가 ─────────────────────────────────────
  console.log('\n[1] generateRollingPlanItems — 올해+내년')
  for (const id of [A, B]) {
    await generateRollingPlanItems(admin, {
      id, inspection_type: id === A ? '종합' : '일반관리',
      inspection_category: id === A ? '소방안전관리' : '일반관리', inspection_sub_type: '종합',
      plan_anchor_date: PLAN_DATE, use_approval_date: APPROVAL, plan_anchor_manual: false,
      assigned_employee_id: null,
    }, YEAR, actor)
  }
  const ia = await itemsOf(A), ib = await itemsOf(B)
  const sa = specialKey(ia), sb = specialKey(ib)
  check('특별점검 집합(연·월·차수·종류·예정일·status)이 완전 동일', eqSets(sa, sb),
    `A=${JSON.stringify(sa)} B=${JSON.stringify(sb)}`)
  // ⚠ 공허 통과 차단 — 두 집합이 '둘 다 비어서' 같으면 위 단언은 알리바이다
  check('모집단 — 특별점검이 실제로 생겼다(연 2건 × 2해)', sa.length === 4, `${sa.length}건`)
  check('기산이 사용승인일을 따른다 — 1차가 2월(계획일 8월이 아니라)',
    sa.some(k => k.includes('-02 seq=1 special_종합')), sa.join(' | '))
  check('종합 대상 2차 — 8월 special_작동이 양쪽 다 있다',
    sa.some(k => k.includes('-08 seq=2 special_작동')) && sb.some(k => k.includes('-08 seq=2 special_작동')))
  const monA = ia.filter(r => r.plan_type === 'monthly').length
  const monB = ib.filter(r => r.plan_type === 'monthly').length
  check(`설계된 유일한 차이 — 정기: 소방 ${monA}건 > 0 · 일반 ${monB}건 = 0`, monA > 0 && monB === 0)
  check('일반관리 행의 관리유형 축 보존 — special 행 inspection_type=일반관리',
    ib.filter(r => String(r.plan_type ?? '').startsWith('special')).every(r => r.inspection_type === '일반관리'))

  // ── [2] 기산점 변경 → 재계산 — 최종 상태가 동일한가 ──────────────────────
  //  A는 정기 행이 있어 승격/강등 경로, B는 생성/삭제 경로를 탄다 — **경로가 다른데 결과가
  //  같아야** 이 검사의 의미가 있다(toSpecial 예정일 미재계산이 정확히 여기서 잡혔다).
  console.log('\n[2] 사용승인일 2010-07-20으로 변경 → reconcileSpecialSlots')
  await raw.from('customers').update({ use_approval_date: '2010-07-20' }).in('id', [A, B])
  const ra = await reconcileSpecialSlots(admin, A, [YEAR, YEAR + 1], actor)
  const rb = await reconcileSpecialSlots(admin, B, [YEAR, YEAR + 1], actor)
  console.log(`    (경로는 달라도 된다 — A 승격${ra.promoted}/강등${ra.demoted}/삭제${ra.removed}/생성${ra.created} · B ${rb.promoted}/${rb.demoted}/${rb.removed}/${rb.created})`)
  check('경로가 실제로 달랐다(A 승격>0 — 같은 경로면 이 대조는 아무것도 증명 못 한다)', ra.promoted > 0)
  const ia2 = await itemsOf(A), ib2 = await itemsOf(B)
  const sa2 = specialKey(ia2), sb2 = specialKey(ib2)
  check('재계산 후 특별점검 최종 상태가 완전 동일(예정일 포함)', eqSets(sa2, sb2),
    `A=${JSON.stringify(sa2)} B=${JSON.stringify(sb2)}`)
  check('1차가 7월로 이동(양쪽)', sa2.some(k => k.includes('-07 seq=1 special_종합')) && sb2.some(k => k.includes('-07 seq=1 special_종합')))
  check('2차가 1월로 이동(양쪽)', sa2.some(k => k.includes('-01 seq=2 special_작동')) && sb2.some(k => k.includes('-01 seq=2 special_작동')))
  check('일반관리에 정기가 생기지 않았다(재계산 후에도 0)', ib2.every(r => r.plan_type !== 'monthly'))

  // ── [3] is_initial 판정 동등성 (--with-start 전용) ────────────────────────
  if (WITH_START) {
    console.log('\n[3] startInspectionCore — is_initial (승인일 2010-07-20 기준)')
    const today = new Date().toISOString().slice(0, 10)
    const within = '2010-08-10'   // 승인 +21일 — 60일 안
    const results: Record<string, { out: boolean | null; inn: boolean | null }> = {}
    for (const [label, id] of [['소방종합', A], ['일반종합', B]] as const) {
      const rows = await itemsOf(id)
      const firsts = rows.filter(r => r.plan_type === 'special_종합' && r.sequence_num === 1 && r.status !== 'completed')
        .sort((x, y) => x.plan!.year - y.plan!.year)
      const isInit = async (row: Row | undefined, sched: string): Promise<boolean | null> => {
        if (!row) return null
        await raw.from('inspection_plan_items').update({ scheduled_date: sched }).eq('id', row.id)
        const res = await startInspectionCore(admin, actor, row.id, { skipRevalidate: true })
        if (!res.inspectionId) return null
        startedInspections.push(res.inspectionId)
        const { data } = await raw.from('inspections').select('is_initial').eq('id', res.inspectionId).single()
        return (data as { is_initial: boolean } | null)?.is_initial ?? null
      }
      results[label] = { out: await isInit(firsts[0], today), inn: await isInit(firsts[1], within) }
    }
    check('60일 밖 → 둘 다 false (동일)',
      results['소방종합'].out === false && results['일반종합'].out === false,
      JSON.stringify({ A: results['소방종합'].out, B: results['일반종합'].out }))
    check('60일 안 → 둘 다 true (동일 — F-1이라면 일반관리만 false였을 축)',
      results['소방종합'].inn === true && results['일반종합'].inn === true,
      JSON.stringify({ A: results['소방종합'].inn, B: results['일반종합'].inn }))
  }
} finally {
  console.log('\n— 정리')
  await raw.from('inspection_plan_items').update({ inspection_id: null }).in('customer_id', made)
  if (startedInspections.length > 0) {
    await raw.from('inspection_steps').delete().in('inspection_id', startedInspections)
    await raw.from('inspections').delete().in('id', startedInspections)
  }
  await raw.from('inspection_plan_items').delete().in('customer_id', made)
  await raw.from('customers').delete().in('id', made)
  const { data: leftC } = await raw.from('customers').select('id').in('id', made)
  const { data: leftI } = await raw.from('inspection_plan_items').select('id').in('customer_id', made)
  const { data: leftN } = startedInspections.length > 0
    ? await raw.from('inspections').select('id').in('id', startedInspections) : { data: [] }
  check('잔여 0 (고객·계획항목·점검)', (leftC ?? []).length === 0 && (leftI ?? []).length === 0 && (leftN ?? []).length === 0,
    `customers=${(leftC ?? []).length} items=${(leftI ?? []).length} inspections=${(leftN ?? []).length}`)
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  process.exit(fail > 0 ? 1 : 0)
}
