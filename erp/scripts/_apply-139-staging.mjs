// 마이그레이션 139 스테이징 적용 — _apply-138-staging 관례 (소방계획서_25 S-1)
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const STAGING = 'nwflnzugwylhpdyodyog'
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const sql = readFileSync('supabase/migrations/139_holidays_source.sql', 'utf8')
const r = await q(sql)
const ok = r.status >= 200 && r.status < 300
console.log(`${ok ? 'OK  ' : 'FAIL'} 139_holidays_source.sql — status ${r.status}${ok ? '' : ' ' + JSON.stringify(r.body)}`)
if (!ok) process.exit(1)

const chk = await q(`
  SELECT
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='holidays' AND column_name='source') AS col,
    (SELECT COUNT(*) FROM information_schema.check_constraints WHERE constraint_name='holidays_source_check') AS chk,
    (SELECT COUNT(*) FROM pg_trigger WHERE tgname='trg_protect_manual_holidays') AS trg,
    (SELECT COUNT(*) FROM holidays WHERE source='library') AS lib,
    (SELECT COUNT(*) FROM holidays WHERE source='manual') AS man,
    (SELECT COUNT(*) FROM holidays WHERE source='api') AS api,
    (SELECT COUNT(*) FROM holidays) AS total`)
console.log('검증:', JSON.stringify(chk.body))
