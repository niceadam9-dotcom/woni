// 마이그레이션 140·141 스테이징 적용 — 소방계획서_24 S1
// 실행: node scripts/_apply-140-141-staging.mjs   (토큰: %TEMP%/sbtok.txt, _apply-129-staging 관례)
//
// 140: sms_send_log(1행=1수신자) + customer_contacts.sms_recipient
// 141: message_templates 'inspection_sms' 시드 + company_profile.sms_lead_rules
//
// ⚠ 적용 전에는 발송 액션이 전부 실패한다(테이블·컬럼 부재로 PostgREST가 거부).
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try {
  token = readFileSync(tokPath, 'utf8').trim()
} catch {
  console.error(`토큰이 없습니다: ${tokPath}`)
  console.error('Supabase 개인 액세스 토큰(https://supabase.com/dashboard/account/tokens)을 그 파일에 저장한 뒤 다시 실행하세요.')
  process.exit(1)
}

const STAGING = 'nwflnzugwylhpdyodyog'
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

for (const f of ['140_sms_send_log.sql', '141_sms_settings.sql']) {
  const res = await q(readFileSync(`supabase/migrations/${f}`, 'utf8'))
  console.log(`${f} → status ${res.status}`, res.status === 201 ? '' : JSON.stringify(res.body))
  if (res.status !== 201) process.exit(1)
}

// 검증 — 있어야 할 것이 실제로 생겼는지 각각 확인한다(적용 성공 응답만 믿지 않는다)
const chk = await q(`
  SELECT
    (SELECT count(*) FROM information_schema.tables  WHERE table_name='sms_send_log')                                    AS t_log,
    (SELECT count(*) FROM information_schema.columns WHERE table_name='customer_contacts' AND column_name='sms_recipient') AS c_recipient,
    (SELECT count(*) FROM information_schema.columns WHERE table_name='company_profile'   AND column_name='sms_lead_rules') AS c_rules,
    (SELECT count(*) FROM message_templates WHERE key='inspection_sms')                                                  AS seed_sms,
    (SELECT count(*) FROM pg_indexes WHERE tablename='sms_send_log')                                                     AS idx_cnt,
    (SELECT sms_lead_rules::text FROM company_profile LIMIT 1)                                                           AS rules_val`)
console.log('검증:', JSON.stringify(chk.body))
