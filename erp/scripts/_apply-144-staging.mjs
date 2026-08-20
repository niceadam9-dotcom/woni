// 마이그레이션 144(owner_report 첨부 파일명 규약) 스테이징 적용.
// 144는 DDL이 아니라 조건부 UPDATE 한 건이라 REST(PATCH)로 그대로 옮길 수 있다 —
// 관리 API 토큰(%TEMP%/sbtok.txt) 없이 서비스 키만으로 끝난다.
//
// SQL의 WHERE 두 조건을 그대로 URL 필터로 옮긴다:
//   key = 'owner_report' AND attachment_name = '{고객명}_자체점검결과보고서'
// 둘째 조건이 멱등성·안전장치다 — 관리자가 이미 손으로 고쳐 둔 문구는 건드리지 않는다.
//
// 실행: node scripts/_apply-144-staging.mjs        (미리보기)
//       node scripts/_apply-144-staging.mjs --run  (적용)
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

const OLD = '{고객명}_자체점검결과보고서'
const NEW = '{연도}_소방시설등 자체점검_실시결과보고서_{고객명}'

const before = await fetch(
  `${url}/rest/v1/message_templates?select=key,attachment_name&key=eq.owner_report`,
  { headers: H }
).then((r) => r.json())
console.log('target :', url)
console.log('before :', JSON.stringify(before))

if (!process.argv.includes('--run')) {
  console.log(`\n미리보기입니다. 적용하려면 --run 을 붙이세요.`)
  console.log(`  '${OLD}'\n→ '${NEW}'`)
  process.exit(0)
}

const q = new URLSearchParams({ 'key': 'eq.owner_report', 'attachment_name': `eq.${OLD}` })
const r = await fetch(`${url}/rest/v1/message_templates?${q}`, {
  method: 'PATCH',
  headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ attachment_name: NEW, updated_at: new Date().toISOString() }),
})
const changed = await r.json()
console.log('patch  :', r.status, JSON.stringify(changed))

const after = await fetch(
  `${url}/rest/v1/message_templates?select=key,attachment_name&key=eq.owner_report`,
  { headers: H }
).then((r) => r.json())
console.log('after  :', JSON.stringify(after))

const ok = Array.isArray(after) && after.length === 1 && after[0].attachment_name === NEW
console.log(ok ? 'OK 144 적용 확인' : '실패 — 위 after 값 확인 필요')
process.exit(ok ? 0 : 1)
