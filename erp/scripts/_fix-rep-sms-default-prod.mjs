// 대표 기본 수신 백필 — **운영** (2026-08-19 사용자 확정)
//
// 스테이징판(_fix-rep-sms-default.mjs)과 같은 규칙을 Management API로 실행한다.
// 운영은 SERVICE_ROLE 키가 로컬에 없어 SQL API를 쓴다(_apply-132-138-prod 관례).
//
// 규칙: 고객 단위로 **아무도 결정하지 않은 경우에만**(전원 sms_recipient IS NULL)
//       역할 '대표'를 true로 켠다. 이미 켜거나 끈 고객은 사람이 정한 상태라 건드리지 않는다.
// 안전: 대표 1명 true = 종전 폴백과 결과가 같다(문자량 불변).
//
// 실행: node scripts/_fix-rep-sms-default-prod.mjs         (미리보기)
//       node scripts/_fix-rep-sms-default-prod.mjs --run   (반영)
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
  const body = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${body.slice(0, 300)}`)
  return JSON.parse(body)
}

// 대상 = 그 고객의 관계인 중 true/false가 하나도 없고(전원 NULL) 역할이 '대표'인 행
const TARGET_SQL = `
  SELECT c.id, c.customer_id, c.name, c.phone
  FROM customer_contacts c
  WHERE c.role = '대표'
    AND NOT EXISTS (
      SELECT 1 FROM customer_contacts x
      WHERE x.customer_id = c.customer_id AND x.sms_recipient IS NOT NULL
    )
`

try {
  const before = await q(`
    SELECT
      (SELECT count(*) FROM customer_contacts) AS contacts,
      (SELECT count(DISTINCT customer_id) FROM customer_contacts) AS customers,
      (SELECT count(*) FROM customer_contacts WHERE sms_recipient IS TRUE) AS checked,
      (SELECT count(*) FROM customer_contacts WHERE sms_recipient IS FALSE) AS unchecked
  `)
  console.log('운영 현황:', JSON.stringify(before[0]))

  const targets = await q(TARGET_SQL)
  console.log(`\n대표 체크 대상 ${targets.length}곳`)
  for (const t of targets.slice(0, 5)) console.log(`  ${t.name ?? '(이름없음)'} ${t.phone ?? '(번호없음)'}`)
  if (targets.length > 5) console.log(`  … 외 ${targets.length - 5}곳`)

  // 회귀 점검 — 대표에게 번호가 없는데 다른 관계인은 번호가 있는 고객이 있으면
  // 백필로 '번호없음' 전락이 생긴다(스테이징은 0곳이었다)
  const risk = await q(`
    SELECT count(*)::int AS n FROM (
      SELECT c.customer_id
      FROM customer_contacts c
      WHERE c.role = '대표'
        AND coalesce(length(regexp_replace(c.phone, '\\D', '', 'g')), 0) < 10
        AND NOT EXISTS (SELECT 1 FROM customer_contacts x
                        WHERE x.customer_id = c.customer_id AND x.sms_recipient IS NOT NULL)
        AND EXISTS (SELECT 1 FROM customer_contacts y
                    WHERE y.customer_id = c.customer_id AND y.role <> '대표'
                      AND coalesce(length(regexp_replace(y.phone, '\\D', '', 'g')), 0) >= 10)
    ) t
  `)
  const riskN = risk[0].n
  console.log(`\n회귀 위험(대표 번호 없음 + 다른 관계인 번호 있음): ${riskN}곳`)
  if (riskN > 0) {
    console.error('⚠ 이 고객들은 백필하면 종전에 직원에게 가던 문자가 번호없음으로 전락한다 — 중단.')
    process.exit(1)
  }

  if (!APPLY) {
    console.log('\n미리보기입니다 — 반영하려면 --run')
  } else {
    await q(`
      UPDATE customer_contacts c SET sms_recipient = TRUE
      WHERE c.role = '대표'
        AND NOT EXISTS (SELECT 1 FROM customer_contacts x
                        WHERE x.customer_id = c.customer_id AND x.sms_recipient IS NOT NULL)
    `)
    // 반영 결과를 다시 읽어 확인한다 — 응답만 믿지 않는다
    const after = await q(`
      SELECT
        (SELECT count(*) FROM customer_contacts WHERE sms_recipient IS TRUE) AS checked,
        (SELECT count(DISTINCT customer_id) FROM customer_contacts) AS customers,
        (SELECT count(*) FROM (
           SELECT customer_id FROM customer_contacts
           GROUP BY customer_id HAVING count(sms_recipient) = 0
         ) t) AS undecided
    `)
    console.log('\n반영 후:', JSON.stringify(after[0]))
    console.log('  undecided = 아직 아무도 결정 안 된 고객(대표가 없는 곳만 남아야 정상)')
  }
} catch (e) {
  console.error('실패:', e instanceof Error ? e.message : e)
  process.exit(1)
}
