/** 빨강 귀속 판정 — **내 변경 탓인가, origin/main에 이미 있던 것인가**.
 *
 *  ⭐ 이 저장소의 규칙: 「내 축이 아닌 것 같다」는 근거가 아니다. **대조군을 실제로 돌려** 가른다.
 *    전에 `git stash`로 델타만 빼 보니 오히려 더 나빴던 적이 있고, 「남의 빨강」을 내 것으로
 *    셈해 배포를 멈출 뻔한 적도 있다.
 *
 *  방법: 내 변경 파일을 잠시 치우고 **순정 origin/main 상태**에서 같은 검사를 돌린다.
 *  · 순정에서도 빨강 → **선재 결함**(내 것 아님)
 *  · 순정에선 초록 → **내가 깨뜨렸다**
 *
 *  실행: node scripts/_attribute-fails.mjs "검사이름1" "검사이름2" …
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { execSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ERP = resolve(HERE, '..')
const names = process.argv.slice(2)
if (names.length === 0) { console.error('검사 이름을 인자로 달라'); process.exit(1) }

// 이름 → 커맨드 (test-all.mts가 정본)
const src = readFileSync(resolve(HERE, 'test-all.mts'), 'utf8')
const cmdOf = new Map()
for (const m of src.matchAll(/\{\s*name:\s*'([^']+)'\s*,\s*cmd:\s*'([^']+)'/g)) cmdOf.set(m[1], m[2])

const run = (cmd) => {
  try { execSync(cmd, { cwd: ERP, stdio: 'pipe' }); return 0 }
  catch (e) { return e.status ?? 1 }
}

/** 내 변경분 — 추적 파일은 checkout으로, 신규 파일은 옮겨서 뺀다 */
const TRACKED = [
  'src/components/customers/plan-tab-view.tsx',
  'src/app/(dashboard)/customers/[id]/page.tsx',
  'scripts/test-all.mts',
]
const NEW_FILE = resolve(ERP, 'src/lib/fire-plan-sections.ts')
const PARKED = `${NEW_FILE}.parked`

console.log('① 내 변경 그대로(현재) 실행\n')
const withMine = new Map()
for (const n of names) {
  const c = cmdOf.get(n)
  if (!c) { console.log(`  ? ${n} — test-all에 없는 이름`); continue }
  const code = run(c)
  withMine.set(n, code)
  console.log(`  ${code ? 'FAIL' : 'ok  '}  ${n}`)
}

console.log('\n② 내 변경을 걷어내고(순정 origin/main) 실행\n')
// 🚨 되돌리기 **전에** 내용을 메모리에 뜬다. `git checkout`은 되돌리기만 하고 돌려주지 않는다 —
//   이걸 안 하면 대조군을 재는 대가로 내 작업이 사라진다(이 스크립트를 처음 쓸 때 실제로 그랬다).
const backup = new Map(TRACKED.map(p => [p, readFileSync(resolve(ERP, p), 'utf8')]))
execFileSync('git', ['checkout', '--', ...TRACKED], { cwd: ERP, stdio: 'pipe' })
if (existsSync(NEW_FILE)) renameSync(NEW_FILE, PARKED)

const clean = new Map()
try {
  for (const n of names) {
    const c = cmdOf.get(n)
    if (!c) continue
    const code = run(c)
    clean.set(n, code)
    console.log(`  ${code ? 'FAIL' : 'ok  '}  ${n}`)
  }
} finally {
  // 🚨 무슨 일이 있어도 되돌린다 — `finally`에 두는 이유가 이것이다(검사가 던져도 복원된다)
  if (existsSync(PARKED)) renameSync(PARKED, NEW_FILE)
  for (const [p, body] of backup) writeFileSync(resolve(ERP, p), body, 'utf8')
  console.log('\n③ 내 변경 복원 완료 — 아래 대조로 확인한다')
  const restored = TRACKED.every(p => readFileSync(resolve(ERP, p), 'utf8') === backup.get(p))
  console.log(`   추적 파일 ${TRACKED.length}개 원상복구: ${restored ? '✔' : '🚨 불일치 — 손으로 확인할 것'}`)
  console.log(`   신규 파일 복원: ${existsSync(NEW_FILE) ? '✔' : '🚨 없다'}`)
}

console.log('\n=== 귀속 ===')
for (const n of names) {
  if (!cmdOf.has(n)) continue
  const a = withMine.get(n), b = clean.get(n)
  const verdict = a && b ? '선재 결함(내 것 아님)'
    : a && !b ? '🚨 내가 깨뜨렸다'
    : !a && b ? '내가 고쳤다(?)'
    : '둘 다 초록'
  console.log(`  ${verdict}\t${n}`)
}
