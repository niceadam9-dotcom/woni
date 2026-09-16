/** 변이 프로브 — `test-fire-plan-preview.mts`가 **실제로 무는지** 증명한다.
 *
 *  리더는 「그럴듯하게 틀리기」가 쉬운 부류다(테두리를 전부 none으로 읽어도 SheetJS 교차검증은
 *  초록이다 — 그쪽이 테두리를 모르니까). 그래서 축마다 하나씩 망가뜨려 **각각 다른 단언이**
 *  잡는지 본다.
 *
 *  🚨 치환 0건은 **실패로 친다**(CRLF·따옴표 차이로 조용히 안 바뀌면 「변이했는데 초록」이 된다).
 *
 *  실행: node scripts/_mutate-preview.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const READER = resolve(HERE, '../src/lib/xlsx-read-sheet.ts')
const TEST = resolve(HERE, 'test-fire-plan-preview.mts')

const MUTANTS = [
  ['M1 테두리를 전부 none으로 읽는다 → [2]·[5]가 빨강이어야 (SheetJS는 이 축을 모른다)',
    READER, `    return (st?.[1] as BorderKind) ?? 'none'`, `    return 'none'`, 1],
  ['M2 채움을 늘 null로 읽는다 → [2]·[5]가 빨강이어야',
    READER, `  if (!/patternType="solid"/.test(xml)) return null`, `  return null\n  if (!/patternType="solid"/.test(xml)) return null`, 1],
  ['M3 병합을 안 읽는다 → [1]·[2]가 빨강이어야',
    READER, `  const merges = [...xml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m => m[1])`,
    `  const merges: string[] = []`, 1],
  ['M4 열 번호를 한 칸 민다 → [1]이 빨강이어야',
    READER, `  return n - 1`, `  return n`, 1],
  ['M5 xml 실체 참조를 안 푼다 → [2] 글자 단언이 빨강이어야(픽스처에 <&>가 있다)',
    READER, `        text: t ? unescXml(t[1]) : '',`, `        text: t ? t[1] : '',`, 1],
  ['M6 덮인 칸 표식을 안 세운다 → [2] covered/span 단언이 빨강이어야',
    READER, `        covered.set(\`\${r}:\${c}\`, a)`, `        void a`, 1],
  ['M7 행 높이를 늘 0으로 읽는다 → [1]·[2]가 빨강이어야',
    READER, `    rowHeights[r] = Number(/ht="([\\d.]+)"/.exec(attrs)?.[1] ?? 0)`, `    rowHeights[r] = 0`, 1],
  ['M8 정렬을 늘 center로 읽는다 → [2]·[5]가 빨강이어야',
    READER, `    const align = (/horizontal="(left|center|right)"/.exec(xf)?.[1] as HAlign) ?? 'left'`,
    `    const align = 'center' as HAlign`, 1],
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
  try { execFileSync('npx', ['tsx', TEST], { cwd: resolve(HERE, '..'), stdio: 'pipe', shell: true }); return 0 }
  catch (e) { return e.status ?? 1 }
}

const base = runTest()
console.log(`대조군(무변이): exit ${base} ${base === 0 ? '✔ 초록' : '✘ 이미 빨강 — 변이 결과를 못 믿는다'}`)
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
