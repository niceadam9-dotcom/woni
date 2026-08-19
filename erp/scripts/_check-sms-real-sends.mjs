/** 실발송이 일어났는지 사후 확인 — 로컬에 SOLAPI 실키가 들어온 뒤 E2E가 돈을 썼는지 본다.
 *  실행: node scripts/_check-sms-real-sends.mjs
 *  status='sent'는 공급자가 접수했다는 뜻이므로 곧 과금이다. skipped는 allowlist가 막은 것. */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const hours = Number(process.argv[2] ?? 6)
const since = new Date(Date.now() - hours * 3600_000).toISOString()

const { data, error } = await db.from('sms_send_log')
  .select('status, to_phone, created_at, provider_message_id, error')
  .gte('created_at', since).order('created_at', { ascending: false }).limit(1000)
if (error) { console.error(error); process.exit(1) }

const by = {}
for (const r of data ?? []) by[r.status] = (by[r.status] ?? 0) + 1
console.log(`최근 ${hours}시간 sms_send_log ${data?.length ?? 0}행`)
console.log('  상태별 :', JSON.stringify(by))
const billed = (data ?? []).filter(r => r.status === 'sent' || r.status === 'unverified')
console.log(`  과금 가능(sent+unverified) : ${billed.length}건`)
const errs = {}
for (const r of (data ?? []).filter(r => r.status === 'failed')) errs[r.error ?? '(없음)'] = (errs[r.error ?? '(없음)'] ?? 0) + 1
console.log('  실패 사유 :'); for (const [k, v] of Object.entries(errs)) console.log(`    · ${v}건 — ${k}`)
const mask = p => { const d = (p ?? '').replace(/\D/g, ''); return d.length < 7 ? '***' : `${d.slice(0, 3)}-****-${d.slice(-4)}` }
for (const r of billed.slice(0, 20)) console.log(`    · ${r.created_at} ${mask(r.to_phone)} ${r.status}`)
