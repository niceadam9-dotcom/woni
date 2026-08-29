// 읽기 전용 — 스테이징 DB의 hard_delete_customer 실체를 확인한다 (소방계획서_32 S10-1 사전 실측)
// 실행: cd F:\AI\ERP\erp; node scripts/_probe-152-live.mjs
// 왜: 32.json은 '152 재적용 미실행 → DB는 옛 13축'이라 적었으나 그것은 가설이다. 실측으로 확정한다.
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const PROJECTS = { staging: 'nwflnzugwylhpdyodyog' }

const q = async (project, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

// ASCII 술어로만 — 한글 리터럴은 이 API에서 조용히 빗나간다
const SQL = `
SELECT p.proname,
       p.prosecdef,
       length(p.prosrc) AS src_len,
       (SELECT count(*) FROM regexp_matches(p.prosrc, 'FROM\\s+\\w+\\s+WHERE customer_id', 'g')) AS axis_count,
       (p.prosrc LIKE '%facility_ledger%')            AS has_ledger,
       (p.prosrc LIKE '%pg_advisory_xact_lock%')      AS has_advisory_lock,
       (p.prosrc LIKE '%FOR UPDATE%')                 AS has_for_update,
       (p.prosrc LIKE '%billing_autopay%')            AS has_billing_autopay,
       (p.prosrc LIKE '%fire_brigade_members%')       AS has_brigade,
       (p.prosrc LIKE '%plan_text_applied%')          AS has_plan_text
FROM pg_proc p WHERE p.proname = 'hard_delete_customer'`

const r = await q(PROJECTS.staging, SQL)
console.log('status:', r.status)
console.log(JSON.stringify(r.body, null, 2))
