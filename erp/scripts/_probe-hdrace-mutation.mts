/** 변이 검사 — test-hard-delete-race.mts의 C(고아 0건)가 **진짜 가드인지** 가른다. 일회성.
 *
 *  왜: 초록은 두 가지를 뜻할 수 있다. ①보호가 실제로 작동한다 ②보호가 없어도 어차피 초록이다.
 *  둘을 가르는 유일한 방법은 보호를 떼고도 초록인지 보는 것이다. 156 함수에서
 *  advisory lock과 `FOR UPDATE`만 뺀 쌍둥이를 만들어 같은 시나리오를 돌린다.
 *
 *  기대: 쌍둥이에서는 고아 또는 오류가 나야 한다. **쌍둥이도 깨끗하면** C의 초록은
 *  FOR UPDATE 덕분이 아니라 FK 제약만으로도 나오는 것이고, 그 경우 검사 설명을 고쳐야 한다.
 *
 *  ⚠ 스테이징에 임시 함수를 만들고 **반드시 지운다**(finally). 실제 함수는 건드리지 않는다.
 *  실행: cd F:\AI\ERP\erp; npx tsx scripts/_probe-hdrace-mutation.mts */
import { readFileSync } from 'fs'
import { join } from 'path'
// @ts-expect-error mjs 헬퍼
import { raw, mkCustomer, mkUser, delUser } from './_e2e-helpers.mjs'

const PROJECT = 'nwflnzugwylhpdyodyog'
const token = readFileSync(join(process.env.TEMP as string, 'sbtok.txt'), 'utf8').trim()
const sql = async (query: string) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.json()
  if (r.status >= 300) throw new Error(`SQL ${r.status}: ${JSON.stringify(body).slice(0, 400)}`)
  return body
}

const MUT = 'hard_delete_customer__mut'
const MARK = 'hdmut'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const created: string[] = []
let userId = ''

try {
  const rows = await sql(`select pg_get_functiondef(p.oid) as def from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='hard_delete_customer'`)
  let def = rows[0].def as string

  // 보호 2개만 제거 — 나머지 본문은 글자 그대로 둔다
  const before = def
  def = def.replace(/\s*PERFORM pg_advisory_xact_lock\([^;]*\);/i, '')
  def = def.replace(/FROM customers WHERE id = p_customer_id FOR UPDATE;/i, 'FROM customers WHERE id = p_customer_id;')
  const removedLock = !def.includes('pg_advisory_xact_lock')
  const removedFU = !/customers WHERE id = p_customer_id FOR UPDATE/i.test(def)
  console.log(`변이: advisory 제거=${removedLock} · FOR UPDATE 제거=${removedFU} · 길이 ${before.length}→${def.length}`)
  if (!removedLock || !removedFU) throw new Error('변이 실패 — 원문 패턴이 안 맞는다(함수가 바뀌었을 수 있다)')

  def = def.replace(/FUNCTION public\.hard_delete_customer\(/i, `FUNCTION public.${MUT}(`)
  await sql(def)
  await sql(`GRANT EXECUTE ON FUNCTION public.${MUT}(uuid) TO service_role;`)

  userId = await mkUser({ email: `${MARK}@erp-test.com`, name: '변이검사', employeeId: 'HD-MU' })

  const delays = [0, 1, 2, 3, 5, 8, 12, 20, 35, 60]
  let orphans = 0, rejected = 0, swept = 0, errs = 0
  const detail: string[] = []
  for (const d of delays) {
    const cust = await mkCustomer({ customer_name: `${MARK}-${d}`, address: `ZZ ${MARK} ${d}`, created_by: userId })
    created.push(cust)
    const rpcP = raw.rpc(MUT, { p_customer_id: cust })
    const insP = sleep(d).then(() => raw.from('fire_brigade_members')
      .insert({ customer_id: cust, team: MARK, name: `${MARK}-x` }))
    const [rpcR, insR] = await Promise.all([rpcP, insP])

    const { count: alive } = await raw.from('customers').select('*', { count: 'exact', head: true }).eq('id', cust)
    const { count: mem } = await raw.from('fire_brigade_members').select('*', { count: 'exact', head: true }).eq('customer_id', cust)
    if (rpcR.error) { errs++; detail.push(`d=${d} RPC오류 ${rpcR.error.message.slice(0, 80)}`) }
    else if ((alive ?? 0) === 0 && (mem ?? 0) > 0) { orphans++; detail.push(`d=${d} 고아 ${mem}행`) }
    else if (insR.error) rejected++
    else swept++
  }
  console.log(`\n쌍둥이(보호 없음) ${delays.length}회: 고아=${orphans} · 삽입거절=${rejected} · 함께삭제=${swept} · RPC오류=${errs}`)
  if (detail.length) console.log(`상세: ${detail.join(' | ')}`)
  console.log(orphans + errs > 0
    ? `\n[C 축] ✅ 변이가 잡힌다 — 보호를 떼니 고아/오류 ${orphans + errs}건.`
    : `\n[C 축] ⚠ 변이가 안 잡힌다 — 보호 없이도 깨끗했다. C의 초록은 FOR UPDATE가 아니라 FK 제약이 만들어낸 것이다.`)

  // ── A 축 변이 — 어느 보호가 일꾼인가. 둘을 **따로** 떼어 본다 ──────────────────
  //   32.json T4가 물은 것이 정확히 "FOR UPDATE **또는** advisory lock"이라, 둘을 한꺼번에
  //   떼면 답이 안 나온다. 셋을 나란히 돌려 각각의 필요성을 가른다.
  const orig = rows[0].def as string
  const variants: Array<{ key: string; make: (d: string) => string }> = [
    { key: '둘 다 제거', make: d => d.replace(/\s*PERFORM pg_advisory_xact_lock\([^;]*\);/i, '')
        .replace(/FROM customers WHERE id = p_customer_id FOR UPDATE;/i, 'FROM customers WHERE id = p_customer_id;') },
    { key: 'advisory만 제거', make: d => d.replace(/\s*PERFORM pg_advisory_xact_lock\([^;]*\);/i, '') },
    { key: 'FOR UPDATE만 제거', make: d => d.replace(/FROM customers WHERE id = p_customer_id FOR UPDATE;/i, 'FROM customers WHERE id = p_customer_id;') },
  ]
  console.log('')
  for (const v of variants) {
    await sql(v.make(orig).replace(/FUNCTION public\.hard_delete_customer\(/i, `FUNCTION public.${MUT}(`))
    await sql(`GRANT EXECUTE ON FUNCTION public.${MUT}(uuid) TO service_role;`)
    let bad = 0
    for (let i = 0; i < 5; i++) {
      const cust = await mkCustomer({ customer_name: `${MARK}-${v.key}-${i}`, address: `ZZ ${MARK} a${i}`, created_by: userId })
      created.push(cust)
      const [r1, r2] = await Promise.all([
        raw.rpc(MUT, { p_customer_id: cust }), raw.rpc(MUT, { p_customer_id: cust }),
      ])
      if ([r1, r2].filter(r => (r.data as { ok?: boolean } | null)?.ok === true).length !== 1) bad++
    }
    console.log(`[A 축] ${v.key.padEnd(16)} → '정확히 1건 성공' 위반 ${bad}/5  ${bad > 0 ? '✅ 이 보호가 일꾼' : '⚠ 없어도 통과'}`)
  }
} catch (e) {
  console.error('실패:', (e as Error).message)
} finally {
  for (const id of created) {
    await raw.from('fire_brigade_members').delete().eq('customer_id', id)
    await raw.from('customer_contacts').delete().eq('customer_id', id)
    await raw.from('buildings').delete().eq('customer_id', id)
    await raw.from('inspection_plan_items').delete().eq('customer_id', id)
    await raw.from('activity_logs').delete().eq('entity_id', id)
    await raw.from('customers').delete().eq('id', id)
  }
  if (userId) await delUser(userId)
  try { await sql(`DROP FUNCTION IF EXISTS public.${MUT}(uuid);`); console.log('임시 함수 제거 완료') }
  catch (e) { console.error(`🚨 임시 함수 제거 실패 — 수동으로 지울 것: DROP FUNCTION public.${MUT}(uuid);`, (e as Error).message) }
}
