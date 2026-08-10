// S0 조사 (읽기 전용) — supabase_realtime publication 등록 테이블 확인
// 실행: node scripts/_check-realtime-publication.mjs   (토큰: %TEMP%/sbtok.txt)
// postgres_changes 는 publication 에 등록된 테이블만 이벤트를 낸다.
// 마이그레이션 전체에 ALTER PUBLICATION ... ADD TABLE 문이 없어 실태 확인이 필요.
import { readFileSync } from 'fs'
import { join } from 'path'

const REFS = [
  ['스테이징', 'nwflnzugwylhpdyodyog'],
  ['운영', 'ryuozdhnilfjlahorizh'],
]
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()

const SQL = `
SELECT
  (SELECT count(*) FROM pg_publication WHERE pubname='supabase_realtime') AS pub_exists,
  COALESCE((SELECT string_agg(tablename, ', ' ORDER BY tablename)
            FROM pg_publication_tables
            WHERE pubname='supabase_realtime' AND schemaname='public'), '(없음)') AS tables,
  (SELECT relreplident FROM pg_class WHERE oid='public.inspection_sheet_responses'::regclass) AS replident
`

for (const [label, ref] of REFS) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL }),
  })
  if (!r.ok) { console.log(`\n[${label}] ${ref} — 조회 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`); continue }
  const rows = await r.json()
  const row = Array.isArray(rows) ? rows[0] : rows
  console.log(`\n[${label}] ${ref}`)
  console.log(`  publication 존재: ${row.pub_exists > 0 ? 'YES' : 'NO'}`)
  console.log(`  등록 테이블: ${row.tables}`)
  console.log(`  inspection_sheet_responses REPLICA IDENTITY: ${row.replident}  (d=default(PK만) / f=full)`)
}
