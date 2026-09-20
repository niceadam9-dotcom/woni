// 변이 프로브 — 「총 이행기간 법정 기본(3순위) + 7행 일수」 축(2026-09-14)이 실제로 물리는지 본다.
//
// 73/71 초록은 "무언가를 잡는다"만 말한다. 제품을 되돌려 **빨강이 되는지**, 그것도
// **의도한 단언이** 빨강이 되는지 확인한다.
//
// 🚨 from은 한 줄짜리만 쓴다 — 이 저장소 소스는 CRLF가 섞여 여러 줄 문자열이 조용히 안 맞는다.
// 실행: node scripts/_mutate-action-period-legal.mjs   (MUT=M3 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const PERIOD = 'src/lib/annex-total-period.ts'
const ASSEMBLE = 'src/lib/report9-assemble.ts'
const ACTIONS = 'src/app/(dashboard)/inspections/report9-actions.ts'
const ROUTE = 'src/app/(dashboard)/inspections/[id]/workbook/route.ts'

const SUITES = {
  period: 'npx tsx --conditions=react-server scripts/test-annex-total-period.mts',
  rows: 'npx tsx --conditions=react-server scripts/test-report10-plan-rows.mts',
}

const MUTANTS = [
  {
    name: 'M1 법정 기본을 아예 안 깐다 — 서식이 다시 공란으로 제출된다',
    file: PERIOD, suite: 'period',
    from: '  return legalActionRange((legal.reportDateISO ?? \'\').slice(0, 10), DEFAULT_ACTION_PERIOD_DAYS)',
    to: '  return null',
    expect: '기산일 = 보고일',
  },
  {
    name: 'M2 불량이 없어도 깐다 — 이행할 것이 없는 회차에 기간이 선다',
    file: PERIOD, suite: 'period',
    from: '  if (!legal?.hasDefect) return null',
    to: '  if (!legal) return null',
    expect: '불량이 없으면 안 깐다',
  },
  {
    name: 'M3 법정 기본이 수기·자동을 이긴다 — 서열 뒤집기',
    file: PERIOD, suite: 'period',
    from: '  if (chosen) return chosen',
    to: '  void chosen',
    expect: '자동 산출이 있으면 법정 기본이 안 선다',
  },
  {
    name: 'M4 기본 일수를 20일(2호 철거·교체)로 — 법정 상한을 기본값으로',
    file: PERIOD, suite: 'period',
    from: '  return legalActionRange((legal.reportDateISO ?? \'\').slice(0, 10), DEFAULT_ACTION_PERIOD_DAYS)',
    to: '  return legalActionRange((legal.reportDateISO ?? \'\').slice(0, 10), 20)',
    expect: '법정 기본 10일',
  },
  {
    name: 'M5 엑셀만 기산일을 11호 보고일로 — 두 산출물이 열흘 어긋난다',
    file: ROUTE, suite: 'period',
    from: '    reportDateISO: annexReportDateISO(plan10Fields, row.report9_submitted_at),',
    to: '    reportDateISO: annexReportDateISO(done11Fields, row.report11_submitted_at),',
    expect: '별지 10호 보고일',
  },
  {
    name: 'M6 조립본이 7행 일수를 다시 비운다 — 엑셀 21칸과 갈라진다',
    file: ASSEMBLE, suite: 'rows',
    from: '      days: d.actionPeriod ? String(d.actionPeriod.days) : \'\',',
    to: '      days: \'\',',
    expect: 'days가 7행 전부에 실린다',
  },
  {
    name: 'M7 덧칠이 7행 일수를 다시 비운다 — 수기 보정 회차만 다른 표',
    file: ACTIONS, suite: 'rows',
    from: '      const days = data.totalDays ?? \'\'',
    to: '      const days = \'\'',
    expect: '덧칠의 일수가 data.totalDays에서 온다',
  },
  {
    name: 'M8 낡은 안내를 되살린다 — 폐지된 칸을 가리킨다',
    file: ACTIONS, suite: 'period',
    from: "        missing.push('총 이행기간 미입력 — ④ 제출 단계의 「별지 10호 — 총 이행기간」에서 정하세요')",
    to: "        missing.push('총 이행기간 — 계획 시작일·종료일이 모두 있는 건이 없어 산출 불가')",
    expect: '폐지된 불량별 계획 시작·종료일 칸',
  },
  {
    name: 'M9 지어낸 값을 조용히 인쇄한다 — 고지를 뺀다',
    file: ACTIONS, suite: 'period',
    from: "        missing.push('총 이행기간 미입력 — 법정 기본 10일(수리·정비)로 인쇄됩니다. ④ 제출 단계의 「별지 10호 — 총 이행기간」에서 확정하세요')",
    to: '        void legal',
    expect: '고지에 남긴다',
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
    writeFileSync(m.file, original.replace(m.from, m.to))

    let out = ''
    let failed = false
    try {
      out = execSync(SUITES[m.suite], { encoding: 'utf8', stdio: 'pipe' })
    } catch (err) {
      failed = true
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
    const red = out.split('\n').filter(l => l.includes('❌'))
    const hit = red.some(l => l.includes(m.expect))
    if (failed && hit) {
      caught++
      console.log(`✅ ${m.name}\n     → 빨강: ${red.map(l => l.trim()).slice(0, 4).join(' | ')}`)
    } else if (failed) {
      console.log(`⚠️  ${m.name}\n     → 빨강이긴 한데 의도한 단언이 아니다(기대: "${m.expect}")\n     → ${red.map(l => l.trim()).slice(0, 4).join(' | ') || '(❌ 줄 없음 — 스위트가 중간에 죽었다)'}`)
    } else {
      console.log(`❌ ${m.name}\n     → 제품을 되돌렸는데 스위트가 초록이다 — 이 축을 무는 단언이 없다`)
    }
  } finally {
    writeFileSync(m.file, original)
  }
}

console.log(`\n변이 결과: ${caught} / ${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
