// 변이 프로브 — 「보고서 고지 분류」 축(2026-09-22)이 실제로 물리는지 본다.
//
// 이 축의 실패는 **사용자가 못 고치는 것을 고치러 헤매는** 부류다. 46/0 초록은
// "무언가를 잡는다"만 말하므로 되돌려 본다.
//
// 가장 중요한 변이는 M1·M2 — 상한을 「채울 수 있다」로, 안내를 「누락」으로 내보내는 것이다.
// M5는 이 저장소가 한 번 크게 물린 부류(`fire-plan-notice.ts`의 「3.5층창고」)의 재현이다.
//
// ⚠ 동등 변이라 목록에서 뺀 것: 「규칙 순서 뒤집기」(`RULES.find` → `reverse().find`).
//    첫 판에 넣었다가 **살아남아서** 알게 됐다 — 규칙이 서로 배타적이라 순서가 결과를 안 바꾼다.
//    그건 우연으로 둘 성질이 아니라 **지켜야 할 성질**이므로, 변이를 지우는 대신
//    검사에 「실측 전수에서 두 규칙에 걸리는 문장 0건」 단언을 넣었다(그쪽이 진짜 가드다).
//
// 🚨 from은 한 줄짜리만 쓴다 — 이 저장소 소스는 CRLF가 섞여 여러 줄 문자열이 조용히 안 맞는다.
//
// 실행: node scripts/_mutate-workbook-notice.mjs   (MUT=M3 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const LIB = 'src/lib/workbook-notice.ts'
const ROUTE = 'src/app/(dashboard)/inspections/[id]/workbook/route.ts'
const SUITE = 'npx tsx scripts/test-workbook-notice.mts'

const MUTANTS = [
  {
    name: 'M1 서식 상한을 「채울 수 있다」로 — 못 고치는 것을 고치러 보낸다',
    file: LIB,
    from: "  { test: /\\(허브 7행\\)$/, kind: 'cap' },",
    to: "  { test: /\\(허브 7행\\)$/, kind: 'fixable', target: 'crew' },",
    expect: '보조 점검인력',
  },
  {
    name: 'M2 안내를 누락으로 — 멀쩡한 문서번호를 고치러 간다',
    file: LIB,
    from: "  { test: /^문서번호 자동 제안\\(/, kind: 'info', scope: 'inspection' },",
    to: "  { test: /^문서번호 자동 제안\\(/, kind: 'fixable', target: 'annex', scope: 'inspection' },",
    expect: '문서번호 자동 제안',
  },
  {
    name: 'M3 점검표 목적지를 엉뚱한 곳으로 — 채우러 갔는데 그 칸이 없다',
    file: LIB,
    from: "  { test: /^점검표 미입력 \\d+종 → 기본 ○ 인쇄/, kind: 'fixable', target: 'sheet', label: '점검표 입력', scope: 'inspection' },",
    to: "  { test: /^점검표 미입력 \\d+종 → 기본 ○ 인쇄/, kind: 'fixable', target: 'plan', label: '점검표 입력', scope: 'inspection' },",
    expect: 'sheet      ←',
  },
  {
    name: 'M5 모르는 문장에 목적지를 지어낸다 — 「3.5층창고」 사고의 재현',
    file: LIB,
    from: "    if (!hit) return { text, kind: 'unknown' as const }",
    to: "    if (!hit) return { text, kind: 'fixable' as const, target: 'sheet' as const }",
    expect: 'unknown으로 남는다',
  },
  {
    name: 'M6 절단 꼬리를 누락으로 — 「…외 273자 생략」을 채우러 간다',
    file: LIB,
    from: "  { test: /^…외 \\d+자 생략$/, kind: 'truncated' },",
    to: "  { test: /^…외 \\d+자 생략$/, kind: 'fixable', target: 'sheet' },",
    expect: '절단 꼬리는 따로 분류된다',
  },
  {
    name: 'M7 fixableParts가 상한까지 센다 — 두 덩이 분리가 무너진다',
    file: LIB,
    from: "  return parts.filter(p => p.kind === 'fixable')",
    to: "  return parts.filter(p => p.kind === 'fixable' || p.kind === 'cap')",
    expect: 'fixableParts는 fixable만',
  },
  {
    name: 'M8 라우트 고지 문구를 바꾼다 — 표가 썩는데 도화선이 안 터지면 안 된다',
    file: ROUTE,
    from: '            return un.length ? [`점검표 미입력 ${un.length}종 → 기본 ○ 인쇄: ${un.join(\'·\')}`] : []',
    to: '            return un.length ? [`점검표 입력 안 됨 ${un.length}종: ${un.join(\'·\')}`] : []',
    expect: '고지 블록이 그대로다',
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
