// 마이그레이션 규율 게이트 (통합 실행계획 A4, 2026-10-02) — CI와 pre-push가 돌린다.
//
// 🚨 왜 생겼나(2026-10-02 실측): `163_customer_agency.sql`이 **9월 14일부터 한 번도 커밋되지 않은 채**
//   작업트리에만 있었다. 스테이징·운영 DB에는 적용돼 열 2개(customers.agency_applies·agency_grade)가 있고,
//   적용 스크립트(`_apply-163-*.mjs`, d9ee9480)는 커밋돼 있었는데 정작 SQL이 저장소에 없었다.
//   깨끗한 체크아웃에서 마이그레이션을 재생하면(복구 리허설·새 프로젝트·SaaS 테넌트) 이 열이 조용히 빠진다.
//
// 판정(전부 차단급):
//   ① 파일명이 `NNN_이름.sql`(세 자리 이상 숫자 + 밑줄)인가
//   ② 같은 번호가 두 파일에 있지 않은가
//   ③ 번호 공백이 아래 HISTORICAL_GAPS(2026-10-02 동결) 밖에서 새로 생기지 않았는가
//   ④ git 체크아웃이면: 모든 마이그레이션 파일이 **추적**되는가(미추적 = 저장소에 없는 DDL)
//   ⑤ `scripts/_apply-NNN[-MMM]-*.mjs`가 가리키는 번호의 마이그레이션 파일이 있는가(163 꼴의 직접 탐지)
//
// 실행: node scripts/assert-migrations.mjs
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const migDir = join(root, 'supabase', 'migrations')
const scriptsDir = join(root, 'scripts')

// 2026-10-02 동결 — 이력상 비어 있는 번호(초기 정리 때 결번). 여기 없는 공백은 새 결함이다.
const HISTORICAL_GAPS = new Set([57, 58, 59, 60, 61, 62, 70, 71, 72, 73, 74, 75, 76, 77])

let fail = 0
const bad = (msg) => { fail++; console.log(`❌ ${msg}`) }

const files = readdirSync(migDir).filter(f => f.endsWith('.sql'))
const byNum = new Map()
for (const f of files) {
  const m = f.match(/^(\d{3,})_[A-Za-z0-9_\-]+\.sql$/)
  if (!m) { bad(`① 파일명 규칙 위반: ${f} (NNN_이름.sql)`); continue }
  const n = Number(m[1])
  byNum.set(n, [...(byNum.get(n) ?? []), f])
}

// ②
for (const [n, fs] of byNum) if (fs.length > 1) bad(`② 번호 중복 ${n}: ${fs.join(', ')}`)

// ③
const nums = [...byNum.keys()].sort((a, b) => a - b)
const max = nums.at(-1) ?? 0
for (let i = 1; i <= max; i++) {
  if (!byNum.has(i) && !HISTORICAL_GAPS.has(i)) bad(`③ 새 번호 공백 ${String(i).padStart(3, '0')} — 번호를 건너뛰지 말 것(이력 결번은 HISTORICAL_GAPS)`)
}
for (const g of HISTORICAL_GAPS) if (byNum.has(g)) bad(`③ HISTORICAL_GAPS의 ${g}에 파일이 생겼다 — 목록에서 지울 것`)

// ④ — git이 있으면(CI 체크아웃·로컬) 미추적 마이그레이션을 찾는다
let gitOk = true
try {
  const untracked = execSync('git ls-files --others --exclude-standard -- supabase/migrations', { cwd: root, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(s => s.endsWith('.sql'))
  for (const u of untracked) bad(`④ 미추적 마이그레이션: ${u} — 적용했다면 반드시 커밋할 것(재생 시 빠진다)`)
} catch {
  gitOk = false
  console.log('⚠ ④ git 없음 — 미추적 검사를 건너뜁니다(통과로 치지 마세요)')
}

// ⑤ — 적용 스크립트가 가리키는 번호 → 파일 존재
for (const s of readdirSync(scriptsDir)) {
  const m = s.match(/^_apply-(\d{3})(?:-(\d{3}))?-[a-z]+\.mjs$/)
  if (!m) continue
  const from = Number(m[1]), to = Number(m[2] ?? m[1])
  for (let n = from; n <= to; n++) {
    if (!byNum.has(n) && !HISTORICAL_GAPS.has(n)) bad(`⑤ ${s}가 가리키는 ${String(n).padStart(3, '0')} 마이그레이션 파일이 없다`)
  }
}

console.log(fail
  ? `\n❌ [마이그레이션 규율] ${fail}건 위반 (파일 ${files.length}개, 최신 ${String(max).padStart(3, '0')})`
  : `✅ [마이그레이션 규율] 파일 ${files.length}개 · 최신 ${String(max).padStart(3, '0')} · 중복 0 · 새 공백 0${gitOk ? ' · 미추적 0' : ''} · 적용 스크립트 대응 전건`)
process.exit(fail ? 1 : 0)
