// 마이그레이션 152(조건부 hard delete) 운영 적용 (소방계획서_32 S9-2·S9-4, 2026-08-30 사용자 승인)
// 실행: cd F:\AI\ERP\erp; node scripts/_apply-152-prod.mjs   (토큰: %TEMP%/sbtok.txt 관례)
//
// 승인 근거(S8-2 실측): 운영 고객 2명은 둘 다 점검·서식·세부현황·설비대장·완료계획을 갖고 있어
// 적용 직후 삭제 가능 인원은 0명이다. 실제 노출면은 앞으로 등록될 신규 고객이며, 그것이 이 기능의
// 의도(잘못 등록한 고객 정정)다. 가드는 스테이징에서 런타임 검증을 마쳤다(S10-5·S10-6).
//
// 21축본 개정 내용은 152 파일 머리말 참조. CREATE OR REPLACE라 멱등이다.
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try {
  token = readFileSync(tokPath, 'utf8').trim()
} catch {
  console.error(`토큰이 없습니다: ${tokPath}`)
  process.exit(1)
}

const sql = readFileSync('supabase/migrations/152_conditional_hard_delete.sql', 'utf8')
const PROD = 'ryuozdhnilfjlahorizh'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

const applied = await q(sql)
console.log('apply status:', applied.status, JSON.stringify(applied.body).slice(0, 300))
if (applied.status >= 300) process.exit(1)

// 검증은 ASCII 술어로만 — 한글은 이 API에서 에러 없이 0건을 준다.
// '함수가 있는가'가 아니라 **어떤 함수가 있는가**를 본다(13축 구본이 올라갈 수도 있었다).
const chk = await q(
  "SELECT p.proname, p.prosecdef, length(p.prosrc) AS src_len, " +
  "(SELECT count(*) FROM regexp_matches(p.prosrc, 'FROM\\s+\\w+\\s+WHERE customer_id', 'g')) AS axis_count, " +
  "(p.prosrc LIKE '%facility_ledger%')       AS has_ledger, " +
  "(p.prosrc LIKE '%pg_advisory_xact_lock%') AS has_advisory_lock, " +
  "(p.prosrc LIKE '%FOR UPDATE%')            AS has_for_update, " +
  "(SELECT string_agg(privilege_type, ',') FROM information_schema.routine_privileges rp " +
  " WHERE rp.routine_name = 'hard_delete_customer' AND rp.grantee = 'service_role') AS svc_priv, " +
  "(SELECT count(*) FROM information_schema.routine_privileges rp " +
  " WHERE rp.routine_name = 'hard_delete_customer' AND rp.grantee IN ('anon','authenticated')) AS bad_grants " +
  "FROM pg_proc p WHERE p.proname = 'hard_delete_customer'")
console.log('verify status:', chk.status, JSON.stringify(chk.body, null, 2))
