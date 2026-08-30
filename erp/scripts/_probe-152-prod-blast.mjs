/* S8-2 — 운영 DB 가드 영향 재측정 (소방계획서_32). **읽기 전용. 아무것도 바꾸지 않는다.**
 *
 * 왜: 152(조건부 hard delete)를 운영에 적용할지 결정하려면 "켜면 몇 명이 삭제 가능이 되는가"를
 * 먼저 알아야 한다([[feedback_guard_blast_radius]] — 가드를 켠 직후 막히는/뚫리는 건수를 세라).
 * 운영은 2026-08-24에 업무데이터를 전량 삭제해서 마스터만 남아 있을 공산이 크다. 그렇다면
 * **전 고객이 '삭제 가능'으로 판정된다** — 공집합의 반대쪽 극단이고, 그것도 기능 결함이다.
 *
 * ⚠ 축 술어를 152 본문 그대로 옮긴다. 축 '이름'만 옮기면 조용히 다른 것을 센다
 *   (판정 T3가 facility_ledger의 EXISTS를 떨어뜨려 91명을 8명으로 오보한 사례).
 * ⚠ 한글 술어 금지 — 이 API에서 한글은 에러 없이 0건을 준다. ASCII로만.
 *
 * 실행: cd F:\AI\ERP\erp; node scripts/_probe-152-prod-blast.mjs
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const PROD = 'ryuozdhnilfjlahorizh'
const STAGING = 'nwflnzugwylhpdyodyog'

const q = async (project, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.json()
  if (r.status >= 300) throw new Error(`${r.status} ${JSON.stringify(body).slice(0, 400)}`)
  return body
}

const PLAIN = [
  'inspections', 'bills', 'quotes', 'orders', 'inquiries', 'fire_plans', 'fire_plan_forms',
  'fire_plan_gen_jobs', 'fire_plan_revisions', 'fire_brigade_members', 'customer_facility_specs',
  'plan_text_applied', 'billing_profiles', 'billing_autopay', 'report_deliveries',
  'sms_send_log', 'mobile_documents', 'account_access_log',
]

console.log('=== [1] 운영에 152가 적용돼 있는가 (적용 금지 상태 확인) ===')
const fn = await q(PROD, `SELECT count(*) AS n FROM pg_proc WHERE proname = 'hard_delete_customer'`)
console.log(`  hard_delete_customer 함수 존재: ${fn[0].n}건  ${fn[0].n === 0 ? '(미적용 — 예상대로)' : '(⚠적용돼 있다!)'}`)

console.log('\n=== [2] 축 테이블이 운영에 전부 있는가 (없으면 질의가 통째로 실패한다) ===')
const names = [...PLAIN, 'inspection_plan_items', 'buildings', 'fire_facilities', 'fire_facility_floors', 'customer_contacts']
const exist = await q(PROD, `SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (${names.map(n => `'${n}'`).join(',')})`)
const have = new Set(exist.map(r => r.table_name))
const missing = names.filter(n => !have.has(n))
console.log(`  ${have.size}/${names.length} 존재${missing.length ? ` · 없음: ${missing.join(', ')}` : ' — 전부 있음'}`)
if (missing.length) { console.log('  ⚠ 축이 빠져 측정 불가. 중단.'); process.exit(1) }

const notEx = (t) => `NOT EXISTS (SELECT 1 FROM ${t} x WHERE x.customer_id=c.id)`
const PLAN_ITEMS = `NOT EXISTS (SELECT 1 FROM inspection_plan_items x WHERE x.customer_id=c.id AND (x.status='completed' OR x.inspection_id IS NOT NULL))`
const LEDGER = `NOT EXISTS (SELECT 1 FROM buildings b WHERE b.customer_id=c.id AND (EXISTS (SELECT 1 FROM fire_facilities ff WHERE ff.building_id=b.id) OR EXISTS (SELECT 1 FROM fire_facility_floors fl WHERE fl.building_id=b.id)))`
const ALL = [...PLAIN.map(notEx), PLAN_ITEMS, LEDGER].join(' AND ')

console.log('\n=== [3] 운영 가드 영향 — 152를 켜면 몇 명이 [완전 삭제] 가능해지는가 ===')
const br = (await q(PROD, `SELECT
  (SELECT count(*) FROM customers)                                   AS total,
  (SELECT count(*) FROM customers WHERE is_active)                   AS active,
  (SELECT count(*) FROM customers WHERE NOT is_active)               AS inactive,
  (SELECT count(*) FROM customers c WHERE ${ALL})                    AS deletable,
  (SELECT count(*) FROM customers c WHERE is_active AND ${ALL})      AS deletable_active`))[0]
const pct = br.total ? (br.deletable / br.total * 100).toFixed(1) : '0.0'
console.log(`  고객 총원 ${br.total}명 (활성 ${br.active} · 비활성 ${br.inactive})`)
console.log(`  → 삭제 가능 ${br.deletable}명 (${pct}%)   그중 활성 목록에 뜨는 것 ${br.deletable_active}명`)
if (br.total > 0 && br.deletable === br.total) console.log('  ⚠⚠ **전건이 삭제 가능** — 가드가 아무도 막지 못한다')
else if (br.deletable === 0) console.log('  ⚠ 공집합 — 기능이 실재하지 않는다')

console.log('\n=== [4] 축별 보유 고객 수 — 무엇이 막고 있는가(0이면 그 축은 운영에서 무력) ===')
for (const t of PLAIN) {
  const n = (await q(PROD, `SELECT count(DISTINCT x.customer_id) AS n FROM ${t} x WHERE x.customer_id IS NOT NULL`))[0].n
  if (n > 0) console.log(`  · ${t}: ${n}명`)
}
const led = (await q(PROD, `SELECT count(DISTINCT b.customer_id) AS n FROM buildings b
  WHERE EXISTS (SELECT 1 FROM fire_facilities ff WHERE ff.building_id=b.id)
     OR EXISTS (SELECT 1 FROM fire_facility_floors fl WHERE fl.building_id=b.id)`))[0].n
const pi = (await q(PROD, `SELECT count(DISTINCT x.customer_id) AS n FROM inspection_plan_items x
  WHERE x.status='completed' OR x.inspection_id IS NOT NULL`))[0].n
console.log(`  · facility_ledger(설비 대장 보유 건물): ${led}명`)
console.log(`  · plan_items_real(완료·점검연결 계획): ${pi}명`)

console.log('\n=== [5] 대조 — 스테이징 같은 술어 ===')
const st = (await q(STAGING, `SELECT (SELECT count(*) FROM customers) AS total,
  (SELECT count(*) FROM customers c WHERE ${ALL}) AS deletable`))[0]
console.log(`  스테이징 ${st.total}명 중 삭제 가능 ${st.deletable}명 (${(st.deletable / st.total * 100).toFixed(1)}%)`)
