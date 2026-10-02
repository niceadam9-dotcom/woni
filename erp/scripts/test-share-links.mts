/** 관계인 열람 링크 — 순수·정적 게이트 (불량 → 매출 2단계, 2026-10-02)
 *  실행: npx tsx --conditions=react-server scripts/test-share-links.mts   — 서버·DB 불필요
 *
 *  고정하는 것:
 *   · 토큰 = 43자 base64url(32바이트) · 해시 = sha256 hex 64자 · 같은 토큰 → 같은 해시, 다른 토큰 → 다른 해시
 *   · 형식 검사가 잘못된 모양(짧음·긴 것·금지 문자·경로 조각)을 거른다
 *   · 🔒 공개 라우트(src/app/p/**)는 anon·쿠키 세션 클라이언트를 쓰지 않는다 — service role + resolveShareToken만
 *     (RLS가 「로그인이면 전부 조회」라 세션 클라이언트를 쓰면 경계가 흐려진다. 정적 원문 계수 — 주석도 걸린다)
 *   · proxy PUBLIC_PATHS의 접두사는 '/p/'(슬래시까지) — '/p'만이면 /payroll·/purchase-orders가 공개된다
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { newShareToken, hashShareToken, isShareTokenShape } from '../src/lib/share-links.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond } catch (e) { fail++; console.log(`  ❌ ${name} — 예외: ${String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('— 토큰·해시')
const a = newShareToken(), b = newShareToken()
ok('토큰 43자 base64url', /^[A-Za-z0-9_-]{43}$/.test(a.token), a.token)
ok('해시 64자 hex', /^[0-9a-f]{64}$/.test(a.hash))
ok('해시는 결정적', hashShareToken(a.token) === a.hash)
ok('두 토큰은 다르다', a.token !== b.token && a.hash !== b.hash)
ok('형식: 정상 통과', isShareTokenShape(a.token))
for (const bad of ['', 'abc', a.token + 'x', a.token.slice(0, 42), a.token.slice(0, 42) + '/', '../../etc/passwd'.padEnd(43, 'a'), a.token.slice(0, 42) + '%']) {
  ok(`형식: 거절 「${bad.slice(0, 12)}…」(${bad.length}자)`, !isShareTokenShape(bad))
}

console.log('— 공개 라우트 정적 게이트')
const root = new URL('../src/app/p/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const files: string[] = []
const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n)) files.push(p) } }
walk(root)
ok('src/app/p 아래 파일이 있다(page·actions·form·file route)', files.length >= 4, String(files.length))
const FORBIDDEN = ['@/lib/supabase/server', '@/lib/supabase/client', 'createServerClient', 'createBrowserClient', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'getProfile', 'getSessionUser']
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const rel = f.slice(f.indexOf('src'))
  for (const w of FORBIDDEN) ok(`${rel}: 「${w}」 없음`, !src.includes(w))
}
const serverFiles = files.filter(f => !/approve-form\.tsx$/.test(f))
for (const f of serverFiles) {
  const src = readFileSync(f, 'utf8')
  ok(`${f.slice(f.indexOf('src'))}: resolveShareToken으로 토큰을 먼저 해석`, src.includes('resolveShareToken('))
}
const form = files.find(f => /approve-form\.tsx$/.test(f))
ok('승인 폼은 클라이언트 컴포넌트이고 admin을 import하지 않는다', !!form && readFileSync(form, 'utf8').startsWith("'use client'") && !readFileSync(form, 'utf8').includes('supabase'))

console.log('— proxy 공개 접두사')
const proxy = readFileSync(new URL('../src/proxy.ts', import.meta.url), 'utf8')
const m = /const PUBLIC_PATHS = \[([^\]]*)\]/.exec(proxy)
ok('PUBLIC_PATHS를 찾았다', !!m)
ok("'/p/'(슬래시까지)가 있다", !!m && m[1].includes("'/p/'"))
ok("'/p'(슬래시 없이)는 없다", !!m && !/'\/p'(?!\/)/.test(m[1]))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
