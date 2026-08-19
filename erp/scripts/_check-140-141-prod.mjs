// 운영 DB의 140·141 적용 상태 확인 (읽기 전용)
// 실행: node scripts/_check-140-141-prod.mjs
import { readFileSync } from 'fs'

const tok = readFileSync(`${process.env.TEMP}\\sbtok.txt`, 'utf8').trim()
const PROD = 'ryuozdhnilfjlahorizh'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

const res = await q(`
  SELECT
    (SELECT count(*) FROM information_schema.tables  WHERE table_name='sms_send_log')                                     AS t_log,
    (SELECT count(*) FROM information_schema.columns WHERE table_name='customer_contacts' AND column_name='sms_recipient') AS c_recipient,
    (SELECT count(*) FROM information_schema.columns WHERE table_name='company_profile'   AND column_name='sms_lead_rules') AS c_rules,
    (SELECT count(*) FROM message_templates WHERE key='inspection_sms')                                                   AS seed_sms,
    (SELECT count(*) FROM pg_indexes WHERE tablename='sms_send_log')                                                      AS idx_cnt,
    (SELECT count(*) FROM company_profile)                                                                                AS company_rows`)

console.log(`운영(${PROD}) 상태 — status ${res.status}`)
console.log(JSON.stringify(res.body, null, 2))

const r = Array.isArray(res.body) ? res.body[0] : null
if (r) {
  const need = []
  if (!r.t_log) need.push('140: sms_send_log 테이블')
  if (!r.c_recipient) need.push('140: customer_contacts.sms_recipient')
  if (!r.c_rules) need.push('141: company_profile.sms_lead_rules')
  if (!r.seed_sms) need.push('141: inspection_sms 문구 시드')
  console.log(need.length ? `\n적용 필요: ${need.join(' · ')}` : '\n✅ 140·141 이미 전부 적용됨')
  if (r.company_rows > 1) console.log(`⚠ company_profile ${r.company_rows}행 — 코드는 id 오름차순 첫 행을 본다`)
}
