// 변이 프로브 — 「점검일자 변경 가드」 축(2026-09-22)이 실제로 물리는지 본다.
//
// 40/0 초록은 "무언가를 잡는다"만 말한다. 제품을 되돌려 **빨강이 되는지** 확인한다.
// 가장 중요한 변이는 M1·M2다 — **제출한 서류와 ERP가 어긋나는** 실패를 재현한다.
// M5는 이 축 특유의 함정: **표시 축으로 판정하면 숨겨진 ⑤⑥ 완료를 못 보고 통과시킨다.**
//
// 🚨 from은 한 줄짜리만 쓴다 — 이 저장소 소스는 CRLF가 섞여 여러 줄 문자열이 조용히 안 맞는다.
//
// 실행: node scripts/_mutate-inspection-date-change.mjs   (MUT=M3 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const LIB = 'src/lib/inspection-date-change.ts'
const PAGE = 'src/app/(dashboard)/inspections/calendar/page.tsx'
const CLIENT = 'src/components/inspections/inspection-calendar-client.tsx'
const ACTIONS = 'src/app/(dashboard)/inspections/plan-date-actions.ts'
const SUITE = 'npx tsx scripts/test-inspection-date-change.mts'

const MUTANTS = [
  {
    name: 'M1 가드를 통째로 연다 — 2단계 완료 건도 날짜가 움직인다(제출 서류와 어긋남)',
    file: LIB,
    from: '  if (!blocker) return { allowed: true }',
    to: '  return { allowed: true }',
    expect: '2단계 완료 → 거부',
  },
  {
    name: 'M2 경계를 1단계까지 넓힌다 — 1단계 완료만으로 막힌다(정정이 불가능해진다)',
    file: LIB,
    from: '    .filter(s => s.step_num >= 2 && isDone(s))',
    to: '    .filter(s => s.step_num >= 1 && isDone(s))',
    expect: '1단계만 완료 → 허용',
  },
  {
    name: 'M3 빈 배열을 허용으로 — 조회 실패가 「마음대로 옮겨도 됨」이 된다',
    file: LIB,
    from: "    return { allowed: false, reason: '단계 정보를 불러오지 못해 날짜를 옮길 수 없습니다.' }",
    to: '    return { allowed: true }',
    expect: '단계 0건 → 거부',
  },
  {
    name: 'M4 가장 이른 단계가 아니라 아무거나 짚는다 — 사용자가 되돌릴 곳을 못 찾는다',
    file: LIB,
    from: '    .sort((a, b) => a.step_num - b.step_num)[0]',
    to: '    .sort((a, b) => b.step_num - a.step_num)[0]',
    expect: '가장 이른 것',
  },
  {
    name: 'M5 **표시 축으로 판정** — 불량 0이면 숨는 ⑤⑥ 완료를 못 보고 통과시킨다',
    file: PAGE,
    from: '        dateChange: dateChangeVerdict(allStepsMap.get(insp.id) ?? []),',
    to: '        dateChange: dateChangeVerdict(stepsMap.get(insp.id) ?? []),',
    expect: '거르기 전',
  },
  {
    name: 'M6 서버 액션이 판정을 건너뛴다 — 화면만 막고 엔드포인트는 열려 있다',
    file: ACTIONS,
    from: '  if (!verdict.allowed) return { error: verdict.reason, blockedBy: verdict.blockedBy }',
    to: '  void verdict',
    expect: 'changeInspectionDateAction이',
  },
  {
    name: 'M7 마감일을 액션이 스스로 계산한다 — 재확정 경로와 다른 날짜가 나온다',
    file: ACTIONS,
    from: '  await syncInspectionStepDates(admin, inspectionId, dates)',
    to: '  void dates',
    expect: '기존 정본 함수',
  },
  {
    name: 'M8 막힌 사유를 화면에서 지운다 — 「왜 나만 안 되나」를 물을 곳이 없다',
    file: CLIENT,
    from: '                      {selectedInspection.dateChange?.reason ?? \'변경할 수 없습니다\'}',
    to: '                      {\'변경할 수 없습니다\'}',
    expect: '사유를 그 자리에 적는다',
  },
  {
    name: 'M9 가림을 없앤다 — 막힌 건에도 [고치기]가 뜬다',
    file: CLIENT,
    from: '                  {selectedInspection.dateChange?.allowed ? (',
    to: '                  {true ? (',
    expect: 'dateChange로 가린다',
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
