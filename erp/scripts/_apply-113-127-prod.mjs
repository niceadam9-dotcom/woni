// 운영 DB에 supabase/apply-113-127-prod.sql 적용 — Management API
// 실행: node scripts/_apply-113-127-prod.mjs        (미리보기)
//       node scripts/_apply-113-127-prod.mjs --run  (실제 적용)
// 토큰: %TEMP%/sbtok.txt (자격증명관리자 'Supabase CLI:supabase'에서 추출)
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const PROD = 'ryuozdhnilfjlahorizh'
const sql = readFileSync(join(process.cwd(), 'supabase', 'apply-113-127-prod.sql'), 'utf8')

const stmts = sql.split('\n').filter(l => /^\s*(ALTER|CREATE|INSERT|UPDATE|DROP|COMMENT|DO|WITH)/i.test(l)).length
console.log(`대상 프로젝트: ${PROD} (운영)`)
console.log(`SQL 크기: ${sql.length}바이트 · 실행문 시작줄 ${stmts}개 · BEGIN/COMMIT 트랜잭션`)

if (!process.argv.includes('--run')) {
  console.log('\n미리보기 모드 — 실제 적용하려면 --run 을 붙일 것')
  process.exit(0)
}

console.log('\n적용 중…')
const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})
const text = await r.text()
console.log('HTTP', r.status)
console.log(text.slice(0, 1000))
process.exitCode = r.ok ? 0 : 1
