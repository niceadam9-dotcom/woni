// Management API로 SQL 파일 실행: node scripts/_apply-sql.mjs <sql파일> (토큰: %TEMP%/sbtok.txt)
import { readFileSync } from 'fs'
import { join } from 'path'
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const sql = readFileSync(process.argv[2], 'utf8')
const r = await fetch('https://api.supabase.com/v1/projects/ryuozdhnilfjlahorizh/database/query', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})
console.log(r.status, (await r.text()).slice(0, 500))
