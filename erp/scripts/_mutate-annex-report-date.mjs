// 변이 프로브 — 「별지 보고일 ← 소방서 제출 기록」 축(2026-09-20)이 실제로 물리는지 본다.
//
// 초록 N건은 "무언가를 잡는다"만 말한다. 제품을 되돌려 **빨강이 되는지**, 그것도
// **의도한 단언이** 빨강이 되는지 확인한다.
//
// 🚨 from은 한 줄짜리만 쓴다 — 이 저장소 소스는 CRLF가 섞여 여러 줄 문자열이 조용히 안 맞는다.
// 실행: node scripts/_mutate-annex-report-date.mjs   (MUT=M3 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const ASSEMBLE = 'src/lib/report9-assemble.ts'
const ACTIONS = 'src/app/(dashboard)/inspections/report9-actions.ts'
const ROUTE = 'src/app/(dashboard)/inspections/[id]/workbook/route.ts'
const COVER = 'src/lib/annex-cover-official.ts'
const SPEC = 'src/app/(dashboard)/customers/facility-spec-actions.ts'
const WB = 'src/components/inspections/inspection-workbench.tsx'

const SUITE = 'npx tsx --conditions=react-server scripts/test-annex-report-date.mts'

const MUTANTS = [
  {
    name: 'M1 제출 기록 가지를 죽인다 — 규칙이 종전(수기>오늘)으로 되돌아간다',
    file: ASSEMBLE,
    from: '  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) return s',
    to: '  void s',
    expect: '[A2]',
  },
  {
    name: 'M2 10·11호 축 맞바꿈 — 10호가 ⑥을, 11호가 ④를 인쇄한다',
    file: ACTIONS,
    from: "  const submittedISO = kind === 'report10' ? inspSub?.report9_submitted_at : inspSub?.report11_submitted_at",
    to: "  const submittedISO = kind === 'report10' ? inspSub?.report11_submitted_at : inspSub?.report9_submitted_at",
    expect: '[B2]',
  },
  {
    name: 'M3 9호 오버레이가 ④ 가지를 다시 뺀다 — select 주석이 다시 거짓이 된다',
    file: ASSEMBLE,
    from: '  data.reportDate = kdate(annexReportDateISO(annexFields, insp.report9_submitted_at))',
    to: '  data.reportDate = kdate(annexReportDateISO(annexFields))',
    expect: '[B4]',
  },
  {
    name: 'M4 엑셀 G25(11호)에 ④를 물린다 — PDF 11호와 갈라진다',
    file: ROUTE,
    from: '      reportDateISO: annexReportDateISO(done11Fields, row.report11_submitted_at),',
    to: '      reportDateISO: annexReportDateISO(done11Fields, row.report9_submitted_at),',
    expect: '[B6]',
  },
  {
    name: 'M5 위임장이 사슬을 다시 손으로 적는다(④ 가지 탈락) — 9호와 다른 날짜',
    file: COVER,
    from: "  const [sy, sm, sdd] = annexReportDateISO(r9f, insp.report9_submitted_at).split('-').map(Number)",
    to: "  const [sy, sm, sdd] = annexReportDateISO(r9f).split('-').map(Number)",
    expect: '[B7]',
  },
  {
    name: 'M6 자동값 액션이 제출 기록을 안 내준다 — 화면 기산일·placeholder가 오늘로',
    file: SPEC,
    from: '    return { defaults: sub ? { reportDate: sub } : {} }',
    to: '    return { defaults: {} }',
    expect: '[C2]',
  },
  {
    name: 'M7 작업대 기산일에서 ④ 가지 제거 — 화면과 인쇄물이 다른 날을 본다',
    file: WB,
    from: "              baseDate={(fields.reportDate ?? '').trim() || (auto.reportDate ?? '').trim() || todayKst()}",
    to: "              baseDate={(fields.reportDate ?? '').trim() || todayKst()}",
    expect: '[C3]',
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
      out = execSync(SUITE, { encoding: 'utf8', stdio: 'pipe' })
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
