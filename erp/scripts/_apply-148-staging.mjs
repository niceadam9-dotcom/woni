// 마이그레이션 148(고시 별지4 누락 점검표 7종) 스테이징 적용
// 실행: node scripts/_apply-148-staging.mjs   (토큰: %TEMP%/sbtok.txt — _apply-145-staging 관례)
//
// 검증 술어는 ASCII로만 — 한글 든 SQL은 조용히 0건을 준다(feedback_no_powershell_text_edit).
// 시트명 대조는 코드축(STD-06 등)으로 하고, 한글 이름 대조는 _probe-148-vs-source.mts(supabase-js)가 맡는다.
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try {
  token = readFileSync(tokPath, 'utf8').trim()
} catch {
  console.error(`토큰이 없습니다: ${tokPath}`)
  console.error('Supabase 개인 액세스 토큰을 그 파일에 저장한 뒤 다시 실행하세요.')
  process.exit(1)
}

const sql = readFileSync('supabase/migrations/148_missing_std_sheets.sql', 'utf8')
const STAGING = 'nwflnzugwylhpdyodyog'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

const applied = await q(sql)
console.log('적용 status:', applied.status, JSON.stringify(applied.body).slice(0, 300))
if (applied.status !== 200 && applied.status !== 201) process.exit(1)

const chk = await q(
  "SELECT s.sheet_code, count(i.id) AS items, sum(CASE WHEN i.comprehensive_only THEN 1 ELSE 0 END) AS comp " +
  "FROM inspection_sheets s LEFT JOIN inspection_sheet_items i ON i.sheet_id = s.id " +
  "WHERE s.version = 'v2025' AND s.sheet_code IN ('STD-06','STD-07','STD-08','STD-12','STD-18','STD-24','STD-30') " +
  "GROUP BY s.sheet_code ORDER BY s.sheet_code")
console.log('검증(코드축):', JSON.stringify(chk.body))
// 기대: 06=62 07=61 08=83 12=55 18=9 24=17 30=15 — 총 302
