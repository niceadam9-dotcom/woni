// 읽기 전용 — 152 적용 후 가드 영향 재측정 (소방계획서_32 S10-2 후속)
// 왜 이 프로브가 필요한가: 판정 스크립트 T3는 SQL에서 뽑은 축 이름을 그대로
// `NOT EXISTS (SELECT 1 FROM <축> WHERE customer_id=c.id)` 로 펼친다. 그런데 152의
// facility_ledger 축은 `FROM buildings WHERE customer_id=… AND (EXISTS 설비 OR EXISTS 층별)`
// 이라 **술어가 다르다**. T3는 그 EXISTS를 떨어뜨려 '건물이 하나라도 있으면 차단'으로
// 계산하고, 건물은 고객 등록 시 자동 생성되므로 삭제 가능 인원이 붕괴한다(92 → 8).
// 여기서는 두 계산을 나란히 내서 어느 쪽이 RPC의 실제 동작인지 확정한다.
// 실행: cd F:\AI\ERP\erp; node scripts/_probe-152-blast.mjs
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const STAGING = 'nwflnzugwylhpdyodyog'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.json()
  if (r.status >= 300) throw new Error(`${r.status} ${JSON.stringify(body).slice(0, 300)}`)
  return body
}

const PLAIN = [
  'inspections', 'bills', 'quotes', 'orders', 'inquiries', 'fire_plans', 'fire_plan_forms',
  'fire_plan_gen_jobs', 'fire_plan_revisions', 'fire_brigade_members', 'customer_facility_specs',
  'plan_text_applied', 'billing_profiles', 'billing_autopay', 'report_deliveries',
  'sms_send_log', 'mobile_documents', 'account_access_log',
]
const notEx = (t) => `NOT EXISTS (SELECT 1 FROM ${t} x WHERE x.customer_id=c.id)`
const PLAN_ITEMS = `NOT EXISTS (SELECT 1 FROM inspection_plan_items x WHERE x.customer_id=c.id AND (x.status='completed' OR x.inspection_id IS NOT NULL))`
// 152가 실제로 쓰는 술어 — 설비/층별 값을 가진 건물만 차단축이다
const LEDGER_REAL = `NOT EXISTS (SELECT 1 FROM buildings b WHERE b.customer_id=c.id AND (EXISTS (SELECT 1 FROM fire_facilities ff WHERE ff.building_id=b.id) OR EXISTS (SELECT 1 FROM fire_facility_floors fl WHERE fl.building_id=b.id)))`
// 판정 스크립트 T3가 잘못 펼친 술어 — 건물이 하나라도 있으면 차단
const LEDGER_NAIVE = `NOT EXISTS (SELECT 1 FROM buildings x WHERE x.customer_id=c.id)`

const base = [...PLAIN.map(notEx), PLAN_ITEMS].join(' AND ')

const rows = await q(`SELECT
  (SELECT count(*) FROM customers)                                        AS total,
  (SELECT count(*) FROM customers c WHERE ${base} AND ${LEDGER_REAL})     AS deletable_real,
  (SELECT count(*) FROM customers c WHERE ${base} AND ${LEDGER_NAIVE})    AS deletable_naive,
  (SELECT count(*) FROM customers c WHERE ${base})                        AS deletable_no_ledger`)
const r = rows[0]
console.log(`고객 총원        : ${r.total}`)
console.log(`삭제 가능(152 실제 술어, EXISTS 설비/층별) : ${r.deletable_real}  (${(r.deletable_real / r.total * 100).toFixed(1)}%)`)
console.log(`삭제 가능(판정 T3의 순진한 buildings 축)    : ${r.deletable_naive}`)
console.log(`삭제 가능(설비대장 축을 아예 뺀 경우)        : ${r.deletable_no_ledger}`)
console.log(`→ 설비대장 축이 실제로 더 막는 인원          : ${r.deletable_no_ledger - r.deletable_real}명`)
