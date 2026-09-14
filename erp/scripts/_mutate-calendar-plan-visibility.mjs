// 변이 실험 — test-calendar-plan-visibility.mts가 **정말로 무는가**.
// 제품을 한 군데씩 되돌려 놓고 검사가 빨강이 되는지 본다. 초록으로 통과하는 변이가 있으면
// 그 축은 단언되지 않은 것이다(대조군 대조는 "무언가를 잡는다"만 보여줄 뿐이라서).
//
// 🚨 치환이 한 줄도 안 되면(CRLF·공백 드리프트) 조용히 "통과"로 보인다 → 치환 건수를 세고
//    1건이 아니면 그 자리에서 실패로 친다.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const LIB    = 'src/lib/calendar-chips.ts'
const PAGE   = 'src/app/(dashboard)/inspections/calendar/page.tsx'
const CLIENT = 'src/components/inspections/inspection-calendar-client.tsx'

const MUTANTS = [
  { id: 'M1', why: '검색 축 제거 — 검색 중에도 뭉친다(지평리56 ① 재현)', file: LIB,
    from: 'opts.searching || rows.length <= PLAN_CHIP_NAME_MAX', to: 'rows.length <= PLAN_CHIP_NAME_MAX' },
  { id: 'M2', why: '상한 0 — 1건짜리 날도 집계 칩으로 가린다', file: LIB,
    from: 'export const PLAN_CHIP_NAME_MAX = 3', to: 'export const PLAN_CHIP_NAME_MAX = 0' },
  { id: 'M3', why: '자체점검도 날짜별로 뭉친다 (건별 규약 파기)', file: LIB,
    from: "if (p.plan_type !== 'monthly') { individuals.push(p); continue }",
    to:   "if (p.plan_type === 'event') { individuals.push(p); continue }" },
  { id: 'M4', why: '상한을 사실상 무한대로 — 늘 편다(집계 폭발 방지 소멸)', file: LIB,
    from: 'rows.length <= PLAN_CHIP_NAME_MAX', to: 'rows.length <= 9999' },
  { id: 'M5', why: '펼 때 첫 건만 싣는다 — 나머지 칩이 조용히 증발', file: LIB,
    from: 'individuals.push(...rows)', to: 'individuals.push(rows[0])' },
  { id: 'M6', why: '서버가 자체점검 계획을 안 싣는다 (지평리56 ② 재현)', file: PAGE,
    from: ".in('plan_type', ['monthly', 'event', 'special_종합', 'special_작동'])",
    to:   ".in('plan_type', ['monthly', 'event'])" },
  { id: 'M7', why: '시작된 자체점검 중복 제거를 끈다 (같은 날 두 번 그려짐)', file: PAGE,
    from: '&& p.inspection_id) return []', to: '&& false) return []' },
  { id: 'M8', why: '화면이 검색 상태를 안 넘긴다 — 규칙은 옳은데 배선이 죽음', file: CLIENT,
    from: 'searching: Boolean(custQuery)', to: 'searching: false' },
  { id: 'M9', why: '종합 탭이 자체점검 계획을 다시 버린다', file: CLIENT,
    from: "calMode === 'comp' && p.plan_type !== 'special_종합'",
    to:   "calMode === 'comp' && p.plan_type !== 'monthly'" },
]

const runTest = () => {
  try {
    execFileSync('npx', ['tsx', 'scripts/test-calendar-plan-visibility.mts'],
      { stdio: 'pipe', shell: true })
    return 0
  } catch (e) { return e.status ?? 1 }
}

// 대조군 — 손대기 전에 초록이어야 실험이 성립한다
if (runTest() !== 0) {
  console.log('❌ 대조군이 이미 빨강이다 — 변이 실험이 성립하지 않는다')
  process.exit(1)
}
console.log('대조군: 초록 ✅\n')

let caught = 0, escaped = 0
for (const m of MUTANTS) {
  const orig = readFileSync(m.file, 'utf8')
  const hits = orig.split(m.from).length - 1
  if (hits !== 1) {
    console.log(`  ❌ ${m.id} 치환 실패 — 앵커가 ${hits}곳 (1곳이어야 한다): ${m.why}`)
    escaped++
    continue
  }
  writeFileSync(m.file, orig.replace(m.from, m.to))
  const rc = runTest()
  writeFileSync(m.file, orig)
  if (rc !== 0) { caught++; console.log(`  ✅ ${m.id} 잡힘 (빨강) — ${m.why}`) }
  else { escaped++; console.log(`  ❌ ${m.id} **빠져나감 (초록)** — ${m.why}`) }
}

console.log(`\n변이 결과: ${caught}/${MUTANTS.length} 잡힘, ${escaped} 빠져나감`)
process.exit(escaped > 0 ? 1 : 0)
