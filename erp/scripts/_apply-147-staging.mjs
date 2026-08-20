// 마이그레이션 147(company_profile 공문 발신 명의) 스테이징 적용
// 실행: node scripts/_apply-147-staging.mjs   (토큰: %TEMP%/sbtok.txt)
//
// ⚠ 147 적용 전에는 회사정보 화면·공문 조립이 깨진다 — getCompanyProfile이 official_sender_name을
//   명시 select하는데 컬럼이 없으면 PostgREST가 거부한다. 가산 변경(ADD COLUMN)이고 기존 행은 NULL,
//   NULL이면 상호는 company_name·직함은 '대표이사'로 폴백하므로 값 입력 전 동작은 종전과 같다.
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

const sql = readFileSync('supabase/migrations/147_official_sender.sql', 'utf8')
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
console.log('적용 status:', applied.status, JSON.stringify(applied.body))

// 검증은 ASCII 술어로만 — 한글이 든 SQL은 조용히 0건을 준다
const chk = await q(
  "SELECT count(*) AS cols FROM information_schema.columns " +
  "WHERE table_name='company_profile' AND column_name IN ('official_sender_name','official_rep_title')")
console.log('검증(2여야 함):', JSON.stringify(chk.body))
