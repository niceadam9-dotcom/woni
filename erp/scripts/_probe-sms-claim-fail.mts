/** ★ S3 차단급 결함 회귀 방어 — claim(발송 이력) 기록이 실패하면 **발송하지 않는다**
 *  실행: npx tsx --conditions=react-server scripts/_probe-sms-claim-fail.mts   (스테이징 DB)
 *
 *  왜 필요한가(독립 검증 J24-B1):
 *  종전 sms.ts는 sending 행 insert의 error를 버리고 rowIds에 ''를 넣은 뒤 **그대로 Solapi를
 *  호출**했다. 그러면 돈은 나갔는데 이력이 없는 건이 생기고, 화면은 그 건을 '미발송'으로 표시해
 *  다음 발송 때 재발송·이중 과금이 된다. claim을 발송 전에 두는 이유가 그것을 막기 위해서인데
 *  오류를 무시하면 그 장치가 정확히 필요한 순간에만 무력해진다.
 *
 *  검증 방법: admin 클라이언트를 Proxy로 감싸 **sms_send_log insert만 실패**시키고
 *  ① 발송 중단 ② 공급자 미호출 ③ sending 방치 없음 을 본다.
 *  (소방계획서_18의 Storage 실패 주입과 같은 기법)
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
// @ts-expect-error mjs 헬퍼
import { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan } from './_e2e-helpers.mjs'

const { createAdminClient } = await import('../src/lib/supabase/admin.ts')
const { loadSmsTargets, sendInspectionSms } = await import('../src/lib/sms.ts')
const { todayKst, addDays } = await import('../src/lib/sms-recipients.ts')

const SUF = Math.random().toString(36).slice(2, 7)
const VISIT = addDays(todayKst(), 1)

let userId = ''
const custIds: string[] = []
let plan: { id: string; created: boolean } | null = null

try {
  userId = await mkUser({ email: `smsclaim.${SUF}@e2e.test`, name: `클레임${SUF}`, employeeId: `SC-${SUF}`, role: 'admin' })
  plan = await ensurePlan(+VISIT.slice(0, 4), +VISIT.slice(5, 7), userId)

  const cid = await mkCustomer({ customer_name: `클레임${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '강하면' })
  custIds.push(cid)
  // ⚠ 연락처 insert 실패를 삼키면 대상이 noPhone으로 빠져 claim 루프가 아예 안 돌고,
  //   그러면 이 프로브가 '통과'로 보이지만 아무것도 검증하지 못한다 — 반드시 확인한다
  const { error: ctErr } = await raw.from('customer_contacts').insert({
    customer_id: cid, role: '대표', name: '홍길동', phone: '01012345678', sms_recipient: true,
  })
  if (ctErr) throw new Error(`연락처 생성 실패: ${ctErr.message}`)
  const { data: item, error: itemErr } = await raw.from('inspection_plan_items').insert({
    plan_id: plan.id, customer_id: cid, sequence_num: 1, inspection_type: '작동',
    plan_type: 'monthly', scheduled_date: VISIT, status: 'confirmed',
  }).select('id').single()
  if (itemErr) throw new Error(`계획 항목 생성 실패: ${itemErr.message}`)

  const targets = await loadSmsTargets(createAdminClient(), { planItemIds: [(item as { id: string }).id] })
  check('시드 — 발송 대상 1건', targets.length === 1, `${targets.length}건`)

  // ── sms_send_log insert 실패 주입 ──────────────────────────────────
  const base = createAdminClient()
  const failingAdmin = new Proxy(base, {
    get(t, p, r) {
      if (p !== 'from') return Reflect.get(t, p, r)
      return (table: string) => {
        const b = (t as ReturnType<typeof createAdminClient>).from(table)
        if (table !== 'sms_send_log') return b
        // insert만 실패시킨다 — update·select는 살려 둬야 중단 처리(이미 claim한 행 정리)가 돈다
        return new Proxy(b, {
          get(bt, bp, br) {
            if (bp !== 'insert') return Reflect.get(bt, bp, br)
            const err = { message: '주입된 실패(sms_send_log insert)' }
            return () => ({
              select: () => ({ single: async () => ({ data: null, error: err }) }),
              // noPhone 경로는 select 없이 await 된다 — thenable로 같은 오류를 준다
              then: (resolve: (v: unknown) => void) => resolve({ data: null, error: err }),
            })
          },
        })
      }
    },
  }) as ReturnType<typeof createAdminClient>

  // ★ 자격증명을 넣은 상태로 시험한다. 키가 없으면 어차피 ⑤에서 멈춰 '발송 안 함'이 되므로
  //   이 프로브가 중단 로직 덕분인지 키가 없어서인지 구분하지 못한다 — 변별력이 사라진다.
  //   실제 네트워크로 나가지는 않게 solapi 호출은 가짜 응답으로 가로챈다(외부 발송 0).
  process.env.SOLAPI_API_KEY = 'PROBE_DUMMY'
  process.env.SOLAPI_API_SECRET = 'PROBE_DUMMY'
  process.env.SOLAPI_SENDER_PHONE = '0212345678'

  let solapiCalled = false
  const origFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('solapi')) {
      solapiCalled = true
      // 실제로 내보내지 않는다 — 여기에 도달했다는 사실 자체가 결함의 증거다
      return Promise.resolve(new Response(JSON.stringify({ messageList: [] }), { status: 200 }))
    }
    return origFetch(input, init)
  }) as typeof fetch

  const before = ((await raw.from('sms_send_log').select('id').eq('customer_id', cid)).data ?? []).length
  const res = await sendInspectionSms(failingAdmin, { targets, actorId: userId })
  globalThis.fetch = origFetch

  check('① 기록 실패 시 발송 중단(ok:false)', res.ok === false, `ok=${res.ok}`)
  check('② 중단 사유가 재발송·이중 과금 위험을 말한다',
    (res.error ?? '').includes('기록') && (res.error ?? '').includes('중단'), res.error ?? '(사유 없음)')
  // ★ 이 단언이 이 프로브의 핵심 — 종전 코드는 claim 실패를 무시하고 여기까지 갔다
  check('③ 공급자 호출 없음 — 자격증명이 있어도 기록 실패면 돈이 나가지 않는다', solapiCalled === false)
  check('④ sent 0건', res.sent === 0, `sent=${res.sent}`)
  check('⑤ 건별 결과가 failed로 보고됨',
    res.rows.length > 0 && res.rows.every((r: { status: string }) => r.status === 'failed'),
    JSON.stringify(res.rows.map((r: { status: string }) => r.status)))

  const after = ((await raw.from('sms_send_log').select('id, status').eq('customer_id', cid)).data ?? []) as Array<{ status: string }>
  check('⑥ sending으로 방치된 행 없음', after.every(r => r.status !== 'sending'), JSON.stringify(after.map(r => r.status)))
  check('⑦ 주입 실패라 행 자체가 늘지 않음', after.length === before, `${before} → ${after.length}`)

  // ── 대조군 — 중단 로직이 정상 경로까지 과잉 차단하지 않는가 ──
  //   (기록이 정상이면 발송 단계까지 가야 한다. 여기서도 solapi는 가로채므로 외부 발송 0)
  solapiCalled = false
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('solapi')) {
      solapiCalled = true
      return Promise.resolve(new Response(JSON.stringify({ messageList: [] }), { status: 200 }))
    }
    return origFetch(input, init)
  }) as typeof fetch
  await sendInspectionSms(createAdminClient(), { targets, actorId: userId })
  globalThis.fetch = origFetch
  const rows = ((await raw.from('sms_send_log').select('status').eq('customer_id', cid)).data ?? []) as Array<{ status: string }>
  check('⑧ 대조군 — 정상 기록이면 발송 단계까지 진행된다(행 생성 + 공급자 호출)',
    rows.length > 0 && solapiCalled === true, `${rows.length}행 solapi=${solapiCalled}`)
  check('⑨ 대조군 — 결과가 기록돼 sending으로 남지 않는다',
    rows.every(r => r.status !== 'sending'), JSON.stringify(rows.map(r => r.status)))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  for (const cid of custIds) {
    await raw.from('sms_send_log').delete().eq('customer_id', cid)
    await cleanupCustomer(cid)
  }
  if (plan?.created) await raw.from('inspection_plans').delete().eq('id', plan.id)
  if (userId) await delUser(userId)
  summary()
}
