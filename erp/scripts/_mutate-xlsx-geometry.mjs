/** 변이 프로브 — 격자 환산이 틀어지면 **누가 잡는가**.
 *
 *  🚨 이 축은 2026-09-21까지 **아무도 안 잡았다**. 제품과 검사가 같은 틀린 산식을 각자 들고
 *  있어서, 표지 사진이 160px 밀려 나가는 동안 「그림이 상자 안에서 가운데」가 초록이었다.
 *  한 벌로 합친 지금은 그 산식을 되돌리면 빨강이 되어야 한다 — 그걸 여기서 실증한다.
 *
 *  실행: node scripts/_mutate-xlsx-geometry.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const GEO = resolve(ROOT, 'src/lib/xlsx-geometry.ts')

const MUTANTS = [
  { id: 'M1', why: '🎯 옛 산식으로 되돌린다(열마다 +5px) — 이번에 고친 결함 그대로',
    from: '  return Math.floor(((256 * width + Math.floor(128 / MDW)) / 256) * MDW)',
    to: '  return Math.round(width * MDW + 5)' },
  { id: 'M2', why: 'MDW를 흔든다 — 상자 폭이 통째로 어긋난다',
    from: 'const MDW = 7', to: 'const MDW = 9' },
  { id: 'M3', why: '행 높이 환산을 흔든다 — 그림이 세로로 어긋난다',
    from: '  return Math.round(pt * 4 / 3)', to: '  return Math.round(pt * 5 / 3)' },
]

const original = readFileSync(GEO, 'utf8')
let killed = 0
try {
  for (const m of MUTANTS) {
    const hits = original.split(m.from).length - 1
    if (hits !== 1) { console.log(`${m.id} ✘ 앵커 ${hits}건 — 0건 치환은 실패로 친다`); continue }
    writeFileSync(GEO, original.split(m.from).join(m.to))
    let code = 0
    try {
      execFileSync('npx', ['tsx', '--conditions=react-server', 'scripts/test-xlsx-geometry.mts'],
        { cwd: ROOT, stdio: 'pipe', shell: true })
    } catch (e) { code = e.status ?? 1 }
    const dead = code !== 0
    if (dead) killed++
    console.log(`${m.id} ${dead ? '🔴 잡힘' : '🟢 생존'}  ${m.why}`)
    writeFileSync(GEO, original)
  }
} finally { writeFileSync(GEO, original) }

console.log(`\n변이 ${killed}/${MUTANTS.length}`)
process.exit(killed === MUTANTS.length ? 0 : 1)
