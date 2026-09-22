// 변이 프로브 — 「달력의 소방계획서 고지 칩」 축(2026-09-22)이 실제로 물리는지 본다.
//
// 이 축의 실패는 **오배송**이다: 「수신기위치」를 채우러 눌렀는데 엉뚱한 탭이 열리거나,
// 모르는 문장을 1.1로 떠넘겨 사용자가 있지도 않은 칸을 찾는다.
// 이 저장소가 한 번 크게 물린 부류다(`fire-plan-notice.ts`의 「3.5층창고」).
//
// 🚨 from은 한 줄짜리만 쓴다 — 이 저장소 소스는 CRLF가 섞여 여러 줄 문자열이 조용히 안 맞는다.
//
// 실행: node scripts/_mutate-calendar-fireplan-notice.mjs   (MUT=M3 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const LIB = 'src/lib/fire-plan-chip-target.ts'
const CLIENT = 'src/components/inspections/inspection-calendar-client.tsx'
const VIEW = 'src/components/customers/plan-tab-view.tsx'
const SUITE = 'npx tsx scripts/test-calendar-fireplan-notice.mts'

const MUTANTS = [
  {
    name: 'M1 모르는 라벨을 1.1로 떠넘긴다 — 있지도 않은 칸을 찾게 된다',
    file: LIB,
    from: '  if (!t) return null',
    to: "  if (!t) return { href: firePlanChipHref('form11', customerId), label: '공통 탭 > 1.1 일반현황' }",
    expect: '폴백이 없다',
  },
  {
    name: 'M2 부분 일치로 건다 — 「주소가 비었습니다」가 주소 칸으로 간다',
    file: LIB,
    from: '  const t = FIRE_PLAN_CHIP_TARGET[part.text.trim()]',
    to: '  const t = FIRE_PLAN_CHIP_TARGET[Object.keys(FIRE_PLAN_CHIP_TARGET).find(k => part.text.includes(k)) ?? part.text.trim()]',
    expect: '부분 일치로 걸리지 않는다',
  },
  {
    name: 'M3 1.1 라벨을 옛 탭(plan)으로 — 이사(3분리) 전 주소로 되돌아간다',
    file: LIB,
    from: "    case 'form11':     return `${c}?tab=facilities&form=1.1`",
    to: "    case 'form11':     return `${c}?tab=plan&form=1.1`",
    expect: '수신기위치',
  },
  {
    name: 'M4 자위소방대를 건물 탭으로 — 2장이 아닌 곳으로 보낸다',
    file: LIB,
    from: "  '자위소방대': 'ch2', '송달 동의': 'consent',",
    to: "  '자위소방대': 'buildings', '송달 동의': 'consent',",
    expect: '자위소방대',
  },
  {
    name: 'M5 표를 고객 화면에 다시 복제한다 — 한쪽만 고쳐질 문이 열린다',
    file: VIEW,
    from: 'const CHIP_TARGET = FIRE_PLAN_CHIP_TARGET',
    to: "const CHIP_TARGET: typeof FIRE_PLAN_CHIP_TARGET = { '주소': 'info', '사용승인일': 'info' }",
    expect: '표가 복제돼 있지 않다',
  },
  {
    name: 'M6 소방계획서에 결과보고서 게이트를 건다 — 정기 아닌데도 안 보이게 된다',
    file: CLIENT,
    from: '            {true && (\n              <div\n                data-testid="daypanel-fireplan"',
    to: '            {selectedInspection.hasResultReport && (\n              <div\n                data-testid="daypanel-fireplan"',
    expect: '게이트를 걸지 않는다',
  },
  {
    name: 'M7 복귀 경로를 뗀다 — 채우러 갔다가 달력으로 못 돌아온다',
    file: CLIENT,
    from: "                    return `${hit.href}${hit.href.includes('?') ? '&' : '?'}from=${encodeURIComponent(calendarBackHref)}`",
    to: '                    return hit.href',
    expect: '복귀 경로(from=)가 칩에 붙는다',
  },
  {
    name: 'M8 회차가 바뀌어도 소방계획서 고지를 안 버린다 — 남의 고객 빈칸을 보여 준다',
    file: CLIENT,
    from: "setResumedDoc(false); setFpNotice([]); setFpError('')",
    to: 'setResumedDoc(false)',
    expect: '소방계획서 고지도 버린다',
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
      console.log(`✅ ${m.name}\n     → 빨강: ${red.map(l => l.trim()).slice(0, 2).join(' | ')}`)
    } else if (failed) {
      console.log(`⚠️  ${m.name}\n     → 빨강이긴 한데 의도한 단언이 아니다(기대: "${m.expect}")\n     → ${red.map(l => l.trim()).slice(0, 2).join(' | ') || '(❌ 줄 없음 — 스위트가 중간에 죽었다)'}`)
    } else {
      console.log(`❌ ${m.name}\n     → 제품을 되돌렸는데 스위트가 초록이다 — 이 축을 무는 단언이 없다`)
    }
  } finally {
    writeFileSync(m.file, original)
  }
}

console.log(`\n변이 ${caught}/${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
