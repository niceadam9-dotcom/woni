/** 일회용 프로브 — test-plan-readability의 assertTokenListsMatch()와 **같은 술어**로
 *  :root · @media print · OLD_VALUES 세 목록을 대조한다. 그쪽은 브라우저가 필요해
 *  dev 서버 없이는 못 도는데, 이 축은 정적이라 여기서 먼저 확인할 수 있다.
 *  ⚠ 사본이라 조용히 어긋날 수 있다 — 정본은 test-plan-readability --print다. */
import { readFileSync } from 'node:fs'

const css = readFileSync('src/app/globals.css', 'utf8')
const ts = readFileSync('scripts/test-plan-readability.mts', 'utf8')
const names = b => new Set(b.match(/--fs-[a-z0-9-]+(?=\s*:)/g) ?? [])

const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('html[data-fs="lg"]'))
const printStart = css.indexOf('@media print')
const printBlock = css.slice(printStart, css.indexOf('\n}', css.indexOf('[data-fs-boost]', printStart)))
const oldLine = ts.match(/const OLD_VALUES = `[^`]*`/)?.[0] ?? ''

const root = names(rootBlock), print = names(printBlock), old = names(oldLine)
let bad = 0
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`); if (!ok) bad++ }

// ⚠ 항진 차단: 목록을 못 읽으면 세 집합이 다 비어 "전부 일치"가 된다
check(`모집단 — :root에서 --fs-* 토큰을 실제로 걷었다 (${root.size}개)`, root.size >= 15, [...root].join(' '))
check('OLD_VALUES 상수를 읽었다', old.size >= 15, `${old.size}개`)
check('@media print가 :root 토큰을 전부 되돌린다', [...root].every(t => print.has(t)),
  `누락: ${[...root].filter(t => !print.has(t)).join(', ')}`)
check('OLD_VALUES 사본이 :root 목록과 일치', [...root].every(t => old.has(t)),
  `누락: ${[...root].filter(t => !old.has(t)).join(', ')}`)

// -title 변형은 자간을 걸지 않는다 (제목 가드의 전제)
const decl = c => css.match(new RegExp(`@utility\\s+${c}\\s*\\{([^}]*)\\}`))?.[1] ?? null
for (const c of ['text-form-lg-title', 'text-form-xl-title']) {
  const b = decl(c)
  check(`${c}가 존재하고 letter-spacing을 걸지 않는다`, b !== null && !/letter-spacing/.test(b), b ?? '유틸리티 없음')
}
check('[대조군] text-form-lg는 letter-spacing을 건다', /letter-spacing/.test(decl('text-form-lg') ?? ''))

process.exit(bad === 0 ? 0 : 1)
