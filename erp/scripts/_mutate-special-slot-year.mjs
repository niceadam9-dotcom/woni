// 변이 실험 — test-special-slot-year.mts가 정말로 무는가 + **계측기(codeOnly)가 죽으면 잡히는가**.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const ANC = 'src/lib/plan-anchor.ts'
const GEN = 'src/lib/inspection-plan-generator.ts'
const REC = 'src/lib/reconcile-special-slots.ts'
const ACT = 'src/app/(dashboard)/customers/actions.ts'
const CO  = 'scripts/_code-only.mts'

const MUTANTS = [
  { id: 'M1', why: '옛 규칙 복귀 — 감긴 2차를 같은 해에 둔다(지평리56 고아 재현)', file: ANC,
    from: 'yearOffset: m2 > 12 ? 1 : 0,', to: 'yearOffset: 0,' },
  { id: 'M2', why: '늘 다음 해로 보낸다 — 감기지 않는 고객까지 밀어버린다(과잉 적용)', file: ANC,
    from: 'yearOffset: m2 > 12 ? 1 : 0,', to: 'yearOffset: 1,' },
  { id: 'M3', why: '경계 off-by-one — 12월을 같은 해로 친다', file: ANC,
    from: 'yearOffset: m2 > 12 ? 1 : 0,', to: 'yearOffset: m2 > 13 ? 1 : 0,' },
  { id: 'M4', why: '달 산식을 깬다 — 2차가 엉뚱한 달로', file: ANC,
    from: 'month: ((m2 - 1) % 12) + 1,', to: 'month: ((m2 - 1) % 12) + 2,' },
  { id: 'M5', why: '첫 해 필터를 끈다 — 재배치가 고아를 되살린다', file: ANC,
    from: 'return slots.filter(d => d.yearOffset === 0 || year - d.yearOffset >= firstYear)',
    to:   'return slots.filter(() => true)' },
  { id: 'M6', why: '필터가 과하다 — 감긴 2차를 어느 해에서도 안 낸다(2차 소멸)', file: ANC,
    from: 'return slots.filter(d => d.yearOffset === 0 || year - d.yearOffset >= firstYear)',
    to:   'return slots.filter(d => d.yearOffset === 0)' },
  { id: 'M7', why: '2차 자체를 없앤다 (과잉 삭제)', file: ANC,
    from: "  if (sub === '종합') {", to: '  if (false) {' },
  { id: 'M8', why: '생성기가 2차를 다시 같은 해에 앉힌다', file: GEN,
    from: 'year: targetYear + d.yearOffset,', to: 'year: targetYear,' },
  { id: 'M9', why: '생성기 plan 조회를 한 해로 되돌린다 — 2차가 조용히 빠진다', file: GEN,
    from: ".in('year', years).in('month', months)", to: ".eq('year', targetYear).in('month', months)" },
  { id: 'M10', why: '재배치가 거르지 않은 목록을 쓴다 — 고아 부활', file: REC,
    from: 'const p = planSpecialSlots(year, want, rows)', to: 'const p = planSpecialSlots(year, desired, rows)' },
  { id: 'M11', why: '재배치 잔재 청소가 거르지 않은 목록을 쓴다 — 고아가 안 치워진다', file: REC,
    from: 'planDemoteStraySpecials(year, want, rows, claimed', to: 'planDemoteStraySpecials(year, desired, rows, claimed' },
  // ⚠ 이 트리에 `previewNewSchedule`이 없을 수 있다(타 세션 미커밋) — 그때는 **건너뛴다**.
  //   「없는 것」과 「빠져나간 것」을 뭉뚱그리면, 진짜로 뚫린 날에도 조용히 넘어간다.
  { id: 'M12', why: '등록 미리보기가 실행과 다른 일정을 약속한다', file: ACT,
    skipIf: (src) => !/previewNewSchedule/.test(src),
    from: 'for (const s of desiredSlotsInYear(slots, year, years[0])) {', to: 'for (const s of slots) {' },
  // 🎯 계측기 자체 — 이게 죽으면 위 소스 단언들이 **설명 주석에 걸려** 거짓 판정을 낸다
  { id: 'M13', why: '**계측기 회귀**: codeOnly의 CRLF 정규화를 뺀다(줄 주석이 한 줄도 안 걷힌다)', file: CO,
    from: "    .replace(/\\r\\n?/g, '\\n')\n", to: '' },
]

const runTest = () => {
  try { execFileSync('npx', ['tsx', 'scripts/test-special-slot-year.mts'], { stdio: 'pipe', shell: true }); return 0 }
  catch (e) { return e.status ?? 1 }
}

if (runTest() !== 0) { console.log('❌ 대조군이 이미 빨강이다'); process.exit(1) }
console.log('대조군: 초록 ✅\n')

let caught = 0, escaped = 0, skipped = 0
for (const m of MUTANTS) {
  const orig = readFileSync(m.file, 'utf8')
  if (m.skipIf?.(orig)) {
    skipped++; console.log(`  ⏸ ${m.id} 건너뜀 — 대상 코드가 이 트리에 없다(타 세션 미커밋): ${m.why}`)
    continue
  }
  const hits = orig.split(m.from).length - 1
  if (hits !== 1) { console.log(`  ❌ ${m.id} 치환 실패 — 앵커가 ${hits}곳: ${m.why}`); escaped++; continue }
  writeFileSync(m.file, orig.replace(m.from, m.to))
  const rc = runTest()
  writeFileSync(m.file, orig)
  if (rc !== 0) { caught++; console.log(`  ✅ ${m.id} 잡힘 (빨강) — ${m.why}`) }
  else { escaped++; console.log(`  ❌ ${m.id} **빠져나감 (초록)** — ${m.why}`) }
}
console.log(`\n변이 결과: ${caught}/${MUTANTS.length - skipped} 잡힘, ${escaped} 빠져나감`
  + (skipped ? `, ${skipped} 건너뜀(이 트리에 대상 코드 없음)` : ''))
process.exit(escaped > 0 ? 1 : 0)
