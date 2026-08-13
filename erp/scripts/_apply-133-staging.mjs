// 마이그레이션 133(편입 항목명 축자 정정) 스테이징 적용 — _apply-129-staging 관례
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try { token = readFileSync(tokPath, 'utf8').trim() } catch {
  console.error(`토큰이 없습니다: ${tokPath}`)
  process.exit(1)
}

const sql = readFileSync('supabase/migrations/133_annex4_item_name_verbatim.sql', 'utf8')
const STAGING = 'nwflnzugwylhpdyodyog'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const applied = await q(sql)
console.log('적용 status:', applied.status, JSON.stringify(applied.body))

const chk = await q(`
  SELECT item_code, item_name FROM inspection_sheet_items
   WHERE item_code IN ('2-H-021','3-K-031','13-G-031') ORDER BY item_code`)
console.log('검증:', JSON.stringify(chk.body, null, 1))
