// 마이그레이션 156(무조건 hard delete 함수) 스테이징 적용 (2026-09-03 사용자 결정)
// 실행: node scripts/_apply-156-staging.mjs   (토큰: %TEMP%/sbtok.txt 관례)
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const sql = readFileSync('supabase/migrations/156_unconditional_hard_delete.sql', 'utf8')
const STAGING = 'nwflnzugwylhpdyodyog'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

const applied = await q(sql)
console.log('apply status:', applied.status, JSON.stringify(applied.body).slice(0, 300))

// 검증은 ASCII 술어로만 — 함수 존재·security definer·권한 + 본문이 156 판(차단 없음)인지
const chk = await q(
  "SELECT p.proname, p.prosecdef, " +
  "position('has_history' in p.prosrc) > 0 AS still_blocks, " +
  "position('DELETE FROM inspection_reports' in p.prosrc) > 0 AS has_restrict_chain, " +
  "position('DELETE FROM mobile_documents' in p.prosrc) > 0 AS has_mobile_docs, " +
  "(SELECT string_agg(privilege_type, ',') FROM information_schema.routine_privileges rp " +
  " WHERE rp.routine_name = 'hard_delete_customer' AND rp.grantee = 'service_role') AS svc_priv, " +
  "(SELECT count(*) FROM information_schema.routine_privileges rp " +
  " WHERE rp.routine_name = 'hard_delete_customer' AND rp.grantee IN ('anon','authenticated')) AS bad_grants " +
  "FROM pg_proc p WHERE p.proname = 'hard_delete_customer'")
console.log('verify status:', chk.status, JSON.stringify(chk.body))
