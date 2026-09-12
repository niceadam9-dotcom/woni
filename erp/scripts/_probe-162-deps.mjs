// 162 차단 원인 실측 — inspection_plan_items.status를 무는 인덱스·제약·정책·트리거 정의 전수
import { readFileSync } from 'fs'
import { join } from 'path'
const REFS = { staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { ok: r.ok, status: r.status, body: await r.text() }
}
const QUERIES = {
  indexes: `SELECT indexname, indexdef FROM pg_indexes
             WHERE tablename = 'inspection_plan_items' AND indexdef ILIKE '%status%'`,
  constraints: `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
                 WHERE conrelid = 'inspection_plan_items'::regclass
                   AND pg_get_constraintdef(oid) ILIKE '%status%'`,
  policies: `SELECT polname, pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS wc
               FROM pg_policy WHERE polrelid = 'inspection_plan_items'::regclass`,
  triggers: `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
              WHERE tgrelid = 'inspection_plan_items'::regclass AND NOT tgisinternal`,
}
for (const [name, ref] of Object.entries(REFS)) {
  console.log(`\n===== ${name} =====`)
  for (const [k, sql] of Object.entries(QUERIES)) {
    const r = await q(ref, sql)
    console.log(`-- ${k}: ${r.ok ? r.body : `ERR ${r.status} ${r.body.slice(0, 200)}`}`)
  }
}
