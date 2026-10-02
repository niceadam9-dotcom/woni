// lint 래칫 (통합 실행계획 A4, 2026-10-02) — CI와 pre-push가 돌린다.
//
// 2026-10-02 실측: `eslint src --quiet`가 기존 오류 68건(대부분 <a> 대신 <Link>·렌더 중 Date.now 등 오래된 것).
// 전부를 지금 고치면 범위가 커지고, 차단급으로 걸면 CI가 첫날부터 영구 빨강이다.
// 그래서 **기준값을 넘으면 실패, 줄이는 것만 허용**한다. 고쳐서 줄었으면 LINT_ERROR_BASELINE을 그 값으로 내린다
// (올리는 커밋은 리뷰에서 걸러야 한다 — 올릴 이유가 있으면 커밋 메시지에 적는다).
//
// 실행: node scripts/assert-lint-ratchet.mjs
import { execSync } from 'node:child_process'

const LINT_ERROR_BASELINE = 68

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
let out
try {
  out = execSync('npx eslint src --quiet -f json', { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })
} catch (e) {
  // 오류가 있으면 eslint는 exit 1 — stdout에 JSON이 있다
  out = e.stdout
  if (!out) { console.error('❌ [lint 래칫] eslint 실행 실패:', e.message); process.exit(1) }
}
const results = JSON.parse(out)
const byRule = new Map()
let errors = 0
for (const r of results) for (const m of r.messages) {
  if (m.severity !== 2) continue
  errors++
  const k = m.ruleId ?? '(parse)'
  byRule.set(k, (byRule.get(k) ?? 0) + 1)
}
const top = [...byRule].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(' · ')

if (errors > LINT_ERROR_BASELINE) {
  console.log(`❌ [lint 래칫] 오류 ${errors}건 > 기준 ${LINT_ERROR_BASELINE} — 새 lint 오류를 고칠 것`)
  console.log(`   규칙별: ${top}`)
  for (const r of results) for (const m of r.messages) {
    if (m.severity === 2) console.log(`   ${r.filePath.replace(root, '')}:${m.line}:${m.column} ${m.ruleId} — ${m.message.split('\n')[0].slice(0, 120)}`)
  }
  process.exit(1)
}
console.log(`✅ [lint 래칫] 오류 ${errors}건 ≤ 기준 ${LINT_ERROR_BASELINE}${errors < LINT_ERROR_BASELINE ? ` — 줄었다! 기준을 ${errors}로 내릴 것` : ''}`)
console.log(`   규칙별: ${top}`)
