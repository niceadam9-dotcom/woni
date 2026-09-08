/** 고객 완전 삭제의 **동시성** 축 — 소방계획서_32 T4(DEF-4).
 *
 *  156이 판을 바꿨다. 152는 "이력이 있으면 차단"이었고, 그래서 당시 위험은
 *  '검사 통과 뒤 커밋된 행이 차단을 뚫고 함께 지워지는 것'(유령 삭제)이었다.
 *  **156은 무조건 삭제라 그 결과가 이제는 의도된 동작이다** — 위험의 정의가 바뀌었다.
 *
 *  156에서 금지되는 결과는 하나다: **고아**. 고객 행은 사라졌는데 그 고객을 가리키는
 *  자식 행이 남는 것. 남으면 목록·집계에 유령이 끼고 그 사실이 화면 어디에도 안 드러난다.
 *
 *  보호 장치(156:38,41)와 **각각이 실제로 무엇을 지키는지**(변이 검사 실측, 2026-09-08):
 *    ① `pg_advisory_xact_lock(hashtextextended(id))`
 *    ② `SELECT … FROM customers WHERE id=? FOR UPDATE`
 *
 *  `_probe-hdrace-mutation.mts`로 보호를 떼고 돌린 결과 — **처음 적은 설명이 틀렸다**:
 *    · 고아(C 축): 둘 다 떼도 **고아 0건**. 고아를 막는 것은 우리 잠금이 아니라
 *      **PostgreSQL의 FK 잠금**이다(자식 INSERT는 부모에 FOR KEY SHARE를 잡아야 하고,
 *      부모 DELETE와 상호 배제된다). C의 초록을 "FOR UPDATE 덕분"이라 읽으면 안 된다.
 *    · 직렬화(A 축): 둘 다 떼면 5회 중 4회가 **둘 다 ok=true**를 반환했다. 그러면 감사
 *      로그·모달 고지가 같은 삭제를 두 번, 각각 전체 history 카운트를 달고 기록한다.
 *      한쪽만 떼면 0/5 — **두 보호는 서로 중복이고 어느 하나만 있어도 직렬화된다.**
 *      (32.json T4가 물은 "FOR UPDATE 또는 advisory"의 답이 이것이다: 둘 다 있고 하나면 족하다.)
 *
 *  그래서 이 검사의 실제 값어치는 A에 있다. C는 '고아 없음'이라는 **결과**를 지키지만
 *  그 결과를 만드는 것은 FK 제약이므로, C가 빨개지면 의심할 곳은 잠금이 아니라
 *  삭제 순서·FK 규칙(156 주석의 RESTRICT/CASCADE 표)이다.
 *
 *  이 검사는 관리 API 토큰 없이 PostgREST만 쓴다(그래서 test:all에 등재할 수 있다).
 *  트랜잭션을 밖에서 붙잡아 창을 인위로 넓히는 결정적 재현은 관리 API가 필요해
 *  일회성 프로브(_s8a-race.mts 계열)의 몫으로 남긴다 — **여기서 안 하는 것을 적어 둔다.**
 *
 *  ⚠ 스테이징에 실제 고객을 만들고 지운다. 이름에 MARK가 들어가고 finally에서 정리한다.
 *
 *  실행: npx tsx scripts/test-hard-delete-race.mts */
// @ts-expect-error mjs 헬퍼
import { raw, check, summary, mkCustomer, mkUser, delUser } from './_e2e-helpers.mjs'

const MARK = 'hdrace'
const created: string[] = []
let userId = ''
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** 156 v_hist가 세는 축 중 customer_id를 직접 갖는 표 — 삭제 후 여기 한 행이라도 남으면 고아다 */
const CHILD_TABLES = [
  'inspections', 'inspection_plan_items', 'bills', 'quotes', 'orders', 'inquiries',
  'fire_plans', 'fire_plan_forms', 'fire_plan_gen_jobs', 'fire_plan_revisions',
  'fire_brigade_members', 'customer_facility_specs', 'plan_text_applied', 'buildings',
  'billing_profiles', 'billing_autopay', 'report_deliveries', 'sms_send_log',
  'mobile_documents', 'account_access_log', 'customer_contacts',
]

async function mk(tag: string): Promise<string> {
  const id = await mkCustomer({
    customer_name: `${MARK}-${tag}`, address: `ZZ ${MARK} road ${tag}`, created_by: userId,
  })
  created.push(id)
  return id
}
const countOf = async (table: string, cust: string): Promise<number | null> => {
  const { count, error } = await raw.from(table).select('*', { count: 'exact', head: true }).eq('customer_id', cust)
  if (error) return null   // 컬럼이 없는 표는 축에서 빠진다 — null로 구분해 조용히 0으로 세지 않는다
  return count ?? 0
}
const custAlive = async (cust: string) => (await countOf('customers', cust)) !== null
  ? ((await raw.from('customers').select('*', { count: 'exact', head: true }).eq('id', cust)).count ?? 0)
  : 0
const forget = (cust: string) => { const k = created.indexOf(cust); if (k >= 0) created.splice(k, 1) }

/** 삭제된 고객을 가리키는 자식 행을 전 축에서 센다 */
async function orphanScan(cust: string): Promise<{ table: string; n: number }[]> {
  const hits: { table: string; n: number }[] = []
  for (const t of CHILD_TABLES) {
    const n = await countOf(t, cust)
    if (n !== null && n > 0) hits.push({ table: t, n })
  }
  return hits
}

try {
  userId = await mkUser({ email: `${MARK}@erp-test.com`, name: '삭제레이스', employeeId: 'HD-RC' })

  // ── A. 같은 고객을 둘이 동시에 지운다 — **이 파일에서 유일하게 load-bearing한 축** ──
  //   기대: 정확히 하나만 ok=true, 나머지는 not_found. **둘 다 성공은 실패다** —
  //   ok=true는 history 카운트를 달고 돌아오므로, 둘 다 성공하면 감사 로그에 같은 삭제가
  //   두 번 남고 삭제 규모가 두 배로 보고된다.
  //   변이 검사(2026-09-08): 보호 둘을 **모두** 떼면 4/5로 여기서 잡힌다. 하나만 떼면
  //   안 잡힌다(둘이 중복이라 하나로도 직렬화된다) — 이 검사는 '보호가 전멸했는가'를 본다.
  {
    const cust = await mk('a')
    const [r1, r2] = await Promise.all([
      raw.rpc('hard_delete_customer', { p_customer_id: cust }),
      raw.rpc('hard_delete_customer', { p_customer_id: cust }),
    ])
    const oks = [r1, r2].filter(r => (r.data as { ok?: boolean } | null)?.ok === true).length
    const reasons = [r1, r2].map(r => (r.data as { ok?: boolean; reason?: string } | null)?.reason ?? (r.error ? `err:${r.error.message}` : 'ok'))
    check('A 같은 고객 동시 삭제 — 정확히 1건만 성공한다(advisory 직렬화)',
      oks === 1, `성공 ${oks}건 · 응답=${JSON.stringify(reasons)}`)
    check('A2 나머지 한 건은 not_found로 정직하게 끝난다(오류가 아니라)',
      reasons.filter(x => x === 'not_found').length === 1, JSON.stringify(reasons))
    check('A3 고객 행이 실제로 사라졌다', (await custAlive(cust)) === 0)
    if ((await custAlive(cust)) === 0) forget(cust)
  }

  // ── B. 서로 다른 고객은 서로를 막지 않는다 — 잠금 키가 고객별인가 ─────────────────
  //   (전역 잠금으로 바뀌어도 둘 다 성공하므로 이 검사만으로는 못 잡는다. 그래서
  //    '동시에 성공한다'가 아니라 '둘 다 성공한다'만 주장한다 — 과대 주장 금지.)
  {
    const [c1, c2] = [await mk('b1'), await mk('b2')]
    const [r1, r2] = await Promise.all([
      raw.rpc('hard_delete_customer', { p_customer_id: c1 }),
      raw.rpc('hard_delete_customer', { p_customer_id: c2 }),
    ])
    const both = [r1, r2].every(r => (r.data as { ok?: boolean } | null)?.ok === true)
    check('B 서로 다른 고객 둘을 동시에 지워도 둘 다 성공한다', both,
      JSON.stringify([r1.data, r2.data]).slice(0, 260))
    for (const c of [c1, c2]) if ((await custAlive(c)) === 0) forget(c)
  }

  // ── C. 삭제와 자식 삽입을 겹친다 — **고아가 남는가**가 유일한 판정 기준 ─────────────
  //   허용되는 결과 둘: (i) 삽입이 FK로 거절(23503) (ii) 삽입이 먼저 커밋돼 함께 삭제.
  //   금지되는 결과 하나: 고객은 없는데 자식이 남는다.
  //   ⚠ 이 초록은 **우리 잠금의 공로가 아니다**(파일 머리 변이 검사 참조) — FK 잠금이 만든다.
  //     그래도 유지하는 이유: 삭제 순서나 FK 규칙(ON DELETE)이 바뀌면 여기서 드러난다.
  {
    const delays = [0, 1, 2, 3, 5, 8, 12, 20, 35, 60]
    let orphanCases = 0, rejected = 0, sweptAway = 0, other = 0
    const detail: string[] = []
    for (const d of delays) {
      const cust = await mk(`c${d}`)
      const rpcP = raw.rpc('hard_delete_customer', { p_customer_id: cust })
      const insP = sleep(d).then(() => raw.from('fire_brigade_members')
        .insert({ customer_id: cust, team: MARK, name: `${MARK}-concurrent` }))
      const [rpcR, insR] = await Promise.all([rpcP, insP])

      const alive = await custAlive(cust)
      const hits = await orphanScan(cust)
      const insOk = !insR.error
      if (alive === 0 && hits.length > 0) { orphanCases++; detail.push(`d=${d}ms 고아 ${JSON.stringify(hits)}`) }
      else if (!insOk) rejected++
      else if (insOk && hits.length === 0) sweptAway++
      else { other++; detail.push(`d=${d}ms 기타 alive=${alive} insOk=${insOk} hits=${JSON.stringify(hits)}`) }
      if (alive === 0 && hits.length === 0) forget(cust)
    }
    console.log(`   ${delays.length}회: 고아=${orphanCases} · 삽입거절(FK)=${rejected} · 함께삭제=${sweptAway} · 기타=${other}`)
    if (detail.length) console.log(`   상세: ${detail.join(' | ')}`)
    check('C [핵심] 삭제와 동시 삽입에서 고아 0건', orphanCases === 0,
      `${orphanCases}/${delays.length}회에서 고객 없는 자식 행이 남았다`)
    check('C2 실험이 공허하지 않다 — 삽입이 실제로 한 번은 경합했다',
      rejected + sweptAway > 0,
      `거절 0 · 함께삭제 0 = 삽입이 매번 삭제와 안 겹쳤다는 뜻(창을 못 맞췄다). 판정 불가`)
  }

  // ── D. 정상 삭제 1건의 자식 전 축 고아 스캔 ────────────────────────────────────
  //   경합 없이도 축이 빠져 있으면 고아가 남는다(156 주석의 '축 목록을 actions.ts와 일치').
  {
    const cust = await mk('d')
    await raw.from('fire_brigade_members').insert({ customer_id: cust, team: MARK, name: `${MARK}-d` })
    await raw.from('buildings').insert({ customer_id: cust, building_name: `${MARK}-b`, is_active: true, created_by: userId })
    const r = await raw.rpc('hard_delete_customer', { p_customer_id: cust })
    check('D 삭제 성공', (r.data as { ok?: boolean } | null)?.ok === true, JSON.stringify(r.error ?? r.data).slice(0, 200))
    const hits = await orphanScan(cust)
    check(`D2 자식 ${CHILD_TABLES.length}축 전수 고아 0행`, hits.length === 0, JSON.stringify(hits))
    if ((await custAlive(cust)) === 0 && hits.length === 0) forget(cust)
  }
} catch (e) {
  check('예외 없이 완주', false, String((e as Error)?.stack ?? e))
} finally {
  for (const id of created) {
    for (const t of CHILD_TABLES) await raw.from(t).delete().eq('customer_id', id)
    await raw.from('activity_logs').delete().eq('entity_id', id)
    const { error } = await raw.from('customers').delete().eq('id', id)
    if (error) console.error(`정리 실패 ${id}: ${error.message}`)
  }
  if (userId) await delUser(userId)
  summary()
}
