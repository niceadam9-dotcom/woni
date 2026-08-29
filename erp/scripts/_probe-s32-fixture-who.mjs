// 남은 픽스처 1건이 누구 것인지 — 지우기 전에 정체부터 본다(남의 검증을 깨지 않기 위해).
import { readFileSync } from 'fs'
import { join } from 'path'
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/nwflnzugwylhpdyodyog/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return r.json()
}
console.log(JSON.stringify(await q(
  `SELECT customer_code, created_at, is_active FROM customers WHERE customer_code LIKE 'TEST-E2E-%'`), null, 2))
console.log(JSON.stringify(await q(
  `SELECT email, created_at FROM auth.users WHERE email LIKE '%@erp-test.com' ORDER BY created_at DESC`), null, 2))
