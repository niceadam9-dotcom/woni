// 변이 프로브 — 「라이브러리 미리보기 대표 칸」 축(2026-09-21)이 실제로 물리는지 본다.
//
// 31/0 초록은 "무언가를 잡는다"만 말한다. 제품을 되돌려 **빨강이 되는지**, 그것도
// **의도한 단언이** 빨강이 되는지 확인한다. 이 축은 특히 공허 통과가 쉽다 —
// 본문을 선언 순서로 만들면 결함 코드로도 초록이 뜨기 때문이다(검사 머리주석 참조).
//
// 🚨 from은 한 줄짜리만 쓴다 — 이 저장소 소스는 CRLF가 섞여 여러 줄 문자열이 조용히 안 맞는다.
//    (plan-text-sections.ts는 LF 전용이나 규약을 따른다.)
//
// ⚠ 동등 변이라 목록에서 뺀 것: `ed.find(f => f.kind === 'rows' && !f.key)`에서 `&& !f.key`를
//    떼는 변이. 대상 4개 기록부 섹션의 rows 필드는 key가 없고, key가 있는 유일한 rows
//    (training.details)는 switch에서 이미 갈라져 firstDeclared를 타지 않는다. 잡힐 수 없다.
//
// 실행: node scripts/_mutate-plan-text-preview.mjs   (MUT=M3 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const SEC = 'src/lib/plan-text-sections.ts'
const SUITE = 'npx tsx scripts/test-plan-text-preview.mts'

const MUTANTS = [
  {
    name: 'M1 수리 이전으로 — 순서를 늘 객체에서 집는다(결함 원본)',
    from: '  const ordered = keys.length > 0 ? keys.map(k => s(src[k])) : Object.values(src).map(s)',
    to: '  const ordered = Object.values(src).map(s)',
    expect: '응급구조(rescue)가 아니다',
  },
  {
    name: 'M2 record 축을 못 찾게 한다 — 팀별임무가 객체 순서로 떨어진다',
    from: "  const rec = ed.find(f => f.kind === 'record')",
    to: '  const rec = undefined',
    expect: '응급구조(rescue)가 아니다',
  },
  {
    name: 'M3 record 선언 순서를 뒤집는다 — 대표가 지휘통제가 아니게 된다',
    from: "  if (rec && rec.kind === 'record') return rec.entries.map(e => e.key)",
    to: "  if (rec && rec.kind === 'record') return rec.entries.map(e => e.key).reverse()",
    expect: '대표 = command',
  },
  {
    name: 'M4 rows 선언 순서를 뒤집는다 — 기록부 대표가 마지막 열이 된다',
    from: "  if (row && row.kind === 'rows') return row.cols.map(c => c.key)",
    to: "  if (row && row.kind === 'rows') return row.cols.map(c => c.key).reverse()",
    expect: '비고(note)가 아니다',
  },
  {
    name: 'M5 선언 순서에서 **마지막** 비지 않은 값을 집는다 — 첫 칸 계약 상실',
    from: "  return ordered.find(t => t.trim()) ?? ''",
    to: "  return [...ordered].reverse().find(t => t.trim()) ?? ''",
    expect: '대표 = command',
  },
  {
    name: 'M6 팀별임무 가지만 되돌린다 — 한 섹션만 조용히 구계약',
    from: '        return firstDeclared(sectionKey, dict(b))',
    to: "        return Object.values(dict(b)).map(s).find(t => t.trim()) ?? ''",
    expect: '응급구조(rescue)가 아니다',
  },
  {
    name: 'M7 기록부 가지만 되돌린다 — 공사·정비가 다시 비고를 띄운다',
    from: "        return r ? firstDeclared(sectionKey, r as Dict) : ''",
    to: "        return r ? Object.values(r).find(t => t.trim()) ?? '' : ''",
    expect: '비고(note)가 아니다',
  },
  // ── 존속 축 — 대표 칸을 **명시해 둔** 3섹션까지 일반화하면 안 된다(선언 첫 칸이 대표가 아니다) ──
  {
    name: 'M8 3.4를 선언 순서로 일반화 — 대표가 절차 대신 비화재보가 된다',
    from: "      case 'evacPlan': return s(b.procedure)",
    to: "      case 'evacPlan': return firstDeclared(sectionKey, dict(b))",
    expect: '대표는 procedure',
  },
  {
    name: 'M9 1.11을 선언 순서로 일반화 — 대표가 분류자(scenarioType)가 된다',
    from: "      case 'training': return s(b.scenario)",
    to: "      case 'training': return firstDeclared(sectionKey, dict(b))",
    expect: '대표는 scenario',
  },
]

const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only)) : MUTANTS
if (only && TARGETS.length === 0) throw new Error(`MUT=${only} 에 맞는 변이가 없다`)

let caught = 0
for (const m of TARGETS) {
  const original = readFileSync(SEC, 'utf8')
  try {
    if (!original.includes(m.from)) {
      throw new Error(`치환 대상을 못 찾음 (${SEC}) — 변이가 적용되지 않았다:\n${m.from}`)
    }
    const mutated = original.replace(m.from, m.to)
    if (mutated === original) throw new Error(`0건 치환 — 변이가 안 먹었다: ${m.name}`)
    writeFileSync(SEC, mutated)

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
    writeFileSync(SEC, original)
  }
}

console.log(`\n변이 ${caught}/${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
