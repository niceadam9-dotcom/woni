/** 모바일 API 인증 (2026-10-03 — dev 서버 필요)
 *  실행: npx tsx scripts/test-mobile-api-auth.mts
 *
 *  종전: proxy가 쿠키만 봐서 모바일 앱의 Bearer 요청을 전부 /login으로 307 — 운영에서 AI 불량 분류가 한 번도 닿지 않았다.
 *  지금: proxy는 /api/mobile/을 통과시키고 라우트가 lib/mobile-auth로 직접 검사한다. 그래서 「열렸는데 검사가 없는」
 *  라우트가 생기면 AI 비용을 누구나 쓴다 — [0] 정적 단언이 그 이웃을 막는다.
 *   [0] src/app/api/mobile 아래 모든 route.ts가 requireMobileUser를 부른다
 *   [1] 헤더 없음 → 401 (307 아님)  [2] 위조 토큰 → 401  [3] 퇴사자(is_active=false) 실토큰 → 403
 *   [4] 재직자 실토큰 → 핸들러 도달(본문 없음 400 — AI 호출 없이 통과 확인)  [5] 음성 경로도 같은 문
 *   [6] 사내 화면은 여전히 쿠키 없으면 /login(통과 접두가 넓어지지 않았다) */
// @ts-expect-error mjs 헬퍼
import { BASE, mkUser, delUser, raw, check, summary } from './_e2e-helpers.mjs'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

console.log('[0] 정적 — /api/mobile 라우트 전부 인증')
const routes: string[] = []
const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n === 'route.ts') routes.push(p) } }
walk('src/app/api/mobile')
check('라우트 2개 이상 발견', routes.length >= 2, routes.join(', '))
for (const r of routes) check(`${r} — requireMobileUser 호출`, /await requireMobileUser\(req\)/.test(readFileSync(r, 'utf8')))

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(x => x.includes('=') && !x.startsWith('#')).map(x => [x.slice(0, x.indexOf('=')).trim(), x.slice(x.indexOf('=') + 1).trim()]))
const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
let activeId = '', retiredId = ''
const post = (path: string, token: string | null, body: unknown = {}) => fetch(`${BASE}${path}`, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
})
const tokenOf = async (email: string) => {
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: 'E2eTest1!' })
  if (error || !data.session) throw new Error(`로그인 실패(${email}): ${error?.message}`)
  return data.session.access_token
}

try {
  activeId = await mkUser({ email: `mapi.a.${SUF}@e2e.test`, name: `모바일${SUF}`, employeeId: `MA-${SUF}`, role: 'employee' })
  retiredId = await mkUser({ email: `mapi.r.${SUF}@e2e.test`, name: `퇴사${SUF}`, employeeId: `MR-${SUF}`, role: 'employee' })
  const activeTok = await tokenOf(`mapi.a.${SUF}@e2e.test`)
  const retiredTok = await tokenOf(`mapi.r.${SUF}@e2e.test`)
  await raw.from('profiles').update({ is_active: false }).eq('id', retiredId)

  console.log('[1]~[3] 거절')
  const r1 = await post('/api/mobile/classify-defects', null)
  check('헤더 없음 → 401 (종전 307 /login)', r1.status === 401, `${r1.status} ${r1.headers.get('location') ?? ''}`)
  const r2 = await post('/api/mobile/classify-defects', 'forged.token.value')
  check('위조 토큰 → 401', r2.status === 401, String(r2.status))
  const r3 = await post('/api/mobile/classify-defects', retiredTok, { transcript: '소화기 압력 미달' })
  check('퇴사자 실토큰 → 403', r3.status === 403, String(r3.status))

  console.log('[4]~[5] 통과')
  const r4 = await post('/api/mobile/classify-defects', activeTok, {})
  const j4 = await r4.json().catch(() => ({}))
  check('재직자 실토큰 → 핸들러 도달(본문 없음 400)', r4.status === 400 && String(j4.error ?? '').includes('음성 텍스트'), `${r4.status} ${JSON.stringify(j4)}`)
  const r5n = await post('/api/mobile/classify-defects-audio', null)
  check('음성 경로 헤더 없음 → 401', r5n.status === 401, String(r5n.status))
  const r5 = await post('/api/mobile/classify-defects-audio', activeTok)
  check('음성 경로 재직자 → 핸들러 도달(400 안내)', r5.status === 400, String(r5.status))

  console.log('[6] 사내 경로는 여전히 쿠키')
  const r6 = await fetch(`${BASE}/customers`, { redirect: 'manual', headers: { Authorization: `Bearer ${activeTok}` } })
  check('/customers + Bearer(쿠키 없음) → /login', r6.status >= 300 && r6.status < 400 && (r6.headers.get('location') ?? '').includes('/login'), `${r6.status} ${r6.headers.get('location')}`)
  const r7 = await fetch(`${BASE}/api/mobilex`, { redirect: 'manual' })
  check('/api/mobilex(접두 흉내) → 열리지 않음', r7.status !== 200 && r7.status !== 401, String(r7.status))
} finally {
  await delUser(activeId)
  await delUser(retiredId)
}
summary()
