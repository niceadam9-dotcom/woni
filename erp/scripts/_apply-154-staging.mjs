// 마이그레이션 154(개인별 소방계획서 글자 배율) 스테이징 적용 (소방계획서_35 S4-1)
// 실행: node scripts/_apply-154-staging.mjs   (토큰: %TEMP%/sbtok.txt 관례)
//
// ⚠ 검증은 **ASCII 술어로만** — 한글이 든 SQL은 에러 없이 0건을 돌려줘
//    '미적용'으로 오판하게 만든다(feedback_no_powershell_text_edit).
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const sql = readFileSync('supabase/migrations/154_profile_font_scale.sql', 'utf8')
const STAGING = 'nwflnzugwylhpdyodyog'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

// 적용 전 상태 — 이미 있었는지/새로 만든 것인지 구별해 기록한다
const before = await q(
  "SELECT count(*) AS n FROM information_schema.columns " +
  "WHERE table_name = 'profiles' AND column_name = 'form_font_scale'")
console.log('before  :', before.status, JSON.stringify(before.body))

const applied = await q(sql)
console.log('apply   :', applied.status, JSON.stringify(applied.body).slice(0, 300))

// 컬럼 · 기본값 · CHECK 제약 · 기존 행 분포
const chk = await q(
  "SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, " +
  "(SELECT pg_get_constraintdef(oid) FROM pg_constraint " +
  " WHERE conname = 'profiles_form_font_scale_check') AS check_def, " +
  "(SELECT count(*) FROM profiles) AS rows_total, " +
  "(SELECT count(*) FROM profiles WHERE form_font_scale = 'md') AS rows_md " +
  "FROM information_schema.columns c " +
  "WHERE c.table_name = 'profiles' AND c.column_name = 'form_font_scale'")
console.log('verify  :', chk.status, JSON.stringify(chk.body))

// 제약이 실제로 무는지 — 잘못된 값이 거절되어야 한다(제약이 이름만 있고 안 물면 무의미)
const bad = await q("UPDATE profiles SET form_font_scale = 'huge' WHERE false")
console.log('constraint dry (where false, 성공이 정상):', bad.status)
