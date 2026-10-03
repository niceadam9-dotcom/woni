// 읽기 전용 — C5 2차 치환 원천값(두 DB company_profile) 실측
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
const envOf = f => Object.fromEntries(readFileSync(f, 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
for (const [name, f] of [['staging', '.env.local'], ['prod', '.env.production']]) {
  const e = envOf(f)
  const db = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data, error } = await db.from('company_profile').select('company_name, official_sender_name, official_rep_title, representative, business_number, phone, fax, address, management_reg_no')
  console.log(`== ${name} ${e.NEXT_PUBLIC_SUPABASE_URL.slice(8, 20)} rows=${data?.length} err=${error?.message ?? '-'}`)
  for (const r of data ?? []) for (const [k, v] of Object.entries(r)) console.log(`  ${k}: ${JSON.stringify(v)}`)
}
