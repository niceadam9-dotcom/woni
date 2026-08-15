// 마이그레이션 138 스테이징 적용 — _apply-134-137-staging 관례 (소방계획서_22 S8)
// 138: 위임장(delegation) 타입 허용 — fire_plan_gen_jobs.report_type·annex_inputs.annex_no CHECK 확장
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try { token = readFileSync(tokPath, 'utf8').trim() } catch {
  console.error(`토큰이 없습니다: ${tokPath}`)
  process.exit(1)
}

const STAGING = 'nwflnzugwylhpdyodyog'
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const sql = readFileSync('supabase/migrations/138_delegation_type.sql', 'utf8')
const r = await q(sql)
const ok = r.status >= 200 && r.status < 300
console.log(`${ok ? 'OK  ' : 'FAIL'} 138_delegation_type.sql — status ${r.status}${ok ? '' : ' ' + JSON.stringify(r.body)}`)
if (!ok) process.exit(1)

// 검증 — 두 CHECK가 delegation을 실제 허용하는지
const chk = await q(`
  SELECT
    (SELECT COUNT(*) FROM information_schema.check_constraints
      WHERE constraint_name='fire_plan_gen_jobs_report_type_check' AND check_clause LIKE '%delegation%') AS jobs_check,
    (SELECT COUNT(*) FROM information_schema.check_constraints
      WHERE constraint_name='annex_inputs_annex_no_check' AND check_clause LIKE '%delegation%') AS inputs_check`)
console.log('검증:', JSON.stringify(chk.body))
