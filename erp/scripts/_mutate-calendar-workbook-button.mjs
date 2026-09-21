// 변이 프로브 — 「달력 사이드 패널 [보고서 엑셀]이 뜨는 조건」 축(2026-09-21)이 실제로 물리는지 본다.
//
// 16/0 초록은 "무언가를 잡는다"만 말한다. 제품을 되돌려 **빨강이 되는지**, 그것도 **의도한 단언이**
// 빨강이 되는지 확인한다. 이 축은 절반이 소스 단언이라 특히 공허 통과가 쉽다.
//
// 가장 중요한 변이는 M1·M2다 — **정기 230건에 버튼이 붙는** 실패를 재현한다. 「버튼이 있는가」만
// 묻는 검사였다면 그 둘이 전부 초록으로 통과했을 것이다.
//
// 🚨 from은 한 줄짜리만 쓴다 — 이 저장소 소스는 CRLF가 섞여 여러 줄 문자열이 조용히 안 맞는다.
//
// 실행: node scripts/_mutate-calendar-workbook-button.mjs   (MUT=M3 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const PAGE = 'src/app/(dashboard)/inspections/calendar/page.tsx'
const CLIENT = 'src/components/inspections/inspection-calendar-client.tsx'
const STATUS = 'src/lib/inspection-step-status.ts'
const SUITE = 'npx tsx scripts/test-calendar-workbook-button.mts'

const MUTANTS = [
  {
    name: 'M1 축을 badge로 갈아끼운다 — **정기 230건에 버튼이 붙는다**(이 검사의 존재 이유)',
    file: PAGE,
    from: '        hasResultReport: isSelfInspection(insp.plan_type),',
    to: "        hasResultReport: insp.inspection_type !== '일반관리',",
    expect: 'plan_type',
  },
  {
    name: 'M2 늘 켠다 — 정기·일반에도 빈 결과보고서 버튼이 뜬다',
    file: PAGE,
    from: '        hasResultReport: isSelfInspection(insp.plan_type),',
    to: '        hasResultReport: true,',
    expect: 'plan_type',
  },
  {
    name: 'M3 조회에서 plan_type을 뺀다 — 판정 입력이 늘 undefined가 되어 전건 true',
    file: PAGE,
    from: "    .select('id, customer_id, inspection_type, plan_type, year, sequence_num, inspection_start_date, status, assigned_employee_id')",
    to: "    .select('id, customer_id, inspection_type, year, sequence_num, inspection_start_date, status, assigned_employee_id')",
    expect: '조회가 plan_type을 싣는다',
  },
  {
    name: 'M4 클라이언트의 가림을 없앤다 — 모든 패널에 버튼',
    file: CLIENT,
    from: '            {selectedInspection.hasResultReport && (',
    to: '            {true && (',
    expect: 'hasResultReport로 가린다',
  },
  {
    name: 'M5 가림을 steps.length로 바꾼다 — 표시 축이라 불량0(4단계)이면 사라진다',
    file: CLIENT,
    from: '            {selectedInspection.hasResultReport && (',
    to: '            {selectedInspection.steps.length === 6 && (',
    expect: 'hasResultReport로 가린다',
  },
  {
    name: 'M6 판정식을 늘 참으로 — isSelfInspection이 1단계까지 자체점검이라 한다',
    file: STATUS,
    from: "  return !planType || planType.startsWith('special')",
    to: '  return true',
    expect: '전건 일치',
  },
  {
    name: 'M7 판정식의 접두를 바꾼다 — 자체점검과 정기가 통째로 뒤바뀐다',
    file: STATUS,
    from: "  return !planType || planType.startsWith('special')",
    to: "  return !planType || planType.startsWith('monthly')",
    expect: '전건 일치',
  },
  {
    // ⚠ 치환 결과에 `daypanel-workbook`이 **남으면 안 된다** — 첫 판(`data-x="daypanel-workbook-removed"`)은
    //   부분 문자열로 묻던 단언을 그대로 통과시켰다. 변이와 단언을 같이 고쳤다.
    name: 'M8 testid를 지운다 — 왕복 검사가 화면 구조를 추측하게 된다',
    file: CLIENT,
    from: '                data-testid="daypanel-workbook"',
    to: '                data-testid="zzz-no-marker"',
    expect: '표식',
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
