// 변이 실험 — test-annex-round-pill.mts가 정말로 무는가.
// 🚨 치환이 안 되면(CRLF·공백 드리프트) 조용히 「통과」로 보인다 → 건수를 세고 1이 아니면 실패.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const LIB  = 'src/lib/annex-round-state.ts'
const CARD = 'src/components/customers/plan-annex-round-card.tsx'
const SECT = 'src/components/customers/plan-annex-section.tsx'

const MUTANTS = [
  { id: 'M1', why: '옛 규칙 복귀 — 과거면 무조건 「예정 지연 N일」(신고 상태 재현)', file: LIB,
    from: "if (gap > 0)   return { kind: 'elapsed',   label: `${gap}개월 경과 · 미실시` }",
    to:   "if (gap > 0)   return { kind: 'overdue',   label: `예정 지연 ${gap}일 ⚠` }" },
  { id: 'M2', why: '같은 달도 경과로 친다 — 법정 달 안인데 늦었다고 말한다', file: LIB,
    from: 'if (gap === 0) return', to: 'if (gap === -999) return' },
  { id: 'M3', why: '달 차이를 해를 빼고 센다 — 2025-03이 6개월로 보인다', file: LIB,
    from: 'return (y2 - y1) * 12 + (m2 - m1)', to: 'return (m2 - m1)' },
  { id: 'M4', why: '미래 D-N을 죽인다 (과잉 삭제 — 재촉 축까지 없앰)', file: LIB,
    from: "return { kind: 'due', label: `예정 D-${days}` }",
    to:   "return { kind: 'planned', label: '예정' }" },
  { id: 'M5', why: '법정 기한 초과(overdue)를 조용히 만든다 — 진짜 경고가 죽는다', file: LIB,
    from: "if (r.state === 'overdue')     return { kind: 'overdue',    label: '기한초과' }",
    to:   "if (r.state === 'overdue')     return { kind: 'planned',    label: '예정' }" },
  { id: 'M6', why: '미시작 예정을 다시 붉게 칠한다 (292건 복귀)', file: CARD,
    from: "elapsed:    'bg-amber-50 text-amber-700',", to: "elapsed:    'bg-red-50 text-red-600'," },
  { id: 'M7', why: '화면이 순수 모듈을 안 쓰고 제 규칙을 다시 짠다', file: CARD,
    from: 'const p = roundPill(r, todayStr())', to: "const p = { kind: 'planned' as RoundPillKind, label: '예정' }" },
  { id: 'M8', why: '카드 라벨에 회차를 되살린다', file: CARD,
    from: 'const label = `${r.year}년`', to: 'const label = `${r.year}년 ${r.sequenceNum}차`' },
  { id: 'M9', why: '모달 제목에만 회차를 되살린다 (한 곳만 되돌리는 형태)', file: SECT,
    from: "setFullPreview({ inspectionId: r.docs.inspectionId, label: `${r.year}년`, only: type })",
    to:   "setFullPreview({ inspectionId: r.docs.inspectionId, label: `${r.year}년 ${r.sequenceNum}차`, only: type })" },
  { id: 'M10', why: '데이터 키(roundKey)까지 회차를 지운다 — 지우면 안 되는 축', file: SECT,
    from: 'function roundKey(r: CustomerRound) { return `${r.year}-${r.sequenceNum}` }',
    to:   'function roundKey(r: CustomerRound) { return `${r.year}` }' },
]

const runTest = () => {
  try { execFileSync('npx', ['tsx', 'scripts/test-annex-round-pill.mts'], { stdio: 'pipe', shell: true }); return 0 }
  catch (e) { return e.status ?? 1 }
}

if (runTest() !== 0) { console.log('❌ 대조군이 이미 빨강이다 — 실험이 성립하지 않는다'); process.exit(1) }
console.log('대조군: 초록 ✅\n')

let caught = 0, escaped = 0
for (const m of MUTANTS) {
  const orig = readFileSync(m.file, 'utf8')
  const hits = orig.split(m.from).length - 1
  if (hits !== 1) { console.log(`  ❌ ${m.id} 치환 실패 — 앵커가 ${hits}곳: ${m.why}`); escaped++; continue }
  writeFileSync(m.file, orig.replace(m.from, m.to))
  const rc = runTest()
  writeFileSync(m.file, orig)
  if (rc !== 0) { caught++; console.log(`  ✅ ${m.id} 잡힘 (빨강) — ${m.why}`) }
  else { escaped++; console.log(`  ❌ ${m.id} **빠져나감 (초록)** — ${m.why}`) }
}
console.log(`\n변이 결과: ${caught}/${MUTANTS.length} 잡힘, ${escaped} 빠져나감`)
process.exit(escaped > 0 ? 1 : 0)
