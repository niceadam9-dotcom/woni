// 읽기 전용: 운영 DB에 129·130·144~147이 적용됐는지 실측한다. 쓰기 없음.
// 실행: node scripts/_probe-prod-129-147.mjs   (토큰: %TEMP%/sbtok.txt)
//
// 판정은 ASCII 술어로만 — 한글이 든 SQL은 에러 없이 조용히 0건을 준다
// (feedback_no_powershell_text_edit). 144의 시드 문구 비교도 한글이라 SQL에 넣지 않고,
// 값을 그대로 받아 **JS에서** 비교한다.
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try { token = readFileSync(tokPath, 'utf8').trim() } catch {
  console.error(`토큰이 없습니다: ${tokPath}`); process.exit(1)
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

const r = await q(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name='fire_plans' AND column_name='source_hash')            AS m129_col,
    (SELECT count(*) FROM information_schema.tables
      WHERE table_name='message_templates')                                   AS m130_table,
    (SELECT count(*) FROM pg_policies
      WHERE tablename='message_templates')                                    AS m130_policies,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name='report_deliveries' AND column_name='body')            AS m130_delivery_body,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name='customers' AND column_name='manager_contact_id')      AS m145_col,
    (SELECT count(*) FROM pg_indexes
      WHERE indexname='idx_customers_manager_contact')                        AS m145_idx,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name='profiles' AND column_name IN ('phone','birth_date'))  AS m146_cols,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name='company_profile'
        AND column_name IN ('official_sender_name','official_rep_title'))     AS m147_cols`)

console.log('종합 status:', r.status)
const row = Array.isArray(r.body) ? r.body[0] : r.body
console.log(JSON.stringify(row, null, 1))

// 144는 값 비교 — 테이블이 있을 때만 조회하고, 한글 비교는 JS에서 한다
if (row && Number(row.m130_table) === 1) {
  const t = await q("SELECT key, attachment_name FROM message_templates WHERE key='owner_report'")
  const tr = Array.isArray(t.body) ? t.body[0] : null
  const OLD = '{고객명}_자체점검결과보고서'
  const NEW = '{연도}_소방시설등 자체점검_실시결과보고서_{고객명}'
  const cur = tr?.attachment_name ?? null
  console.log('\n144 owner_report.attachment_name:', JSON.stringify(cur))
  console.log('   판정:', cur === NEW ? '적용됨' : cur === OLD ? '미적용(130 시드 그대로 — 144 대상)'
    : cur === null ? '행 없음' : '수기 수정됨 — 144는 이 행을 건드리지 않는다')
} else {
  console.log('\n144: message_templates 자체가 없다 — 130 적용이 선행되어야 한다')
}

console.log(`
기대치(전부 적용 시): m129_col=1 · m130_table=1 · m130_policies=2 · m130_delivery_body=1
                      m145_col=1 · m145_idx=1 · m146_cols=2 · m147_cols=2`)
