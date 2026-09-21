/** 변이 프로브 — `test-workbook-label.mts`가 정말 무는가.
 *
 *  🚨 이 검사는 「글씨가 있는가」가 아니라 「이름이 **한 벌인가**」를 묻는다. 그 주장이 진짜로
 *  물리는지 보려면, 단일성을 깨는 방향으로 일부러 망가뜨려 봐야 한다 — 특히 M3(칩이 자기 글씨를
 *  직접 적는 부활)는 **이 결함이 처음 생긴 방식 그대로**라 여기서 안 잡히면 검사가 무의미하다.
 *
 *  실행: node scripts/_mutate-workbook-label.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const BTN = resolve(ROOT, 'src/components/inspections/workbook-xlsx-button.tsx')
const CHIP = resolve(ROOT, 'src/components/customers/plan-annex-round-card.tsx')

const MUTANTS = [
  { id: 'M1', file: BTN, why: '라벨 값을 옛 「엑셀」로 되돌린다',
    from: "export const WORKBOOK_LABEL = '보고서 엑셀'", to: "export const WORKBOOK_LABEL = '엑셀'" },
  { id: 'M2', file: BTN, why: 'default 표면만 옛 「엑셀로 받기」로 되돌린다(한 표면만 갈라지는 부류)',
    from: '<FileSpreadsheet className="size-3" />} {WORKBOOK_LABEL}', to: '<FileSpreadsheet className="size-3" />} 엑셀로 받기' },
  { id: 'M3', file: CHIP, why: '🎯 칩이 상수 대신 **자기 글씨를 직접 적는다** — 결함이 처음 생긴 방식',
    from: '{WORKBOOK_LABEL}', to: "{'보고서 엑셀'}" },
  { id: 'M4', file: BTN, why: '잘리는 고정 폭을 되살린다',
    from: 'className="inline-flex h-6 items-center justify-center gap-1 px-2 rounded',
    to: 'className="inline-flex h-6 w-[2.6rem] items-center justify-center gap-1 rounded' },
]

const backup = new Map([[BTN, readFileSync(BTN, 'utf8')], [CHIP, readFileSync(CHIP, 'utf8')]])
const restore = () => { for (const [f, s] of backup) writeFileSync(f, s) }

let killed = 0
try {
  for (const m of MUTANTS) {
    const src = backup.get(m.file)
    const hits = src.split(m.from).length - 1
    if (hits !== 1) { console.log(`${m.id} ✘ 앵커 ${hits}건 — 0건 치환은 실패로 친다`); continue }
    writeFileSync(m.file, src.split(m.from).join(m.to))
    let code = 0
    try { execFileSync('npx', ['tsx', 'scripts/test-workbook-label.mts'], { cwd: ROOT, stdio: 'pipe', shell: true }) }
    catch (e) { code = e.status ?? 1 }
    const dead = code !== 0
    if (dead) killed++
    console.log(`${m.id} ${dead ? '🔴 잡힘' : '🟢 생존'}  ${m.why}`)
    restore()
  }
} finally { restore() }

console.log(`\n변이 ${killed}/${MUTANTS.length}`)
process.exit(killed === MUTANTS.length ? 0 : 1)
