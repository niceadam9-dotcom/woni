/** 서식 1.4 배선 — 변이 프로브 (2026-09-14)
 *
 *  🚨 초록은 '물린다'는 증거가 아니다. 제품을 되돌리는 변이를 넣고 검사가 **빨개지는지** 본다.
 *     니들이 원문에 없으면 **건너뛰지 않고 실패로 친다**(CRLF·리팩터로 조용히 안 도는 부류).
 *
 *  실행: node scripts/_probe-form14-mutants.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const P = (p) => resolve(HERE, '..', p)

const VALUES = P('src/lib/fire-plan-xlsx-values.ts')
const ANCHORS = P('src/lib/fire-plan-anchors.ts')

/** [이름, 파일, 찾을 문자열, 바꿀 문자열, 기대] */
const MUTANTS = [
  ['M1 배선 제거 — 체크 루프를 통째로 끈다', VALUES,
    `    v.set(r.field, boxLabelCell(FORM14_SHEET, r.cell, facSet.has(r.code.replace(/\\s+/g, ''))))`,
    `    v.set(r.field, boxLabelCell(FORM14_SHEET, r.cell, false))`],

  ['M2 전부 켠다 — 미설치도 체크', VALUES,
    `facSet.has(r.code.replace(/\\s+/g, ''))`,
    `true`],

  ['M3 유도등 좌표를 한 칸 아래로(J19→J20)', ANCHORS,
    `  ['유도등', 'J19'],          ['비상조명등', 'AJ19'],`,
    `  ['유도등', 'J20'],          ['비상조명등', 'AJ19'],`],

  ['M4 우열 AI를 AJ로 착각(AI23→AJ23)', ANCHORS,
    `['비상콘센트설비', 'AI23'],`,
    `['비상콘센트설비', 'AJ23'],`],

  ['M5 표준 코드 한 종을 빠뜨린다(유도등 행 삭제)', ANCHORS,
    `  ['유도등', 'J19'],          ['비상조명등', 'AJ19'],`,
    `  ['비상조명등', 'AJ19'],`],

  ['M6 대상명을 안 채운다', VALUES,
    `  v.set(FORM14_NAME_FIELD, prefixCell(FORM14_SHEET, FORM14_NAME_CELL, d.buildingName))`,
    `  v.set(FORM14_NAME_FIELD, prefixCell(FORM14_SHEET, FORM14_NAME_CELL, ''))`],

  ['M7 자구를 손으로 베껴 덮어쓴다', VALUES,
    `    v.set(r.field, boxLabelCell(FORM14_SHEET, r.cell, facSet.has(r.code.replace(/\\s+/g, ''))))`,
    `    v.set(r.field, (facSet.has(r.code.replace(/\\s+/g, '')) ? '■ ' : '□ ') + r.code)`],
]

const run = () => {
  try {
    const out = execSync('npx tsx scripts/test-fire-plan-xlsx.mts', { cwd: P('.'), encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

const base = run()
console.log(`대조군(변이 없음): exit=${base.code}  ${/=== pass (\d+) \/ fail (\d+) ===/.exec(base.out)?.[0] ?? '(요약 없음)'}`)
if (base.code !== 0) { console.log('🚨 대조군이 이미 빨갛다 — 변이 실험이 성립하지 않는다'); process.exit(1) }

let killed = 0, survived = 0, broken = 0
for (const [name, file, from, to] of MUTANTS) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes(from)) {
    // 🚨 건너뛰지 않는다 — 니들이 안 맞으면 그 변이는 '검증 안 됨'이지 '통과'가 아니다
    console.log(`  BROKEN ${name} — 니들이 원문에 없다(프로브가 낡았다)`)
    broken++
    continue
  }
  writeFileSync(file, src.replace(from, to), 'utf8')
  try {
    const r = run()
    const fails = [...r.out.matchAll(/^ {2}FAIL (.+)$/gm)].map(m => m[1].split(' — ')[0])
    const loadErr = /Error: fire-plan-anchors:/.test(r.out)
    if (r.code !== 0) {
      killed++
      const why = loadErr ? '적재 시점 throw' : `${fails.length}건 빨강: ${fails.slice(0, 3).join(' / ')}`
      console.log(`  killed ${name} — ${why}`)
    } else {
      survived++
      console.log(`  SURVIVED ${name} — 🚨 검사가 이 변이를 못 잡는다`)
    }
  } finally {
    writeFileSync(file, src, 'utf8')
  }
}

// 복원 확인 — 되돌리기에 실패한 채 끝나면 그다음 작업이 전부 오염된다
const after = run()
console.log(`\n복원 후: exit=${after.code}  ${/=== pass (\d+) \/ fail (\d+) ===/.exec(after.out)?.[0] ?? ''}`)
console.log(`\n=== killed ${killed} / survived ${survived} / broken ${broken} (총 ${MUTANTS.length}) ===`)
process.exit(survived === 0 && broken === 0 && after.code === 0 ? 0 : 1)
