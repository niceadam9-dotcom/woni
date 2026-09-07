// 마이그레이션 159(form_font_scale에 'xxl' 추가) 운영 적용 (2026-09-07 사용자 승인)
// 실행: node scripts/_apply-159-prod.mjs   (토큰: %TEMP%/sbtok.txt 관례)
//
// ⚠ 순서: **DB 먼저, 코드 나중**. 코드가 먼저 나가면 '최대'를 고른 사용자가 23514로
//   거절당하고 "눌렀는데 안 된다"만 본다. 반대 순서는 무해하다(아무도 xxl을 안 보낸다).
// ⚠ 검증 술어는 ASCII로만.
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const sql = readFileSync('supabase/migrations/159_font_scale_xxl.sql', 'utf8')
const PROD_REF = 'ryuozdhnilfjlahorizh'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

const DEF = "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint " +
            "WHERE conname = 'profiles_form_font_scale_check'"

const before = await q(DEF)
console.log('before:', before.status, JSON.stringify(before.body))

const applied = await q(sql)
console.log('apply :', applied.status, JSON.stringify(applied.body).slice(0, 300))

const chk = await q(
  "SELECT " +
  "pg_get_constraintdef(oid) LIKE '%xxl%' AS has_xxl, " +
  "pg_get_constraintdef(oid) LIKE '%''md''%' AS has_md, " +
  "pg_get_constraintdef(oid) LIKE '%''lg''%' AS has_lg, " +
  "pg_get_constraintdef(oid) LIKE '%''xl''%' AS has_xl, " +
  "(length(pg_get_constraintdef(oid)) - length(replace(pg_get_constraintdef(oid), '::text', ''))) / 6 AS value_count " +
  "FROM pg_constraint WHERE conname = 'profiles_form_font_scale_check'")
console.log('verify:', chk.status, JSON.stringify(chk.body))

// 영향 범위 — 기존 행이 새 CHECK에 걸리지 않는가(전부 md/lg/xl이어야)
const rows = await q("SELECT form_font_scale AS v, count(*) AS n FROM profiles GROUP BY 1 ORDER BY 1")
console.log('rows  :', rows.status, JSON.stringify(rows.body))
