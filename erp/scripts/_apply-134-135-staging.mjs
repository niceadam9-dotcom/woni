// 마이그레이션 122(Realtime)·134(그룹 축)·135(MU 법정 순서) 스테이징 적용 — _apply-133-staging 관례
// 사용자 승인: 2026-08-15 "진행해줘" (소방계획서_23). 셋 다 멱등(IF NOT EXISTS / UPDATE).
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try { token = readFileSync(tokPath, 'utf8').trim() } catch {
  console.error(`토큰이 없습니다: ${tokPath}`)
  process.exit(1)
}

const STAGING = 'nwflnzugwylhpdyodyog'
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

let fail = 0

// ── 사전 상태 ──
const pre = await q(`
  SELECT
    (SELECT COUNT(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='inspection_sheet_responses') AS rt,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='inspection_sheet_items' AND column_name='group_code') AS col134`)
console.log('사전:', JSON.stringify(pre.body))

for (const file of ['122_realtime_sheet_responses.sql', '134_sheet_item_group_axis.sql', '135_mu_group_legal_order.sql']) {
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
  const r = await q(sql)
  const ok = r.status >= 200 && r.status < 300
  console.log(`${ok ? '✅' : '❌'} ${file} — status ${r.status}${ok ? '' : ' ' + JSON.stringify(r.body)}`)
  if (!ok) { fail++; break }   // 순서 의존(135는 134의 컬럼을 쓴다) — 실패 시 중단
}

if (!fail) {
  // ── 사후 검증(DO $$ 통과 후 재확인) ──
  const post = await q(`
    SELECT
      (SELECT COUNT(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='inspection_sheet_responses') AS rt,
      (SELECT COUNT(*) FROM inspection_sheet_items WHERE group_code IS NULL OR group_name IS NULL) AS null_grp,
      (SELECT COUNT(DISTINCT group_code) FROM inspection_sheet_items WHERE item_code ~ '^[0-9]{1,2}-[A-Z]-[0-9]{1,3}$') AS std_groups,
      (SELECT COUNT(*) FROM inspection_sheet_items WHERE subgroup_name IS NOT NULL) AS sub_rows,
      (SELECT group_name FROM inspection_sheet_items WHERE item_code='1-A-001' LIMIT 1) AS g1a,
      (SELECT subgroup_name FROM inspection_sheet_items WHERE item_code='2-H-018' LIMIT 1) AS sub2h018,
      (SELECT facility_type FROM inspection_sheet_items WHERE item_code='MU-007' LIMIT 1) AS mu007,
      (SELECT facility_type FROM inspection_sheet_items WHERE item_code='MU-010' LIMIT 1) AS mu010`)
  const row = post.body?.[0] ?? {}
  console.log('사후:', JSON.stringify(row))
  const chk = (name, ok) => { console.log(`  ${ok ? '✅' : '❌'} ${name}`); if (!ok) fail++ }
  chk('Realtime — inspection_sheet_responses 등록', Number(row.rt) === 1)
  chk('group_code/name NULL 0건', Number(row.null_grp) === 0)
  chk('STD 중분류 130종(137 적용 후 132)', [130, 132].includes(Number(row.std_groups)))
  chk('소제목 적용 210행(면 경계 4건 포함)', Number(row.sub_rows) === 210)
  chk("1-A group_name = '소화기구(…)'", String(row.g1a ?? '').startsWith('소화기구'))
  chk("2-H-018 소제목 = 감시제어반(면 경계 편입)", row.sub2h018 === '감시제어반')
  chk("MU-007·MU-010 = '기타'", row.mu007 === '기타' && row.mu010 === '기타')
}

console.log(fail ? `\n❌ 실패 ${fail}건` : '\n✅ 122·134·135 적용·검증 완료')
process.exit(fail ? 1 : 0)
