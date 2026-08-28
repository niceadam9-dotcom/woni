// 마이그레이션 151(profiles.theme) 운영 적용 (소방계획서_29 R-2, 2026-08-28 사용자 승인)
// 실행: node scripts/_apply-151-prod.mjs   (토큰: %TEMP%/sbtok.txt, _apply-145-staging 관례)
//
// 가산 변경(ADD COLUMN default 'light' + CHECK) — 기존 행은 전부 light가 되고
// 앱 코드는 관용 조회(lib/theme.ts)라 적용 전·후 어느 쪽에서도 동작한다(배포 순서 자유).
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

const sql = readFileSync('supabase/migrations/151_profile_theme.sql', 'utf8')
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
console.log('적용 status:', applied.status, JSON.stringify(applied.body))

// 검증은 ASCII 술어로만 — 한글이 든 SQL은 조용히 0건을 준다(feedback_no_powershell_text_edit)
const chk = await q(
  "SELECT " +
  "(SELECT count(*) FROM information_schema.columns WHERE table_name='profiles' AND column_name='theme') AS col, " +
  "(SELECT column_default FROM information_schema.columns WHERE table_name='profiles' AND column_name='theme') AS col_default, " +
  "(SELECT count(*) FROM information_schema.check_constraints WHERE constraint_name='profiles_theme_check') AS chk, " +
  "(SELECT count(*) FROM profiles) AS total_rows, " +
  "(SELECT count(*) FROM profiles WHERE theme = 'light') AS light_rows, " +
  "(SELECT count(*) FROM profiles WHERE theme NOT IN ('light','dark')) AS bad_rows")
console.log('검증:', JSON.stringify(chk.body))
