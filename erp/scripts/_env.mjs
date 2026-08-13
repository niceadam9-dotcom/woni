// Supabase 접속정보를 erp/.env.local에서 로드 — public repo이므로 키 하드코딩 금지
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

// .env.local 값을 process.env에도 채운다 — 앱은 Next가 자동으로 읽지만 스크립트는 아니라서,
// 테스트가 process.env.GOTENBERG_URL 같은 값을 보고 절을 SKIP하는 판정이 실제와 어긋났다.
// 셸에 이미 있는 값은 덮지 않는다(일회성 override가 이기도록).
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v

export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
export const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
export const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('erp/.env.local에서 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY를 찾지 못했습니다.')
  process.exit(1)
}
