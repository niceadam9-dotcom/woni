/** 변이 프로브 — `test-fire-plan-blanks.mts`가 **실제로 무는지** 증명한다.
 *
 *  이 모듈은 「분모가 조용히 부푸는」 실패에 특히 약하다 — 슬롯 규칙에서 제외 조건 하나만 빠져도
 *  숫자가 커지는데, **커진 숫자도 그럴듯해 보인다**. 그래서 제외 조건을 **하나씩** 빼 본다.
 *
 *  🚨 치환 0건은 실패로 친다.
 *  실행: node scripts/_mutate-blanks.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = resolve(HERE, '../src/lib/fire-plan-blanks.ts')
const TEST = resolve(HERE, 'test-fire-plan-blanks.mts')

const MUTANTS = [
  ['M1 병합에 덮인 칸을 제외하지 않는다 → 분모가 부푼다',
    LIB, `    .filter(c => !c.covered)`, `    .filter(() => true)`, 1],
  ['M2 테두리 없는 여백을 제외하지 않는다 → 분모가 부푼다',
    LIB, `    .filter(hasBorder)`, `    .filter(() => true)`, 1],
  ['M3 라벨·상자·배너·사진을 제외하지 않는다 → 1.1이 전 칸 슬롯이 된다',
    LIB, `    .filter(c => !banner.has(c.row) && !man.labels[c.ref] && !man.boxes[c.ref] && !photo.has(c.ref))`,
    `    .filter(() => true)`, 1],
  ['M4 앵커가 있어도 unwired로 찍는다 → [2] 음성 단언이 빨강이어야',
    LIB, `    if (!field) {`, `    if (true) {`, 1],
  ['M5 값이 있어도 empty로 찍는다 → [3] 음성 단언이 빨강이어야',
    LIB, `    } else if (filled && !filled.has(field)) {`, `    } else if (filled) {`, 1],
  ['M6 우리 할 일을 뒤로 민다 → [6] 정렬 단언이 빨강이어야',
    LIB, `a.kind === 'unwired' ? -1 : 1`, `a.kind === 'unwired' ? 1 : -1`, 1],
  ['M7 이웃 라벨을 안 붙인다 → [5]가 빨강이어야',
    LIB, `  if (best) return best.text\n`, `  if (best) return ''\n`, 1],
  ['M9 라벨 색인이 행/열을 뒤집는다 → [5] 비율이 무너져야',
    LIB, `    if (l.row !== target.row || l.col >= target.col) continue`,
    `    if (l.col !== target.row || l.row >= target.col) continue`, 1],
  ['M8 상자 수를 안 센다 → [1] 회계가 빨강이어야',
    LIB, `    wiredBoxes: boxRefs.filter(r => anchored.has(r)).length,`, `    wiredBoxes: 0,`, 1],
]

/** 🚨 파일의 줄끝에 맞춰 needle을 바꾼다.
 *
 *  리베이스·stash 복원이 git autocrlf로 파일을 **CRLF**로 되돌려 놓으면 개행이 든 패턴이
 *  **0건 치환**된다. 가드가 「변이가 안 돌았다」로 잡아 주긴 했지만, 매번 손으로 고칠 일이
 *  아니라 프로브가 알아서 맞춰야 한다 — 이 저장소가 CRLF 함정에 **네 번째** 빠진 자리다.
 */
const NL = String.fromCharCode(10)
const CRNL = String.fromCharCode(13, 10)
const eolFit = (src, s) => (src.includes(CRNL) ? s.split(NL).join(CRNL) : s)

const runTest = () => {
  try { execFileSync('npx', ['tsx', '--conditions=react-server', TEST], { cwd: resolve(HERE, '..'), stdio: 'pipe', shell: true }); return 0 }
  catch (e) { return e.status ?? 1 }
}

const base = runTest()
console.log(`대조군(무변이): exit ${base} ${base === 0 ? '✔ 초록' : '✘ 이미 빨강'}`)
if (base !== 0) process.exit(1)

let caught = 0
for (const [label, file, find, repl, expectHits] of MUTANTS) {
  const orig = readFileSync(file, 'utf8')
  const needle = eolFit(orig, find)
  const hits = orig.split(needle).length - 1
  if (hits !== expectHits) {
    console.log(`  ✘ ${label}\n      🚨 치환 대상 ${hits}건(기대 ${expectHits}) — 변이가 안 돌았다. 실패로 친다`)
    continue
  }
  writeFileSync(file, orig.split(needle).join(eolFit(orig, repl)), 'utf8')
  const code = runTest()
  writeFileSync(file, orig, 'utf8')
  if (code !== 0) caught++
  console.log(`  ${code !== 0 ? '✔' : '✘'} ${label}  (exit ${code})`)
}
console.log(`\n=== 변이 ${caught}/${MUTANTS.length} 잡음 ===`)
process.exit(caught === MUTANTS.length ? 0 : 1)
