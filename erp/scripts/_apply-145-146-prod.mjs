// 마이그레이션 145·146 운영 적용 — _apply-132-138-prod 관례
// 실행: node scripts/_apply-145-146-prod.mjs --run   (토큰: %TEMP%/sbtok.txt)
//
// 왜 이 둘만인가: 2026-08-20 실측에서 운영은 129·130·144·147이 이미 적용돼 있었고
// 145·146만 비어 있었다(_probe-prod-129-147.mjs). 순서 의존도 없다 —
// 144(message_templates UPDATE)가 요구하는 130은 이미 서 있다.
//
// 둘 다 가산 변경이고 IF NOT EXISTS라 **재실행 무해**하다. 다른 세션이 같은 것을
// 동시에 적용해도 충돌하지 않는다(130의 CREATE POLICY 같은 비멱등 구문이 없다).
//
// ⚠ 145가 없으면 별지 9·10·11호·외관·위임장·소방계획서 **생성이 전부 실패**한다 —
//   조립부가 manager_contact_id를 select하는데 컬럼이 없으면 PostgREST가 거부한다.
//   그래서 코드 배포보다 이 적용이 **먼저**여야 한다.
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try { token = readFileSync(tokPath, 'utf8').trim() } catch {
  console.error(`토큰이 없습니다: ${tokPath}`); process.exit(1)
}
if (!process.argv.includes('--run')) {
  console.error('운영 적용 스크립트 — 실행하려면 --run 을 붙이세요.'); process.exit(1)
}

const PROD = 'ryuozdhnilfjlahorizh'
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const one = (b) => (Array.isArray(b) ? b[0] : b)

// ── 선행 조건: 145의 FK 대상이 실제로 있는가 ─────────────────────────────
// 없는 테이블을 참조하면 ALTER가 통째로 실패한다. 추측하지 말고 확인한다.
const pre = one((await q(`
  SELECT
    (SELECT count(*) FROM information_schema.tables WHERE table_name='customer_contacts') AS contacts,
    (SELECT count(*) FROM information_schema.tables WHERE table_name='customers')         AS customers,
    (SELECT count(*) FROM information_schema.tables WHERE table_name='profiles')          AS profiles`)).body)
console.log('선행 조건:', JSON.stringify(pre))
if (!(Number(pre?.contacts) === 1 && Number(pre?.customers) === 1 && Number(pre?.profiles) === 1)) {
  console.error('선행 테이블이 없습니다 — 중단'); process.exit(1)
}

const files = ['145_manager_contact.sql', '146_profile_phone_birth.sql']
for (const f of files) {
  const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
  const r = await q(sql)
  const ok = r.status >= 200 && r.status < 300
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${f} — status ${r.status}${ok ? '' : ' ' + JSON.stringify(r.body)}`)
  if (!ok) process.exit(1)
}

// ── 검증 — ASCII 술어로만 ────────────────────────────────────────────────
const chk = one((await q(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name='customers' AND column_name='manager_contact_id')     AS m145_col,
    (SELECT count(*) FROM pg_indexes
      WHERE indexname='idx_customers_manager_contact')                       AS m145_idx,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name='profiles' AND column_name IN ('phone','birth_date')) AS m146_cols,
    (SELECT count(*) FROM customers WHERE manager_contact_id IS NOT NULL)    AS pointed,
    (SELECT count(*) FROM customers)                                         AS customers_total`)).body)
console.log('검증:', JSON.stringify(chk))

const pass = chk && Number(chk.m145_col) === 1 && Number(chk.m145_idx) === 1 && Number(chk.m146_cols) === 2
console.log(pass ? '\n전 항목 적용 확인 (기존 행은 전부 NULL — 지목 전까지 동작은 종전과 같다)'
                 : '\n기대치 불일치 — 위 검증값 확인 필요')
process.exit(pass ? 0 : 2)
