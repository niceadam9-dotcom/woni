// 154 적용 상태 **읽기 전용** 검증 — 운영·스테이징을 나란히 본다.
// 컬럼 존재만으로 '적용됨'이라 하지 않는다: DEFAULT·NOT NULL·CHECK·행 분포가 다 맞아야
// 반쪽 적용이 아니다. 두 환경의 제약 정의가 갈리면 나중에 조용히 어긋난다.
// ⚠ 술어는 전부 ASCII — 한글이 든 SQL은 에러 없이 0건을 돌려준다.
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const ENVS = { 운영: 'ryuozdhnilfjlahorizh', 스테이징: 'nwflnzugwylhpdyodyog' }

const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

const SQL =
  "SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, " +
  "(SELECT pg_get_constraintdef(oid) FROM pg_constraint " +
  " WHERE conname = 'profiles_form_font_scale_check') AS check_def, " +
  "(SELECT count(*) FROM profiles) AS rows_total, " +
  "(SELECT count(*) FROM profiles WHERE form_font_scale = 'md') AS rows_md, " +
  "(SELECT count(*) FROM profiles WHERE form_font_scale IS NULL) AS rows_null, " +
  "(SELECT count(*) FROM profiles WHERE form_font_scale <> 'md') AS rows_other " +
  "FROM information_schema.columns c " +
  "WHERE c.table_name = 'profiles' AND c.column_name = 'form_font_scale'"

const defs = {}
for (const [name, ref] of Object.entries(ENVS)) {
  const r = await q(ref, SQL)
  const row = r.body?.[0]
  console.log(`\n[${name}] status=${r.status}`)
  if (!row) { console.log('  컬럼 없음 — 154 미적용'); defs[name] = null; continue }
  console.log(`  컬럼      : ${row.column_name} ${row.data_type}`)
  console.log(`  NOT NULL  : ${row.is_nullable === 'NO' ? 'YES (규약대로)' : 'NO  ⚠ 규약 위반'}`)
  console.log(`  DEFAULT   : ${row.column_default}`)
  console.log(`  CHECK     : ${row.check_def}`)
  console.log(`  행        : 전체 ${row.rows_total} / md ${row.rows_md} / NULL ${row.rows_null} / 기타 ${row.rows_other}`)
  defs[name] = row.check_def
}

console.log(`\n제약 정의 일치: ${defs.운영 && defs.운영 === defs.스테이징 ? 'YES' : `NO (운영=${defs.운영} · 스테이징=${defs.스테이징})`}`)

// 앱이 실제로 읽을 수 있는가 — PostgREST 스키마 캐시는 컬럼 추가를 즉시 못 따라온다.
// 정보 스키마가 초록이어도 여기서 빨갛면 앱은 여전히 컬럼을 못 본다(별개 축).
const rest = await q(ENVS.운영, "SELECT form_font_scale FROM profiles LIMIT 1")
console.log(`운영 실제 SELECT: ${rest.status} ${JSON.stringify(rest.body)}`)
