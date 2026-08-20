// 읽기 전용: 마이그레이션 144~147이 스테이징에 적용됐는지 확인한다.
// 실행: node scripts/_probe-144-147-staging.mjs
// 판정은 ASCII 술어로만 — 한글이 든 질의는 조용히 0건을 준다(feedback_no_powershell_text_edit).
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

const probe = async (label, path) => {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const ok = r.status >= 200 && r.status < 300
  const body = ok ? '' : ' ' + (await r.text()).slice(0, 160)
  console.log(`${ok ? 'APPLIED    ' : 'NOT APPLIED'} ${label} — ${r.status}${body}`)
}

console.log('target:', url)
await probe('145 customers.manager_contact_id', 'customers?select=manager_contact_id&limit=1')
await probe('146 profiles.phone,birth_date', 'profiles?select=phone,birth_date&limit=1')
await probe('147 company_profile.official_*', 'company_profile?select=official_sender_name,official_rep_title&limit=1')
await probe('144 message_templates.attachment_name', 'message_templates?select=key,attachment_name&key=eq.owner_report')
