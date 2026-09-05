// manager-edu-notify 크론 스모크 (2026-09-05) — 158 적용 후 로컬 dev(스테이징 DB)에 실호출.
// 비밀값은 출력하지 않는다. 응답 ok/집계만 본다.
// 실행: node scripts/_probe-manager-edu-cron.mjs
import { readFileSync } from 'fs'

const env = readFileSync('.env.local', 'utf8')
const m = env.match(/^CRON_SECRET=(.+)$/m)
if (!m) { console.log('CRON_SECRET 없음 — 스모크 불가'); process.exit(2) }

const r = await fetch('http://localhost:3000/api/cron/manager-edu-notify', {
  headers: { Authorization: `Bearer ${m[1].trim()}` },
})
const body = await r.json()
console.log('status:', r.status, JSON.stringify(body))
process.exit(r.status === 200 && body.ok ? 0 : 1)
