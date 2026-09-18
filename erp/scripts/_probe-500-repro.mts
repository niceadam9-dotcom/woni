/** 통합 실측이 만난 500(`Cannot read properties of undefined (reading 'map')`) 재현·규명
 *
 *  라우트 대신 **조립기를 직접 호출**해 스택을 본다(preview 검사는 조립기를 안 태운다).
 *  🚨 `process.exit`를 쓰지 않는다 — 그게 앞 프로브의 원상복구를 건너뛰어 실고객을 오염시켰다.
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-500-repro.mts
 */
import { raw } from './_e2e-helpers.mjs'

const { data: cust } = await raw.from('customers').select('id, customer_name').eq('is_active', true).limit(1).single()
const customerId = (cust as { id: string }).id
const { data: row } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
const backup = (row?.sections ?? {}) as Record<string, unknown>
console.log(`대상: ${(cust as { customer_name: string }).customer_name} — 사전 키 ${Object.keys(backup).length}개`)

/** 심는 축을 하나씩 늘려 가며 어느 것이 터뜨리는지 가른다 */
const CASES: Array<[string, Record<string, unknown>]> = [
  ['기준선(안 심음)', {}],
  ['hazards만', { hazards: [{ place: '주방', location: '지하 1층', factors: ['전기적 요인'] }] }],
  ['fireHistory만', { fireHistory: [{ kind: '화재', at: '2026-02-11', place: 'P', cause: 'C', action: 'A' }] }],
  ['training만', {
    training: {
      eduMonths: [3], drillMonths: [9], scenario: 'S',
      details: [{ name: 'N', at: '2026-05-20', place: 'W', target: '자위소방대', kindPractice: '부분', kindTheory: '강의', formType: '합동', materials: 'M', plan: 'P' }],
      records: [{ at: '2026-04-02', kind: '교육', attendees: '25', content: 'E', evaluation: 'V' }],
    },
  }],
]

/* ⚠ 조립기는 서버 컨텍스트(supabase admin)를 요구해 오프라인 호출이 안 된다
 *   (`admin.from is not a function` — 계측기 실패였다). **라우트를 직접 때린다.** */
const { launch, login, mkUser, delUser } = await import('./_e2e-helpers.mjs')
const EMAIL = 'e2e-500-repro@test.local'
let ctx: Awaited<ReturnType<typeof launch>> | null = null
let userId: string | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '오백규명E2E', employeeId: 'E2E-500' })
  ctx = await launch()
  await login(ctx.page, EMAIL)
  for (const [name, patch] of CASES) {
    await raw.from('fire_plan_forms').update({ sections: { ...backup, ...patch } }).eq('customer_id', customerId)
    const res = await ctx.page.request.get(`http://localhost:3000/customers/${customerId}/fire-plan/xlsx`)
    const body = res.ok() ? '' : (await res.text()).slice(0, 160)
    console.log(`  ${res.ok() ? 'ok  ' : '🚨'} ${name} — HTTP ${res.status()} ${body}`)
  }
} finally {
  if (userId) await delUser(userId)
  await ctx?.browser.close()
  await raw.from('fire_plan_forms').update({ sections: backup }).eq('customer_id', customerId)
  const { data: after } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const same = JSON.stringify(after?.sections ?? {}) === JSON.stringify(backup)
  console.log(`\n원상복구: ${same ? '✅ 사전 상태와 동일' : '🚨 다르다 — 손으로 확인하라'}`)
}
