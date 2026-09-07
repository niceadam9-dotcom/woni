// 마이그레이션 159(form_font_scale에 'xxl' 추가) 스테이징 적용 (2026-09-07 사용자 승인)
// 실행: node scripts/_apply-159-staging.mjs   (토큰: %TEMP%/sbtok.txt 관례)
//
// ⚠ 검증 술어는 **ASCII로만** 쓴다 — 한글이 든 SQL은 이 API에서 에러 없이 0건을 주고,
//   그걸 '미적용'으로 오판한 적이 있다(feedback_no_powershell_text_edit).
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const sql = readFileSync('supabase/migrations/159_font_scale_xxl.sql', 'utf8')
const STAGING = 'nwflnzugwylhpdyodyog'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

// ── 적용 전 상태 (멱등 재실행에서도 '전/후'가 남게) ──
const before = await q(
  "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint " +
  "WHERE conname = 'profiles_form_font_scale_check'")
console.log('before:', before.status, JSON.stringify(before.body))

const applied = await q(sql)
console.log('apply :', applied.status, JSON.stringify(applied.body).slice(0, 300))

// ── 검증 ──
// has_xxl 만으로는 부족하다: 기존 3값이 실수로 빠져도 통과한다. 넷 다 + 개수까지 본다.
const chk = await q(
  "SELECT " +
  "pg_get_constraintdef(oid) LIKE '%xxl%' AS has_xxl, " +
  "pg_get_constraintdef(oid) LIKE '%''md''%' AS has_md, " +
  "pg_get_constraintdef(oid) LIKE '%''lg''%' AS has_lg, " +
  "pg_get_constraintdef(oid) LIKE '%''xl''%' AS has_xl, " +
  "(length(pg_get_constraintdef(oid)) - length(replace(pg_get_constraintdef(oid), '::text', ''))) / 6 AS value_count, " +
  "pg_get_constraintdef(oid) AS def " +
  "FROM pg_constraint WHERE conname = 'profiles_form_font_scale_check'")
console.log('verify:', chk.status, JSON.stringify(chk.body))

// ── 영향 범위 실측 (feedback_guard_blast_radius) — 기존 행이 새 CHECK에 걸리지 않는가 ──
const rows = await q(
  "SELECT form_font_scale AS v, count(*) AS n FROM profiles GROUP BY 1 ORDER BY 1")
console.log('rows  :', rows.status, JSON.stringify(rows.body))
