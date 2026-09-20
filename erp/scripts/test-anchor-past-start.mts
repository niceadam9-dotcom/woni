/** 과거·오늘 점검일자 = 점검 사실 — 입력한 날짜 **그대로** 1차 자체점검이 시작된다.
 *
 *  🚨 2026-09-20 운영 신고(하늘촌): 등록 폼 점검일자 09-18 → 달력 09-21(영업일 보정이 덮음),
 *  점검업무 빈칸(자동 시작은 당일 크론뿐 — 창 D-3~D0 밖 과거면 영영 미시작).
 *  규칙(사용자 확정): 과거·오늘 점검일자는 scheduled_date로 그대로 기록(보정 없음) + 즉시 시작
 *  (inspection_start_date = 그 날짜). 미래 날짜는 종전 그대로(법정 축 + 당일 크론).
 *
 *  핵심 단언이 무는지 스스로 증명하기 위해 과거 날짜를 **일요일**로 고른다 — 영업일 보정이
 *  되살아나면 [A2]가 즉시 빨강이 된다.
 *
 *  실행: npx tsx scripts/test-anchor-past-start.mts   (스테이징 DB — 임시 데이터 생성 후 전량 삭제)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import gen from '../src/lib/inspection-plan-generator.ts'
import start from '../src/lib/inspection-start.ts'
import kst from '../src/lib/kst-date.ts'
const { generateRollingPlanItems } = gen as unknown as typeof import('../src/lib/inspection-plan-generator.ts')
const { applyPastAnchorInspection } = start as unknown as typeof import('../src/lib/inspection-start.ts')
const { todayKst } = kst as unknown as typeof import('../src/lib/kst-date.ts')

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const admin = raw as never as Parameters<typeof generateRollingPlanItems>[0]

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

/** 오늘(KST) 이전의 가장 가까운 **일요일** — 영업일 보정 부활을 무는 표본 */
function lastSundayBefore(todayISO: string): string {
  const d = new Date(todayISO + 'T00:00:00Z')
  do { d.setUTCDate(d.getUTCDate() - 1) } while (d.getUTCDay() !== 0)
  return d.toISOString().slice(0, 10)
}

const EMAIL = 'anchor-past-e2e@erp-test.com'
let userId = ''
const custIds: string[] = []

async function mkCustomer(name: string, fields: Record<string, unknown>) {
  const { data, error } = await raw.from('customers').insert({
    customer_code: `TEST-AP-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: name, is_active: true, created_by: userId, assigned_employee_id: userId,
    ...fields,
  }).select('id').single()
  if (error) throw new Error(`고객 생성 실패: ${error.message}`)
  custIds.push(data!.id)
  return data!.id as string
}

async function itemsOf(cid: string) {
  const { data } = await raw.from('inspection_plan_items')
    .select('id, status, plan_type, planned_date, scheduled_date, inspection_id, step1_date')
    .eq('customer_id', cid).order('planned_date')
  return (data ?? []) as Array<{ id: string; status: string; plan_type: string | null; planned_date: string | null; scheduled_date: string | null; inspection_id: string | null; step1_date: string | null }>
}

try {
  console.log('\n[셋업] 관리자 계정 + 임시 고객')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: 'AnchorPast1!', email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`계정 생성 실패: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST과거점검일', role: 'admin', is_active: true, employee_id: 'E2E-AP', email: EMAIL })

  const today = todayKst()
  const year = Number(today.slice(0, 4))
  const pastSunday = lastSundayBefore(today)
  const future = new Date(new Date(today + 'T00:00:00Z').getTime() + 10 * 86400000).toISOString().slice(0, 10)

  // ── A. 과거(일요일) 점검일자 — 그대로 기록 + 즉시 시작 ─────────────────────
  console.log(`\n[A] 과거 점검일자 ${pastSunday}(일요일) — 보정 없이 그대로, 즉시 시작`)
  const custA = await mkCustomer('TEST-과거점검일-작동', {
    inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: '작동',
    plan_anchor_date: pastSunday,
  })
  await generateRollingPlanItems(admin, {
    id: custA, inspection_type: '일반관리', inspection_sub_type: '작동',
    plan_anchor_date: pastSunday, assigned_employee_id: userId,
  }, year, userId)
  const resA = await applyPastAnchorInspection(admin, custA, pastSunday, userId)
  check('[A1] applied=true', resA.applied === true, resA.error ?? '')
  const aItems = await itemsOf(custA)
  const aFirst = aItems.find(i => i.inspection_id != null)
  check('[A2] scheduled_date = 입력값 그대로 (일요일 — 영업일 보정 없음)',
    aFirst?.scheduled_date === pastSunday, `scheduled=${aFirst?.scheduled_date}`)
  check('[A3] step1_date = 입력값 (마감일 산식이 그 날짜 기준)',
    aFirst?.step1_date === pastSunday, `step1=${aFirst?.step1_date}`)
  const { data: aInsp } = await raw.from('inspections')
    .select('id, inspection_start_date, status').eq('customer_id', custA)
  check('[A4] 점검이 정확히 1건 시작됨', (aInsp ?? []).length === 1, `${(aInsp ?? []).length}건`)
  check('[A5] inspection_start_date = 입력값', aInsp?.[0]?.inspection_start_date === pastSunday,
    `start=${aInsp?.[0]?.inspection_start_date}`)
  check('[A6] status = in_progress (점검업무 목록 표시 축)', aInsp?.[0]?.status === 'in_progress')
  const { data: aSteps } = await raw.from('inspection_steps')
    .select('step_num, due_date').eq('inspection_id', aInsp?.[0]?.id ?? '').order('step_num')
  check('[A7] 1단계 due_date = 입력값 (체크리스트 동기화)',
    (aSteps ?? [])[0]?.due_date === pastSunday, `due=${(aSteps ?? [])[0]?.due_date}`)

  // ── B. 미래 점검일자 — 아무것도 시작하지 않는다 (종전 동작 보존) ────────────
  console.log(`\n[B] 미래 점검일자 ${future} — 시작 없음(당일 크론 몫)`)
  const custB = await mkCustomer('TEST-미래점검일-작동', {
    inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: '작동',
    plan_anchor_date: future,
  })
  await generateRollingPlanItems(admin, {
    id: custB, inspection_type: '일반관리', inspection_sub_type: '작동',
    plan_anchor_date: future, assigned_employee_id: userId,
  }, year, userId)
  const resB = await applyPastAnchorInspection(admin, custB, future, userId)
  check('[B1] applied=false (미래는 건드리지 않는다)', resB.applied === false)
  const { data: bInsp } = await raw.from('inspections').select('id').eq('customer_id', custB)
  check('[B2] 점검 0건', (bInsp ?? []).length === 0, `${(bInsp ?? []).length}건`)
  const bItems = await itemsOf(custB)
  check('[B3] 시작된 항목 0건', bItems.every(i => i.inspection_id == null))

  // ── C. 법정 축(사용승인일) 고객 — 하늘촌 재현: 입력값이 축과 달라도 그대로 ────
  console.log('\n[C] 사용승인일 축(manual=false) + 과거 점검일자 — 신고 그대로 재현')
  const custC = await mkCustomer('TEST-법정축-과거점검일', {
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    plan_anchor_date: pastSunday, use_approval_date: '2020-03-05', plan_anchor_manual: false,
  })
  await generateRollingPlanItems(admin, {
    id: custC, inspection_type: '작동' as never, inspection_sub_type: '작동',
    plan_anchor_date: pastSunday, use_approval_date: '2020-03-05', plan_anchor_manual: false,
    assigned_employee_id: userId,
  } as never, year, userId)
  const resC = await applyPastAnchorInspection(admin, custC, pastSunday, userId)
  check('[C1] applied=true', resC.applied === true, resC.error ?? '')
  const cItems = await itemsOf(custC)
  const cFirst = cItems.find(i => i.inspection_id != null)
  check('[C2] 대상은 자체점검(special_*)이다 — 정기(monthly)를 시작하면 안 된다',
    cFirst?.plan_type?.startsWith('special_') === true, `plan_type=${cFirst?.plan_type}`)
  check('[C3] scheduled = 입력값 (법정 축 날짜가 아니라)', cFirst?.scheduled_date === pastSunday,
    `scheduled=${cFirst?.scheduled_date}`)
  check('[C4] planned는 법정 자리 기록으로 남는다 (덮지 않음)',
    cFirst != null && cFirst.planned_date !== pastSunday, `planned=${cFirst?.planned_date}`)

  // ── W. 배선 — 등록 액션이 실제로 이 함수를 부른다 (lib만 맞고 미배선이면 재발) ──
  console.log('\n[W] 배선 단언 (customers/actions.ts)')
  const actionsSrc = readFileSync(new URL('../src/app/(dashboard)/customers/actions.ts', import.meta.url), 'utf8')
  const fnStart = actionsSrc.indexOf('async function _autoCreatePlanItemsForNewCustomer')
  const fnEnd = fnStart >= 0 ? actionsSrc.indexOf('\n}', fnStart) : -1
  const fnBody = fnStart >= 0 && fnEnd >= 0 ? actionsSrc.slice(fnStart, fnEnd) : ''
  check('[W1] _autoCreatePlanItemsForNewCustomer 본문 추출', fnBody.length > 0)
  check('[W2] 본문이 applyPastAnchorInspection을 부른다',
    /applyPastAnchorInspection\s*\(\s*admin\s*,\s*customerId\s*,\s*info\.plan_anchor_date/.test(fnBody))
  check('[W3] 생성(generateRollingPlanItems) **뒤에** 부른다 — 순서가 바뀌면 회차가 없어 실패',
    fnBody.indexOf('generateRollingPlanItems') >= 0 &&
    fnBody.indexOf('generateRollingPlanItems') < fnBody.indexOf('applyPastAnchorInspection'))
} catch (e) {
  fail++
  console.error('\n❌ 테스트 중단:', (e as Error).message)
} finally {
  for (const cid of custIds) {
    const inspIds = ((await raw.from('inspections').select('id').eq('customer_id', cid)).data ?? []).map(r => r.id)
    if (inspIds.length) {
      for (const t of ['inspection_sheet_responses', 'inspection_defects', 'inspection_status_log', 'inspection_steps', 'inspection_logs']) {
        await raw.from(t).delete().in('inspection_id', inspIds)
      }
    }
    await raw.from('inspection_plan_items').delete().eq('customer_id', cid)
    await raw.from('inspections').delete().eq('customer_id', cid)
    await raw.from('activity_logs').delete().in('entity_id', [cid, ...inspIds])
    await raw.from('customers').delete().eq('id', cid)
  }
  if (userId) {
    await raw.from('profiles').delete().eq('id', userId)
    await raw.auth.admin.deleteUser(userId).catch(() => {})
  }
  console.log('\n[정리] 완료')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
