// 스테이징 프로젝트에 마이그레이션 일괄 적용
// 실행: node scripts/_apply-migrations-staging.mjs [시작번호]  (토큰: %TEMP%/sbtok.txt)
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const STAGING_REF = 'nwflnzugwylhpdyodyog'
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

const startFrom = process.argv[2] ? parseInt(process.argv[2], 10) : 0
const files = readdirSync(dir)
  .filter(f => /^\d{3}_.*\.sql$/.test(f))
  .sort((a, b) => parseInt(a) - parseInt(b))
  .filter(f => parseInt(f) >= startFrom)

let ok = 0, fail = 0
for (const f of files) {
  const sql = readFileSync(join(dir, f), 'utf8')
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (r.ok) { ok++; console.log('OK  ', f) }
  else {
    fail++
    const body = (await r.text()).slice(0, 300)
    console.log('FAIL', f, r.status, body)
  }
}
console.log(`\n적용 ${ok} / 실패 ${fail}`)
