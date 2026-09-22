// 변이 프로브 — 「등록했는데 단계가 없다를 없애는」 축(2026-09-22)이 실제로 물리는지 본다.
//
// 이 축의 실패는 **제품이 거짓말하는** 부류다: 계획만 생겼는데 「1~4단계가 생겼습니다」라고
// 말하거나, 반대로 생겼는데 안 생겼다고 말한다. 둘 다 화면상 멀쩡해 보인다.
//
// 🚨 from은 한 줄짜리만 쓴다 — 이 저장소 소스는 CRLF가 섞여 여러 줄 문자열이 조용히 안 맞는다.
//
// 실행: node scripts/_mutate-past-anchor.mjs   (MUT=M3 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const ANCHOR = 'src/lib/plan-anchor.ts'
const START = 'src/lib/inspection-start.ts'
const ACTIONS = 'src/app/(dashboard)/customers/actions.ts'
const FORM = 'src/components/customers/customer-new-client.tsx'
const CLIENT = 'src/components/inspections/inspection-calendar-client.tsx'
const SUITE = 'npx tsx scripts/test-past-anchor.mts'

const MUTANTS = [
  {
    name: 'M1 경계에서 오늘을 뺀다 — 오늘 점검하고 등록하면 계획으로 떨어진다(가장 흔한 흐름)',
    file: ANCHOR,
    from: '  return anchorDate <= today',
    to: '  return anchorDate < today',
    expect: '오늘 → 과거다',
  },
  {
    name: 'M2 늘 과거로 — 미래 등록도 「단계가 생겼다」고 말한다',
    file: ANCHOR,
    from: '  return anchorDate <= today',
    to: '  return true',
    expect: '내일 → 과거가 아니다',
  },
  {
    name: 'M3 서버가 판정식을 다시 인라인한다 — 폼과 서버가 갈릴 문이 열린다',
    file: START,
    from: '  if (!isPastAnchor(anchorDate, todayKst())) return { applied: false }',
    to: '  if (anchorDate > todayKst()) return { applied: false }',
    expect: '서버도 같은 함수를 쓴다',
  },
  {
    name: 'M4 결과를 다시 버린다 — 화면이 「생겼는가」를 알 재료가 없어진다',
    file: ACTIONS,
    from: '  return { anchorApplied: applied.applied, startedInspectionId: applied.inspectionId }',
    to: '  return { anchorApplied: true }',
    expect: '버리지 않고** 돌려준다',
  },
  {
    name: 'M5 createCustomerAction이 값을 안 싣는다 — 폼이 늘 undefined를 받는다',
    file: ACTIONS,
    from: '    anchorApplied: planResult.anchorApplied,',
    to: '',
    expect: 'createCustomerAction이 그 값을 반환한다',
  },
  {
    name: 'M6 미래 경로의 revalidate를 다시 가둔다 — 계획 칩이 바로 안 보인다',
    file: ACTIONS,
    from: "  revalidatePath('/inspections')\n  revalidatePath('/inspections/calendar')\n  revalidatePath('/inspections/sms')\n  return { anchorApplied: applied.applied",
    to: "  if (applied.applied) {\n    revalidatePath('/inspections')\n    revalidatePath('/inspections/calendar')\n    revalidatePath('/inspections/sms')\n  }\n  return { anchorApplied: applied.applied",
    expect: '미래 경로에서도 달력이 revalidate',
  },
  {
    name: 'M7 폼이 서버 값 대신 스스로 판정한다 — 서버의 실제 결과와 어긋난다',
    file: FORM,
    from: '          anchorApplied: result.anchorApplied === true,',
    to: '          anchorApplied: isPastAnchor(form.plan_anchor_date, todayKst()),',
    expect: '폼이 서버 값을 그대로 넘긴다',
  },
  {
    name: 'M8 등록 전 안내를 없앤다 — 미래로 잡고도 단계를 기대하게 된다',
    file: FORM,
    from: '              && !isPastAnchor(form.plan_anchor_date, todayKst()) && (',
    to: '              && false && (',
    expect: '등록 전 안내가 **같은 순수 함수**',
  },
  {
    name: 'M9 달력 띠가 한 갈래만 말한다 — 계획인데 「단계가 생겼다」',
    file: CLIENT,
    from: '              {created.anchorApplied ? (',
    to: '              {true ? (',
    expect: '서버 값으로 두 갈래를 가른다',
  },
  {
    name: 'M10 [1단계 열기]가 화면을 떠난다 — 「달력에 머문다」가 깨진다',
    file: CLIENT,
    from: '                  onClick={() => { setSelectedInspectionId(created.startedInspectionId!); setStepError(null) }}',
    to: "                  onClick={() => { router.push(`/inspections/${created.startedInspectionId}`) }}",
    expect: '화면을 떠나지 않고',
  },
]

const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only)) : MUTANTS
if (only && TARGETS.length === 0) throw new Error(`MUT=${only} 에 맞는 변이가 없다`)

let caught = 0
for (const m of TARGETS) {
  const original = readFileSync(m.file, 'utf8')
  try {
    if (!original.includes(m.from)) {
      throw new Error(`치환 대상을 못 찾음 (${m.file}) — 변이가 적용되지 않았다:\n${m.from}`)
    }
    const mutated = original.replace(m.from, m.to)
    if (mutated === original) throw new Error(`0건 치환 — 변이가 안 먹었다: ${m.name}`)
    writeFileSync(m.file, mutated)

    let out = '', failed = false
    try {
      out = execSync(SUITE, { encoding: 'utf8', stdio: 'pipe' })
    } catch (err) {
      failed = true
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
    const red = out.split('\n').filter(l => l.includes('❌'))
    const hit = red.some(l => l.includes(m.expect))
    if (failed && hit) {
      caught++
      console.log(`✅ ${m.name}\n     → 빨강: ${red.map(l => l.trim()).slice(0, 3).join(' | ')}`)
    } else if (failed) {
      console.log(`⚠️  ${m.name}\n     → 빨강이긴 한데 의도한 단언이 아니다(기대: "${m.expect}")\n     → ${red.map(l => l.trim()).slice(0, 3).join(' | ') || '(❌ 줄 없음 — 스위트가 중간에 죽었다)'}`)
    } else {
      console.log(`❌ ${m.name}\n     → 제품을 되돌렸는데 스위트가 초록이다 — 이 축을 무는 단언이 없다`)
    }
  } finally {
    writeFileSync(m.file, original)
  }
}

console.log(`\n변이 ${caught}/${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
