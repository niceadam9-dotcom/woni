// 마이그레이션 123(company_profile.management_reg_no) 스테이징 적용 — 2026-08-11 사용자 승인
// 실행: node scripts/_apply-123-staging.mjs  (토큰: %TEMP%/sbtok.txt, _check-migration-state 관례)
import { readFileSync } from 'fs'
import { join } from 'path'
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const sql = readFileSync('supabase/migrations/123_company_management_reg_no.sql', 'utf8')

const STAGING = 'nwflnzugwylhpdyodyog'
const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})
console.log('적용 status:', r.status, JSON.stringify(await r.json()))

const chk = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='company_profile' AND column_name='management_reg_no') AS m123" }),
})
console.log('검증:', JSON.stringify(await chk.json()))
