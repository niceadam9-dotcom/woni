// 세션 정리 확인 — 판정 픽스처 잔여 0건인지 ASCII 술어로만 실측 (한글 술어는 조용히 0건을 준다)
// 실행: cd F:\AI\ERP\erp; node scripts/_probe-s32-fixtures.mjs
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
  const b = await r.json()
  if (r.status >= 300) throw new Error(`${r.status} ${JSON.stringify(b).slice(0, 300)}`)
  return b
}

const rows = await q(`SELECT
  (SELECT count(*) FROM customers)                                              AS customers_total,
  (SELECT count(*) FROM customers WHERE customer_code LIKE 'TEST-E2E-%')        AS fixture_customers,
  (SELECT count(*) FROM auth.users WHERE email LIKE '%@erp-test.com')           AS fixture_users,
  (SELECT count(*) FROM auth.users WHERE email LIKE 's30-judge%')               AS judge_users,
  (SELECT count(*) FROM auth.users WHERE email LIKE 's32-purge%')               AS purge_users,
  (SELECT count(*) FROM auth.users WHERE email LIKE 'plan-access-e2e%')         AS planaccess_users`)
console.log(JSON.stringify(rows[0], null, 2))

// 스토리지 진단 접두사 잔여
const st = await q(`SELECT count(*) AS diag_objects FROM storage.objects
  WHERE bucket_id='fire-plans' AND name LIKE 's32diag-%'`)
console.log('storage s32diag- 잔여:', st[0].diag_objects)
