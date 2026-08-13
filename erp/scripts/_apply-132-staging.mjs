// 132를 스테이징에 적용 — Management API (%TEMP%/sbtok.txt)
// 실행: node scripts/_apply-132-staging.mjs        (미리보기)
//       node scripts/_apply-132-staging.mjs --run  (적용)
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const STAGING = 'nwflnzugwylhpdyodyog'
const sql = readFileSync('supabase/migrations/132_annex4_missing_items.sql', 'utf8')

const run = async (label, q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const t = await r.text()
  console.log(`${label}: HTTP ${r.status}`)
  if (!r.ok) { console.log(t.slice(0, 600)); process.exit(1) }
  return JSON.parse(t)
}

console.log(`대상: ${STAGING} (스테이징) · SQL ${sql.length}바이트`)

const before = await run('적용 전 상태', `
  select
    (select count(*) from inspection_sheet_items
       where item_code in ('2-H-018','2-H-019','2-H-021','2-H-031','3-K-022','3-K-023','3-K-031','3-K-041','3-L-001','3-L-002','13-G-031','13-G-041')) as 대상12건,
    (select count(*) from inspection_sheet_items) as 전체항목,
    (select check_clause from information_schema.check_constraints
       where constraint_name='inspection_pump_tests_sheet_no_check') as 펌프_check`)
console.log(JSON.stringify(before[0], null, 2))

if (!process.argv.includes('--run')) { console.log('\n미리보기 — 적용하려면 --run'); process.exit(0) }

await run('\n132 적용', sql)

const after = await run('적용 후 상태', `
  select
    (select count(*) from inspection_sheet_items
       where item_code in ('2-H-018','2-H-019','2-H-021','2-H-031','3-K-022','3-K-023','3-K-031','3-K-041','3-L-001','3-L-002','13-G-031','13-G-041')) as 대상12건,
    (select count(*) from inspection_sheet_items) as 전체항목,
    (select check_clause from information_schema.check_constraints
       where constraint_name='inspection_pump_tests_sheet_no_check') as 펌프_check`)
console.log(JSON.stringify(after[0], null, 2))
