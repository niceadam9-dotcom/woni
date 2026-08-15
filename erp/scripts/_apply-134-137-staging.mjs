// 마이그레이션 134·135·136·137 스테이징 순차 적용 — _apply-133-staging 관례 (소방계획서_22·23)
// 134: 3층 축 컬럼+백필 / 135: MU 법정 순서 / 136: cover·official 타입 허용 / 137: STD-32 18항목 편입
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

const files = [
  '134_sheet_item_group_axis.sql',
  '135_mu_group_legal_order.sql',
  '136_cover_official_types.sql',
  '137_std32_missing_ab_items.sql',
]
for (const f of files) {
  const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
  const r = await q(sql)
  const ok = r.status >= 200 && r.status < 300
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${f} — status ${r.status}${ok ? '' : ' ' + JSON.stringify(r.body)}`)
  if (!ok) process.exit(1)   // 순서 의존(137 ③이 134 컬럼을 조건 사용) — 실패 시 즉시 중단
}

// 종합 검증 — 적용 결과를 한 번에 확인
const chk = await q(`
  SELECT
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='inspection_sheet_items'
      AND column_name IN ('group_code','group_name','group_order','subgroup_name','subgroup_order')) AS group_cols,
    (SELECT COUNT(*) FROM inspection_sheet_items i JOIN inspection_sheets s ON s.id = i.sheet_id
      WHERE s.sheet_code = 'STD-32') AS std32_items,
    (SELECT COUNT(*) FROM inspection_sheet_items i JOIN inspection_sheets s ON s.id = i.sheet_id
      WHERE s.sheet_code = 'STD-32' AND i.item_code LIKE '32-A-%') AS std32_a,
    (SELECT COUNT(*) FROM inspection_sheet_items WHERE group_name IS NOT NULL) AS with_group_name,
    (SELECT COUNT(*) FROM inspection_sheet_items WHERE subgroup_name IS NOT NULL) AS with_subgroup,
    (SELECT COUNT(*) FROM information_schema.check_constraints
      WHERE constraint_name='fire_plan_gen_jobs_report_type_check' AND check_clause LIKE '%official%') AS jobs_check_official`)
console.log('검증:', JSON.stringify(chk.body, null, 1))
