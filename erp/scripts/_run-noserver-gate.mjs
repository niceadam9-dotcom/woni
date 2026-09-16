/** 무서버 게이트만 실행 — `test-all.mts`의 단계 목록에서 `needServer`가 **없는** 것만 고른다.
 *
 *  🚨 왜 `test-all`을 그냥 안 돌리나: E2E는 `localhost:3000`을 친다. 지금 그 포트엔 **다른
 *    세션의 공유 트리 dev 서버**가 떠 있어서, 돌리면 *내 코드가 아닌 것*을 검사한다.
 *    그건 초록이든 빨강이든 내 변경에 대해 아무것도 말해 주지 않는다(이 저장소가 한 번
 *    「판정을 dev 서버=공유 트리에 대고」 해서 거짓을 푸시한 적이 있다).
 *
 *  ⚠ 이건 `test-all`의 **대체가 아니라 부분집합**이다. 커밋 전 E2E는 내 워크트리에서 띄운
 *    서버에 대고 따로 봐야 한다.
 *
 *  실행: node scripts/_run-noserver-gate.mjs
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ERP = resolve(HERE, '..')
const src = readFileSync(resolve(HERE, 'test-all.mts'), 'utf8')

// `{ name: '…', cmd: '…' , needServer?: true }` 한 줄 단위로 읽는다
const steps = []
for (const m of src.matchAll(/\{\s*name:\s*'([^']+)'\s*,\s*cmd:\s*'([^']+)'([^}]*)\}/g)) {
  const [, name, cmd, rest] = m
  if (/needServer\s*:\s*true/.test(rest)) continue
  steps.push({ name, cmd })
}

if (steps.length === 0) { console.error('🚨 단계를 하나도 못 읽었다 — 파서가 틀렸다'); process.exit(1) }
console.log(`무서버 단계 ${steps.length}개\n`)

const fails = []
for (const [i, s] of steps.entries()) {
  process.stdout.write(`[${String(i + 1).padStart(2)}/${steps.length}] ${s.name} … `)
  try {
    execSync(s.cmd, { cwd: ERP, stdio: 'pipe' })
    console.log('ok')
  } catch (e) {
    console.log('FAIL')
    fails.push({ name: s.name, cmd: s.cmd, tail: String(e.stdout ?? '').split('\n').slice(-6).join('\n') })
  }
}

console.log(`\n=== 무서버 게이트: ${steps.length - fails.length} 통과 / ${fails.length} 실패 ===`)
for (const f of fails) console.log(`\n✘ ${f.name}\n   ${f.cmd}\n${f.tail}`)
process.exit(fails.length ? 1 : 0)
