// 마이그레이션 149(sheet_protocol) 스테이징 적용 — 사용자 승인 2026-08-22.
// _apply-132-138-prod 관례(관리 API). SQL 자체가 멱등(ADD COLUMN IF NOT EXISTS + SET DEFAULT).
// 실행: node scripts/_apply-149-staging.mjs --run   (토큰: %TEMP%/sbtok.txt)
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try { token = readFileSync(tokPath, 'utf8').trim() } catch {
  console.error(`토큰이 없습니다: ${tokPath}`)
  process.exit(1)
}
if (!process.argv.includes('--run')) { console.error('적용 스크립트 — 실행하려면 --run 을 붙이세요.'); process.exit(1) }

const STAGING = 'nwflnzugwylhpdyodyog'
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const sql = readFileSync('supabase/migrations/149_sheet_protocol.sql', 'utf8')
const r = await q(sql)
const ok = r.status >= 200 && r.status < 300
console.log(`${ok ? 'OK  ' : 'FAIL'} 149_sheet_protocol.sql — status ${r.status}${ok ? '' : ' ' + JSON.stringify(r.body)}`)
if (!ok) process.exit(1)

// 검증 — 컬럼·CHECK·DEFAULT 실재 + 기존 행은 전부 NULL(백필 금지 규약, ASCII 술어만)
const chk = await q(`
  SELECT
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_name='inspections' AND column_name='sheet_protocol') AS col_exists,
    (SELECT column_default FROM information_schema.columns
      WHERE table_name='inspections' AND column_name='sheet_protocol') AS col_default,
    (SELECT COUNT(*) FROM inspections WHERE sheet_protocol IS NOT NULL) AS non_null_rows,
    (SELECT COUNT(*) FROM inspections) AS total_rows`)
console.log('검증:', JSON.stringify(chk.body))
const row = Array.isArray(chk.body) ? chk.body[0] : chk.body
if (!row || Number(row.col_exists) !== 1) { console.error('검증 실패 — 컬럼 부재'); process.exit(1) }
if (Number(row.non_null_rows) !== 0) {
  console.error(`⚠ 기존 행 ${row.non_null_rows}건이 non-NULL — ADD COLUMN/SET DEFAULT 순서 규약 위반 의심`)
  process.exit(1)
}
console.log(`149 적용 완료 — 기존 ${row.total_rows}행 전부 NULL(규약대로), DEFAULT=${row.col_default}`)
