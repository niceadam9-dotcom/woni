/** 변이 프로브 — `test-cover-title-font.mts`가 **정말 무는가**.
 *
 *  🚨 모양만 보는 단언은 값이 빈 채로도 초록이다. 그래서 제품 소스를 한 군데씩 일부러
 *  망가뜨리고 템플릿을 다시 빌드해, 검사가 **빨강이 되는지** 본다. 초록이면 그 축은 안 물린
 *  것이다(검사를 고쳐야 한다). 변이는 반드시 원복한다 — 실패해도 finally에서.
 *
 *  실행: node scripts/_mutate-cover-title.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const BUILDER = resolve(ROOT, 'scripts/build-fire-plan-template.mts')

/** 치환 — 원문에 **정확히 한 번** 있어야 한다. 0건 치환이 조용히 «초록»으로 새는 걸 막는다. */
const MUTANTS = [
  {
    id: 'M1', why: '표지 배너에서 title 표식을 뗀다 → 좌정렬·본문 10pt로 되돌아간다',
    from: "{ kind: 'banner', table: 1, title: true }",
    to: "{ kind: 'banner', table: 1 }",
  },
  {
    id: 'M2', why: '제목 크기를 본문과 같은 10pt로 → 「32pt 한 벌」이 깨진다',
    from: "{ name: 'HY헤드라인M', sizePt: 32 }",
    to: "{ name: 'HY헤드라인M', sizePt: 10 }",
  },
  {
    id: 'M3', why: '제목 글꼴을 전 배너에 바른다 → 표지 3행 밖으로 샌다',
    from: 'const style: CellStyle = isTitle ? { ...base, font: COVER_TITLE_FONT } : base',
    to: 'const style: CellStyle = { ...base, font: COVER_TITLE_FONT }',
  },
  {
    id: 'M4', why: '제목을 좌정렬로 되돌린다 → 「가운데」가 깨진다',
    from: "isTitle ? 'center' : 'left'",
    to: "'left'",
  },
]

const original = readFileSync(BUILDER, 'utf8')
const run = (cmd, args) => {
  try { execFileSync(cmd, args, { cwd: ROOT, stdio: 'pipe', shell: true }); return 0 }
  catch (e) { return e.status ?? 1 }
}

let killed = 0
try {
  for (const m of MUTANTS) {
    const hits = original.split(m.from).length - 1
    if (hits !== 1) { console.log(`${m.id} ✘ 앵커가 ${hits}건 — 0건 치환은 실패로 친다`); continue }
    writeFileSync(BUILDER, original.split(m.from).join(m.to))

    const built = run('npx', ['tsx', 'scripts/build-fire-plan-template.mts'])
    // 빌드 자체가 서면 그것도 «잡았다»(게이트가 먼저 문 것)
    const code = built !== 0 ? built : run('npx', ['tsx', 'scripts/test-cover-title-font.mts'])
    const dead = code !== 0
    if (dead) killed++
    console.log(`${m.id} ${dead ? '🔴 잡힘' : '🟢 생존'}  ${m.why}${built !== 0 ? ' (빌드가 섰다)' : ''}`)

    writeFileSync(BUILDER, original)
  }
} finally {
  writeFileSync(BUILDER, original)
  run('npx', ['tsx', 'scripts/build-fire-plan-template.mts'])   // 원본 산출물 복구
}

console.log(`\n변이 ${killed}/${MUTANTS.length}`)
process.exit(killed === MUTANTS.length ? 0 : 1)
