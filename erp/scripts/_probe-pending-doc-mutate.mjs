/** 변이 프로브 — test-pending-doc-intent가 **실제로 무는가**.
 *
 *  왜 필요한가: 이 저장소는 「소스에 문자열이 있는가」만 묻는 단언이 값이 빈 채로도, 배선이
 *  끊긴 채로도 초록이던 사고를 여러 번 겪었다(39 M7·45 M9/M11·48). 단언을 믿으려면 제품을
 *  일부러 부수고 **빨강이 되는지** 봐야 한다.
 *
 *  🚨 치환은 node로 한다. PowerShell로 소스를 읽고 쓰면 UTF-8이 CP949로 깨진다(같은 함정 4회).
 *  🚨 **치환 건수를 단언한다.** CRLF·공백 차이로 0건 치환이 일어나면 제품이 멀쩡한 채로
 *     검사가 돌아 「변이가 살아남았다」는 거짓 경보가 된다(46·43 실사고).
 *  🚨 복원은 finally에서. 중간에 죽으면 제품 소스가 부서진 채 남는다.
 *
 *  실행: node scripts/_probe-pending-doc-mutate.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'src/lib/pending-doc-intent.ts')
const CARD = join(ROOT, 'src/components/customers/plan-annex-round-card.tsx')

/** [이름, 파일, 찾을 것, 바꿀 것, 기대 치환 건수] — 하나하나가 「이 결함이 나면 빨강인가」다 */
const MUTANTS = [
  // ── 쪽지 규칙 축
  ['M1 one-shot 해제 (소비해도 안 지운다 → 유령 발행)', LIB,
    "  try { store.removeItem(PENDING_DOC_KEY) } catch { /* 못 지우면 TTL이 두 번째 방어선이다 */ }\n  return d.kind",
    "  return d.kind", 1],
  ['M2 TTL 무력화 (영영 안 만료 → 다음 방문에 유령 발행)', LIB,
    '  return age < 0 || age >= PENDING_DOC_TTL_MS',
    '  return false', 1],
  ['M3 시계 되감김 통과 (미래 쪽지가 영원히 산다)', LIB,
    '  return age < 0 || age >= PENDING_DOC_TTL_MS',
    '  return age >= PENDING_DOC_TTL_MS', 1],
  ['M4 남의 쪽지도 버린다 (그 회차가 의도를 잃는다)', LIB,
    '  if (d.inspectionId !== inspectionId) return null',
    '  if (d.inspectionId !== inspectionId) { try { store.removeItem(PENDING_DOC_KEY) } catch {} ; return null }', 1],
  ['M5 kind 검증 해제 (모르는 종류를 발행 의도로 읽는다)', LIB,
    "  if (kind !== 'xlsx' && kind !== 'bundle') return null",
    '  if (typeof kind !== \'string\') return null', 1],
  ['M6 부서진 쪽지를 안 치운다 (매 방문 재파싱)', LIB,
    "    try { store.removeItem(PENDING_DOC_KEY) } catch { /* 지우기 실패는 다음 방문에 다시 시도된다 */ }\n    return null",
    '    return null', 1],
  ['M7 write가 저장소 예외를 안 삼킨다 (사생활 모드에서 화면이 죽는다)', LIB,
    '    store.setItem(PENDING_DOC_KEY, JSON.stringify(d))\n  } catch {',
    '    store.setItem(PENDING_DOC_KEY, JSON.stringify(d))\n    if (1) throw new Error(\'mut\')\n  } catch (e) { if (String(e).includes(\'mut\')) throw e;', 1],

  // ── 배선 축 (★ 값이 옳아도 호출부가 없으면 아무 일도 안 일어난다)
  ['M8 쪽지를 안 적고 나간다 (종전 결함 그대로 재발)', CARD,
    '      writePendingDoc(inspectionId, kind, Date.now())\n',
    '', 1],
  ['M9 쪽지를 이동 **뒤**에 적는다 (그 줄은 실행되지 않는다)', CARD,
    '      writePendingDoc(inspectionId, kind, Date.now())\n      window.location.assign(',
    '      window.location.assign(', 1],
  ['M10 복귀해도 쪽지를 소비하지 않는다', CARD,
    '    const kind = takePendingDoc(id, Date.now())',
    '    const kind = null', 1],
  ['M11 자동 실행이 가드를 다시 건다 (팝업 왕복 부활)', CARD,
    '    if (!opts?.skipGuard && !blanksGuardThenGo(inspectionId, \'xlsx\')) return',
    '    if (!blanksGuardThenGo(inspectionId, \'xlsx\')) return', 1],
  ['M12 인쇄까지 자동 실행 (window.open이 조용히 차단된다)', CARD,
    "    if (kind === 'xlsx') void downloadWorkbook(id, { skipGuard: true })",
    '    void downloadWorkbook(id, { skipGuard: true })', 1],
  ['M13 막혔을 때의 보장 경로(배너)를 없앤다', CARD,
    'data-testid="round-resume-banner"', 'data-testid="x"', 1],
  ['M14 가드가 kind를 안 받는다 (무엇을 하려던 건지 잃는다)', CARD,
    '  function blanksGuardThenGo(inspectionId: string, kind: PendingDocKind): boolean {',
    '  function blanksGuardThenGo(inspectionId: string): boolean {\n    const kind = \'xlsx\' as PendingDocKind', 1],
]

function runTest() {
  try {
    execFileSync('npx', ['tsx', 'scripts/test-pending-doc-intent.mts'],
      { cwd: ROOT, stdio: 'pipe', shell: process.platform === 'win32' })
    return 0
  } catch (e) {
    return e.status ?? 1
  }
}

const originals = new Map()
for (const f of new Set(MUTANTS.map(m => m[1]))) originals.set(f, readFileSync(f, 'utf8'))

let killed = 0, survived = 0, skipped = 0
try {
  console.log('— 대조군: 변이 없이 초록이어야 한다')
  const base = runTest()
  if (base !== 0) {
    console.log('  ❌ 대조군이 이미 빨강이다 — 변이 판정이 무의미하다. 먼저 제품을 고칠 것')
    process.exit(1)
  }
  console.log('  ✅ 대조군 초록\n')

  for (const [name, file, rawFind, rawRepl, wantCount] of MUTANTS) {
    const src = originals.get(file)
    // 🚨 줄끝을 **파일에 맞춘다**. 이 저장소 소스는 CRLF인데 앵커를 `\n`으로 쓰면 0건 치환이
    //    되고, 그러면 제품이 멀쩡한 채 검사가 돌아 「변이 생존」이라는 거짓 경보가 난다
    //    (2026-09-21 실측 — M8·M9가 정확히 이 이유로 0건이었다). 건수 단언이 그걸 잡았다.
    const crlf = src.includes('\r\n')
    const find = crlf ? rawFind.replace(/\n/g, '\r\n') : rawFind
    const repl = crlf ? rawRepl.replace(/\n/g, '\r\n') : rawRepl
    const count = src.split(find).length - 1
    if (count !== wantCount) {
      // 🚨 0건 치환은 「변이가 살아남았다」가 아니라 **변이를 안 돌린 것**이다. 실패로 친다.
      console.log(`  ❌ ${name} — 치환 ${count}건(기대 ${wantCount}) · 앵커가 낡았다`)
      skipped++
      continue
    }
    writeFileSync(file, src.split(find).join(repl), 'utf8')
    const code = runTest()
    writeFileSync(file, src, 'utf8')
    if (code !== 0) { killed++; console.log(`  ✅ ${name} — 빨강 (검사가 물었다)`) }
    else { survived++; console.log(`  ❌ ${name} — **생존** (검사가 못 물었다)`) }
  }
} finally {
  for (const [f, src] of originals) writeFileSync(f, src, 'utf8')
}

console.log(`\n${survived === 0 && skipped === 0 ? '✅' : '❌'} 변이 ${killed}/${MUTANTS.length} 사살 · 생존 ${survived} · 앵커실패 ${skipped}`)
process.exit(survived === 0 && skipped === 0 ? 0 : 1)
