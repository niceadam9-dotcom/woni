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

export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
export const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
export const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('erp/.env.local에서 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY를 찾지 못했습니다.')
  process.exit(1)
}
