// 158 단건 운영 적용 (2026-09-05 사용자 승인)
// 실행: node scripts/_apply-158-prod.mjs  (토큰: %TEMP%/sbtok.txt)
import { readFileSync } from 'fs'
import { join } from 'path'

const PROD_REF = 'ryuozdhnilfjlahorizh'
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const sql = readFileSync('supabase/migrations/158_notification_manager_edu.sql', 'utf8')

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

const applied = await q(sql)
console.log('apply status:', applied.status, JSON.stringify(applied.body).slice(0, 300))

const chk = await q(
  "SELECT " +
  "(SELECT pg_get_constraintdef(oid) LIKE '%manager_edu_due%' FROM pg_constraint WHERE conname = 'notifications_type_check') AS has_due, " +
  "(SELECT pg_get_constraintdef(oid) LIKE '%manager_edu_overdue%' FROM pg_constraint WHERE conname = 'notifications_type_check') AS has_overdue, " +
  "(SELECT array_length(string_to_array(pg_get_constraintdef(oid), '::text'), 1) - 1 FROM pg_constraint WHERE conname = 'notifications_type_check') AS type_count")
console.log('verify status:', chk.status, JSON.stringify(chk.body))
