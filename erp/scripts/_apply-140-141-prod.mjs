// 마이그레이션 140·141 운영 적용 — 사전 안내 SMS 스키마 (소방계획서_24 S1)
// 실행: node scripts/_apply-140-141-prod.mjs --run   (토큰: %TEMP%/sbtok.txt)
//
// 왜 필요한가: 운영은 138까지만 적용돼 있어 SMS 기능의 테이블·컬럼이 통째로 없다.
//   sms_send_log / customer_contacts.sms_recipient / company_profile.sms_lead_rules
// 이게 없으면 대표 기본수신 백필도, 발송 자체도 불가능하다(실측 2026-08-19).
//
// 순서: 140(테이블·컬럼) → 141(시드·설정). 141이 message_templates 시드를 넣으므로 뒤.
// 전건 멱등 — 140은 CREATE TABLE IF NOT EXISTS·ADD COLUMN IF NOT EXISTS,
// 141은 ON CONFLICT DO NOTHING·ADD COLUMN IF NOT EXISTS라 재실행이 안전하다.
//
// ⚠ 139(holidays_source)는 건너뛴다 — 소방계획서_25 몫이고 스테이징에도 아직 미적용이다.
//   140·141은 139에 의존하지 않는다(서로 다른 테이블).
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try { token = readFileSync(tokPath, 'utf8').trim() } catch {
  console.error(`토큰이 없습니다: ${tokPath} — scripts/_restore-sbtok.ps1로 복원하세요.`)
  process.exit(1)
}
const APPLY = process.argv.includes('--run')
const PROD = 'ryuozdhnilfjlahorizh'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const STATE = `
  SELECT
    to_regclass('public.sms_send_log') IS NOT NULL AS sms_send_log,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='customer_contacts' AND column_name='sms_recipient') AS sms_recipient,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='company_profile' AND column_name='sms_lead_rules') AS sms_lead_rules,
    (SELECT count(*) FROM message_templates WHERE key='inspection_sms') AS tpl_seed,
    (SELECT count(*) FROM customer_contacts) AS contacts,
    (SELECT count(DISTINCT customer_id) FROM customer_contacts) AS customers
`

const ok2xx = r => r.status >= 200 && r.status < 300
const before = await q(STATE)
if (!ok2xx(before)) { console.error('상태 조회 실패:', before.status, JSON.stringify(before.body)); process.exit(1) }
console.log('적용 전:', JSON.stringify(before.body[0]))

if (!APPLY) {
  console.log('\n미리보기입니다 — 적용하려면 --run')
  process.exitCode = 0
} else {
  for (const f of ['140_sms_send_log.sql', '141_sms_settings.sql']) {
    const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
    const r = await q(sql)
    const ok = r.status >= 200 && r.status < 300
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${f} — status ${r.status}${ok ? '' : ' ' + JSON.stringify(r.body)}`)
    if (!ok) process.exit(1)   // 순서 의존 — 실패 시 즉시 중단
  }

  const after = await q(STATE)
  const s = after.body[0]
  console.log('\n적용 후:', JSON.stringify(s))
  const ok = s.sms_send_log && s.sms_recipient && s.sms_lead_rules && Number(s.tpl_seed) === 1
  console.log(ok ? '✅ 140·141 적용 확인' : '❌ 일부가 반영되지 않았습니다')
  process.exitCode = ok ? 0 : 1
}
