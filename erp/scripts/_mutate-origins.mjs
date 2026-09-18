/** test-fire-plan-origins.mts가 실제로 무는가 — 변이 프로브 (2026-09-18, 4단계)
 *  실행: node scripts/_mutate-origins.mjs */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ORIGINS = resolve(HERE, '../src/lib/fire-plan-origins.ts')
const TEST = resolve(HERE, 'test-fire-plan-origins.mts')

const MUTANTS = [
  /* 🚨 MO1 — 차분이 잡아낸 override를 지우면 차분 brigade 케이스가 도로 빨강이어야 한다. */
  ['MO1 train_[tn]_brigade override 제거 → [2] brigade 차분이 빨강이어야',
    "  [/^train_[tn]_brigade$/, 'brigade 행 수(2장 편성표)', 'ch2'],", '', 1],
  /* 🚨 MO2 — 기본값(대장 조회)을 죽이면 전수 가드가 빨강이어야 한다. */
  ['MO2 대장 기본값을 null로 → [1] 전수 가드가 빨강이어야',
    "  return d ? { form: d.form, card: (d as { card?: string }).card, source: `${sheet} 절 소유` } : null",
    '  return null', 1],
  /* 🚨 MO3 — override의 목적지를 갈면 표본 단언이 빨강이어야 한다. */
  ['MO3 3.3 override를 ch3로 → [1] 표본 단언이 빨강이어야',
    "  [/^evac3_/, 'zones(1.2.1과 같은 축)', '1.2'],",
    "  [/^evac3_/, 'zones(1.2.1과 같은 축)', 'ch3'],", 1],
]

const NL = String.fromCharCode(10)
const CRNL = String.fromCharCode(13, 10)
const eolFit = (src, s) => (src.includes(CRNL) ? s.split(NL).join(CRNL) : s)

const runTest = () => {
  try { execFileSync('npx', ['tsx', TEST], { cwd: resolve(HERE, '..'), stdio: 'pipe', shell: true }); return 0 }
  catch (e) { return e.status ?? 1 }
}

const base = runTest()
console.log(`대조군(무변이): exit ${base} ${base === 0 ? '✔ 초록' : '✘ 이미 빨강 — 변이 결과를 못 믿는다'}`)
if (base !== 0) process.exit(1)

let caught = 0
for (const [label, find, repl, expectHits] of MUTANTS) {
  const orig = readFileSync(ORIGINS, 'utf8')
  const needle = eolFit(orig, find)
  const hits = orig.split(needle).length - 1
  if (hits !== expectHits) {
    console.log(`  ✘ ${label}\n      🚨 치환 대상 ${hits}건(기대 ${expectHits}) — 변이가 안 돌았다. 실패로 친다`)
    continue
  }
  writeFileSync(ORIGINS, orig.split(needle).join(eolFit(orig, repl)), 'utf8')
  const code = runTest()
  writeFileSync(ORIGINS, orig, 'utf8')
  if (code !== 0) caught++
  console.log(`  ${code !== 0 ? '✔' : '✘'} ${label}  (exit ${code})`)
}

console.log(`\n=== 변이 ${caught}/${MUTANTS.length} 잡음 ===`)
process.exit(caught === MUTANTS.length ? 0 : 1)
