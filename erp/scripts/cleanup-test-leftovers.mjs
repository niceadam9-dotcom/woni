/** 테스트 잔재 청소 — E2E가 중간에 죽어 남긴 픽스처를 걷어낸다 (2026-08-21)
 *
 *  실행:
 *    node scripts/cleanup-test-leftovers.mjs              조회만(기본) — 무엇이 지워질지 보여준다
 *    node scripts/cleanup-test-leftovers.mjs --apply      실제 삭제
 *    node scripts/cleanup-test-leftovers.mjs --hours=6    6시간 이상 묵은 것만
 *
 *  왜 —
 *  E2E는 고객·계정을 만들고 끝에 지운다. 그런데 스위트가 중간에 죽으면(타임아웃·예외) 정리가
 *  실행되지 않아 픽스처가 남는다. 2026-08-21 실측으로 고객 19건·계정 17건이 쌓여 있었고,
 *  그중 하나가 `일반관리 sub_type null`이라 **푸시할 때마다 불변식 경고**를 띄우고 있었다.
 *  경고가 상시화되면 진짜 위반이 그 안에 묻힌다.
 *
 *  ★ 판별 축은 **이름이 아니라 생성자 계정**이다.
 *  이름 패턴(TEST·프로브·E2E)으로 고르면 절반을 놓친다 — E2E는 고객 이름을 랜덤 접미사로 짓기
 *  때문이다(`문자UI-Ahqnyf`·`동기화mm31t-2`). 반대로 이름만 보고 지우면 실고객 중 이름에
 *  '테스트'가 든 곳을 지울 수 있다. 그래서:
 *    삭제 대상 = 테스트 계정이 만든 것          (자동 픽스처는 반드시 여기 걸린다)
 *    보고만    = 이름만 수상한 것               (사람이 만든 것일 수 있어 판단을 넘긴다)
 *
 *  ★ 나이 제한(기본 2시간)이 있는 이유 —
 *  다른 세션이 지금 돌리고 있는 E2E의 픽스처를 지워 버리면 남의 테스트를 무너뜨린다.
 *  진행 중인 스위트의 픽스처는 몇 분 이내다. */
import { raw, cleanupCustomer, delUser } from './_e2e-helpers.mjs'
import { SUPABASE_URL } from './_env.mjs'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const HOURS = Number((process.argv.find(a => a.startsWith('--hours=')) ?? '').split('=')[1] ?? 2)

/** 테스트 전용 메일 도메인 — 실계정과 겹칠 수 없는 것만 (실계정: sjfire.co.kr·naver.com 등) */
const TEST_EMAIL = /@e2e\.test$|@erp-test\.com$|@test\.local$|@example\.com$/i
/** 이름 표지 — 지우지 않는다. 사람이 만든 수기 테스트 행일 수 있어 눈에만 띄게 한다 */
const NAME_HINT = [/^TEST/i, /E2E/i, /프로브/, /^테스트/, /^샘플/, /^더미/]

const STAGING_REF = 'nwflnzugwylhpdyodyog'
const isStaging = SUPABASE_URL.includes(STAGING_REF)

console.log(`대상 DB: ${SUPABASE_URL}${isStaging ? ' (스테이징)' : ' ⚠ 스테이징 아님'}`)
console.log(`모드: ${APPLY ? '삭제' : '조회만'} · ${HOURS}시간 이상 묵은 것만\n`)
if (APPLY && !isStaging && !FORCE) {
  console.error('❌ 스테이징이 아닌 DB에 --apply는 막는다. 정말이면 --force를 함께 준다.')
  process.exit(2)
}

const cutoff = new Date(Date.now() - HOURS * 3600_000).toISOString()

// ── ① 테스트 계정 ────────────────────────────────────────────────
const { data: profiles, error: pErr } = await raw.from('profiles')
  .select('id, name, email, is_active, created_at')
if (pErr) { console.error('계정 조회 실패:', pErr.message); process.exit(1) }
const testAccounts = (profiles ?? []).filter(p => TEST_EMAIL.test(p.email ?? ''))
if (testAccounts.length === 0) { console.log('테스트 계정 0건 — 잔재 없음') }

// ── ② 그 계정이 만든 고객 = 자동 픽스처 ──────────────────────────
const acctIds = testAccounts.map(p => p.id)
let fixtures = []
if (acctIds.length) {
  const { data, error } = await raw.from('customers')
    .select('id, customer_name, is_active, created_at, created_by')
    .in('created_by', acctIds).lt('created_at', cutoff)
  if (error) { console.error('고객 조회 실패:', error.message); process.exit(1) }
  fixtures = data ?? []
}
const acctById = new Map(testAccounts.map(p => [p.id, p.email]))
console.log(`■ 삭제 대상 고객 ${fixtures.length}건 (테스트 계정 생성)`)
for (const c of fixtures) console.log(`   ${c.created_at.slice(0, 16)}  ${c.customer_name}  ← ${acctById.get(c.created_by)}`)

// ── ③ 이름만 수상한 것 — 보고만 한다 ─────────────────────────────
const { data: allCust } = await raw.from('customers').select('id, customer_name, created_at, created_by')
const fixtureIds = new Set(fixtures.map(c => c.id))
const suspicious = (allCust ?? []).filter(c =>
  !fixtureIds.has(c.id) && !acctIds.includes(c.created_by) &&
  NAME_HINT.some(p => p.test(c.customer_name ?? '')))
if (suspicious.length) {
  console.log(`\n■ 확인 필요 ${suspicious.length}건 — 이름은 테스트 같지만 **실계정이 만든 행**이라 지우지 않는다`)
  for (const c of suspicious) console.log(`   ${c.created_at?.slice(0, 16)}  ${c.customer_name}  ${c.id}`)
}

if (!APPLY) {
  console.log(`\n조회만 했다. 실제로 지우려면 --apply를 붙인다.`)
  process.exit(0)
}

// ── ④ 삭제 ───────────────────────────────────────────────────────
let custOk = 0
if (fixtures.length) {
  const ids = fixtures.map(c => c.id)
  // cleanupCustomer가 모르는 신규 테이블(140) — FK가 걸리기 전에 먼저 치운다
  await raw.from('sms_send_log').delete().in('customer_id', ids)
  for (const c of fixtures) {
    try {
      await cleanupCustomer(c.id)
      const { data } = await raw.from('customers').select('id').eq('id', c.id)
      if (data?.length) console.log(`   ❌ ${c.customer_name} — 남음`)
      else { custOk++; console.log(`   ✅ ${c.customer_name}`) }
    } catch (e) { console.log(`   ❌ ${c.customer_name} — ${e.message}`) }
  }
}

// ── ⑤ 계정 — 참조가 남았으면 지우지 않고 비활성화한다 ────────────
//    실데이터가 그 계정을 가리키고 있으면(예: message_templates.updated_by) 삭제하려면
//    그 참조를 다른 계정으로 갈아끼워야 하는데, 그건 감사 흔적을 고쳐 쓰는 일이다.
const REFS = [
  ['customers', 'created_by'], ['customers', 'assigned_employee_id'],
  ['inspections', 'created_by'], ['inspections', 'assigned_employee_id'],
  ['inspection_plan_items', 'assigned_employee_id'], ['inspection_plans', 'created_by'],
  ['message_templates', 'updated_by'],
]
let acctDel = 0, acctOff = 0
for (const p of testAccounts) {
  if (p.created_at >= cutoff) { console.log(`   ⏭ ${p.email} — ${HOURS}시간 이내 생성(실행 중일 수 있다)`); continue }
  let refs = 0
  const where = []
  for (const [t, col] of REFS) {
    // select('*')여야 한다 — 'id'로 세면 **id 컬럼이 없는 표**(message_templates는 PK가 key다)에서
    // 오류가 나고, 그 오류를 무시하면 참조가 0인 줄 알고 지우려 든다. 실제로 그렇게 동작했다(2026-08-21).
    const { count, error } = await raw.from(t).select('*', { count: 'exact', head: true }).eq(col, p.id)
    if (error) {
      // 참조를 셀 수 없으면 **없는 것으로 치지 않는다** — 모르면 남긴다
      refs++
      where.push(`${t}.${col}=조회실패(${error.message || error.code || '원인불명'})`)
      continue
    }
    if (count) { refs += count; where.push(`${t}.${col}=${count}`) }
  }
  if (refs === 0) {
    await delUser(p.id)
    const { data } = await raw.from('profiles').select('id').eq('id', p.id)
    if (data?.length) console.log(`   ❌ ${p.email} — profiles에 남음`)
    else { acctDel++; console.log(`   ✅ ${p.email} 삭제`) }
  } else if (p.is_active) {
    await raw.from('profiles').update({ is_active: false }).eq('id', p.id)
    acctOff++
    console.log(`   ⏸ ${p.email} 비활성화(참조 ${where.join(' ')} — 삭제하려면 실데이터를 고쳐야 한다)`)
  } else {
    console.log(`   · ${p.email} 이미 비활성(참조 ${where.join(' ')})`)
  }
}

console.log(`\n고객 ${custOk}/${fixtures.length} 삭제 · 계정 ${acctDel} 삭제 · ${acctOff} 비활성화`)
