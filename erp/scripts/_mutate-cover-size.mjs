/** 변이 프로브 — `test-cover-title-size.mts`가 정말 무는가.
 *
 *  🚨 크기 계약은 상수 하나로 보이기 쉬워서, 검사도 상수를 베끼기 쉽다. 그러면 **규칙이
 *  망가져도 초록**이다. 그래서 규칙을 무너뜨리는 방향으로 일부러 망가뜨려 본다 —
 *  특히 M2(한 줄 우선을 되돌린다)는 **이번에 고친 결함 그대로**라 여기서 안 잡히면 무의미하다.
 *
 *  실행: node scripts/_mutate-cover-size.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const LIB = resolve(ROOT, 'src/lib/fire-plan-cover-title.ts')

const MUTANTS = [
  { id: 'M1', why: '상한을 옛 96pt로 되돌린다 — 「너무 크다」의 재발',
    from: 'const MAX_PT = 54', to: 'const MAX_PT = 96' },
  { id: 'M2', why: '🎯 한 줄 우선을 되돌린다(가장 커지는 후보만 고른다) — 이번에 고친 결함 그대로',
    from: '    if (pt >= ONE_LINE_MIN_PT) { best = ls; bestPt = pt; break }',
    to: '    if (pt > bestPt) { best = ls; bestPt = pt }' },
  { id: 'M3', why: '한 줄 기준을 0으로 — 긴 이름까지 한 줄로 뭉개 폭을 넘긴다',
    from: 'const ONE_LINE_MIN_PT = 36', to: 'const ONE_LINE_MIN_PT = 0' },
  { id: 'M4', why: '폭 여유를 없앤다 — 줄이 폭을 넘치기 시작한다',
    from: 'const SAFETY = 0.94', to: 'const SAFETY = 1.6' },
  /* M5 — 처음엔 **생존했다**. 상한 54pt에서는 띠가 214pt까지만 가서 이 제동 장치에 닿지 않아,
   * 표본 일곱 개로는 600으로 바꿔도 초록이었다(동등 변이). 그냥 «동등»으로 치고 빼는 대신
   * 검사가 **상한 자체**를 한 쪽 예산에 맞대게 고쳐서(④ 마지막 줄) 구멍을 닫았다.
   * 이제는 잡힌다 — 살아남은 변이가 검사의 빈 곳을 가리킨 셈이다. */
  { id: 'M5', why: '띠 상한을 키운다 — 표지가 한 쪽을 넘을 여지가 생긴다',
    from: 'export const COVER_TITLE_MAX_ROW_PT = 300', to: 'export const COVER_TITLE_MAX_ROW_PT = 600' },
]

const original = readFileSync(LIB, 'utf8')
let killed = 0
try {
  for (const m of MUTANTS) {
    const hits = original.split(m.from).length - 1
    if (hits !== 1) { console.log(`${m.id} ✘ 앵커 ${hits}건 — 0건 치환은 실패로 친다`); continue }
    writeFileSync(LIB, original.split(m.from).join(m.to))
    let code = 0
    try { execFileSync('npx', ['tsx', 'scripts/test-cover-title-size.mts'], { cwd: ROOT, stdio: 'pipe', shell: true }) }
    catch (e) { code = e.status ?? 1 }
    const dead = code !== 0
    if (dead) killed++
    console.log(`${m.id} ${dead ? '🔴 잡힘' : '🟢 생존'}  ${m.why}`)
    writeFileSync(LIB, original)
  }
} finally { writeFileSync(LIB, original) }

console.log(`\n변이 ${killed}/${MUTANTS.length}`)
process.exit(killed === MUTANTS.length ? 0 : 1)
