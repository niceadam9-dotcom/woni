/** 변이 프로브 — `test-fire-plan-sections.mts`가 **실제로 무는지** 증명한다.
 *
 *  검사가 초록인 것만으로는 아무것도 증명되지 않는다. 이 저장소는 「모양만 보는 단언」이
 *  값이 빈 채로도 초록이 되는 것을 여러 번 겪었다. 그래서 제품을 일부러 망가뜨려
 *  **각 변이마다 반드시 빨강이 되는지**를 본다.
 *
 *  🚨 치환이 0건이면 **실패로 친다**. CRLF·따옴표 차이로 조용히 안 바뀌면 「변이했는데 초록」이
 *    되어 정반대 결론을 내리게 된다(이 저장소가 CRLF로 두 번, perl 보간으로 한 번 당했다).
 *
 *  실행: node scripts/_mutate-sections.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SECTIONS = resolve(HERE, '../src/lib/fire-plan-sections.ts')
const TEST = resolve(HERE, 'test-fire-plan-sections.mts')

/** 변이: [이름, 대상파일, 찾을 문자열, 바꿀 문자열, 기대 치환 건수] */
const MUTANTS = [
  ['M1 시트 한 장을 대장에서 지운다 → 적재 검증(역방향)이 이름을 대며 터져야',
    SECTIONS, `  { sheet: '2.8 비상상황별 연락방법', form: 'ch2' },\n`, '', 1],
  ['M2 딥링크 키 1.10을 목차에서 지운다 → [2] 키 보존이 빨강이어야',
    SECTIONS, `  { key: '1.10', label: '1.10 자체점검', group: '본문 1장' },\n`, '', 1],
  ['M3 표지를 cover 노드로 보낸다 → [4] 교차 배정이 빨강이어야',
    SECTIONS, `{ sheet: '표지', form: '1.1' }`, `{ sheet: '표지', form: 'cover' }`, 1],
  ['M4 1.9.3 입주사를 번호대로 ch2에 보낸다 → [4]가 빨강이어야',
    SECTIONS, `{ sheet: '1.9.3 입주사 현황', form: '1.2' }`, `{ sheet: '1.9.3 입주사 현황', form: 'ch2' }`, 1],
  ['M5 1장 목차 순서를 뒤집는다 → [2] 순서 단언이 빨강이어야',
    SECTIONS, `  { key: '1.2', label: '1.2 세부현황', group: '본문 1장' },\n  { key: '1.3', label: '1.3 위치·소방차진입', group: '본문 1장' },\n`,
    `  { key: '1.3', label: '1.3 위치·소방차진입', group: '본문 1장' },\n  { key: '1.2', label: '1.2 세부현황', group: '본문 1장' },\n`, 1],
  ['M6 없는 카드 앵커를 주장한다 → [6]이 빨강이어야',
    SECTIONS, `{ sheet: '2.1 자위소방대 일반현황', form: 'ch2' }`, `{ sheet: '2.1 자위소방대 일반현황', form: 'ch2', card: 'c-2.1' }`, 1],
  ['M7 archive를 완성도 분모에 넣는다 → [2] 분모 단언이 빨강이어야',
    SECTIONS, `.filter((k): k is FirePlanStatusKey => k !== 'archive')`,
    `.filter((k): k is FirePlanStatusKey => true || k !== 'archive')`, 1],
  ['M8 exempt 사유를 빈 문자열로 둔다 → 적재 검증 ⑥이 터져야',
    SECTIONS, `{ sheet: '2.4 개별임무카드', form: 'ch2' }`, `{ sheet: '2.4 개별임무카드', form: 'ch2', exempt: '  ' }`, 1],
  // 같은 카드를 **다른 노드**에 매단다 — Map이 마지막 것만 답해 딥링크가 조용히 엉뚱해지는 자리
  ['M9 카드 c-1.14를 두 노드에 건다 → 적재 검증 ⑦이 터져야',
    SECTIONS, `{ sheet: '1.14.2 화재예방 및 홍보 결과', form: '1.12', card: 'c-1.14' }`,
    `{ sheet: '1.14.2 화재예방 및 홍보 결과', form: '1.11', card: 'c-1.14' }`, 1],
]

const runTest = () => {
  try {
    execFileSync('npx', ['tsx', TEST], { cwd: resolve(HERE, '..'), stdio: 'pipe', shell: true })
    return 0
  } catch (e) { return e.status ?? 1 }
}

// 대조군 — 손대기 전에 초록이어야 변이 결과가 뜻을 갖는다
const base = runTest()
console.log(`대조군(무변이): exit ${base} ${base === 0 ? '✔ 초록' : '✘ 이미 빨강 — 변이 결과를 못 믿는다'}`)
if (base !== 0) process.exit(1)

let caught = 0
for (const [label, file, find, repl, expectHits] of MUTANTS) {
  const orig = readFileSync(file, 'utf8')
  const hits = orig.split(find).length - 1
  if (hits !== expectHits) {
    console.log(`  ✘ ${label}\n      🚨 치환 대상 ${hits}건(기대 ${expectHits}) — 변이가 안 돌았다. 실패로 친다`)
    continue
  }
  writeFileSync(file, orig.split(find).join(repl), 'utf8')
  const code = runTest()
  writeFileSync(file, orig, 'utf8')
  const ok = code !== 0
  if (ok) caught++
  console.log(`  ${ok ? '✔' : '✘'} ${label}  (exit ${code})`)
}

console.log(`\n=== 변이 ${caught}/${MUTANTS.length} 잡음 ===`)
process.exit(caught === MUTANTS.length ? 0 : 1)
