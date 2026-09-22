// 변이 프로브 — 「고지 → 채우러 가기 → 자동 재발행」 축(2026-09-22)이 실제로 물리는지 본다.
//
// 이 축의 실패는 **조용하다**: 칩을 눌러 채우고 돌아왔는데 아무 일도 안 일어나거나,
// 엉뚱한 화면에 도착하거나, 복귀 경로가 없어 왕복이 안 닫힌다. 화면상 멀쩡해 보인다.
//
// 가장 중요한 변이는 M1 — **쪽지를 이동 뒤에서 쓰기**. 이 저장소가 같은 자리에서 한 번 물렸다
// (`plan-annex-round-card.tsx:121`). 그리고 M6 — 달력에 발행 가드를 이식하는 것(명시 금지 방향).
//
// 🚨 from은 한 줄짜리만 쓴다 — 이 저장소 소스는 CRLF가 섞여 여러 줄 문자열이 조용히 안 맞는다.
//
// 실행: node scripts/_mutate-calendar-workbook-notice.mjs   (MUT=M3 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const CLIENT = 'src/components/inspections/inspection-calendar-client.tsx'
const LIST = 'src/components/ui/doc-notice-list.tsx'
const LIB = 'src/lib/workbook-notice.ts'
const BTN = 'src/components/inspections/workbook-xlsx-button.tsx'
const SUITE = 'npx tsx scripts/test-calendar-workbook-notice.mts'

const MUTANTS = [
  {
    name: 'M1 쪽지를 이동 **뒤**로 옮긴다 — 채우고 돌아와도 아무 일이 없다',
    file: LIST,
    from: '            onClick={() => onNavigate?.(p)}',
    to: '            onMouseLeave={() => onNavigate?.(p)}',
    expect: 'onNavigate를 **이동 전에**',
  },
  {
    name: 'M2 점검표 주소를 베껴 적는다 — stepInputLink와 갈라질 문이 열린다',
    file: LIB,
    from: "    case 'sheet':      return step(1)                         // 점검표 입력 전용 페이지",
    to: "    case 'sheet':      return `/inspections/${i}/sheet`",
    expect: 'stepInputLink(1)과 **같은 주소**',
  },
  {
    name: 'M3 복귀 경로를 뗀다 — 채우러 갔다가 달력으로 못 돌아온다',
    file: CLIENT,
    from: '                    return `${base}${base.includes(\'?\') ? \'&\' : \'?\'}from=${encodeURIComponent(calendarBackHref)}`',
    to: '                    return base',
    expect: '복귀 경로가 붙는다',
  },
  {
    name: 'M4 돌아와도 쪽지를 안 집는다 — [지금 받기]가 안 뜬다',
    file: CLIENT,
    from: '    if (takePendingDoc(id, Date.now())) setResumedDoc(true)',
    to: '    void id',
    expect: '쪽지를 소비해',
  },
  {
    name: 'M5 회차가 바뀌어도 고지를 안 버린다 — 남의 빈칸을 이 회차 것으로 읽는다',
    file: CLIENT,
    from: "    setWbNotice([]); setWbError(''); setResumedDoc(false)",
    to: '    void 0',
    expect: '이전 고지를 버린다',
  },
  {
    name: 'M6 달력에 발행 가드를 이식한다 — 이 패널이 **명시적으로 금지한** 방향',
    file: CLIENT,
    from: '                  onNavigate={() => writePendingDoc(selectedInspection.id, \'xlsx\', Date.now())}',
    to: '                  onNavigate={() => { if (window.confirm(\'미입력이 있습니다\')) writePendingDoc(selectedInspection.id, \'xlsx\', Date.now()) }}',
    expect: 'window.confirm 발행 가드를 이식하지 않았다',
  },
  {
    name: 'M7 버튼이 고지를 늘 자기가 그린다 — 달력이 칩으로 못 바꾼다',
    file: BTN,
    from: '  const owns = !onNotice && !onError          // 고지를 내가 그리는가',
    to: '  const owns = true',
    expect: '종전대로 자기가 그린다',
  },
  {
    // 분리 규칙이 순수 함수로 나온 뒤(R5 수리) 여기를 친다 — JSX 안 filter였을 땐
    // 모양만 보는 단언이 못 잡아 이 변이가 살아남았다.
    name: 'M8 상한을 칩 덩이에 섞는다 — 못 고치는 것을 고치러 보낸다',
    file: LIB,
    from: "    fixable: parts.filter(p => p.kind === 'fixable' && p.scope !== 'org'),",
    to: "    fixable: parts.filter(p => (p.kind === 'fixable' || p.kind === 'cap') && p.scope !== 'org'),",
    expect: 'fixable 1개'
  },
  {
    name: 'M9 참여자 목적지를 ④로 — 「참여 인력」 칸이 없는 곳으로 보낸다',
    file: LIB,
    from: "    case 'crew':       return step(2)                         // ②「참여 인력」 — 참여자는 그 슬롯 하나다",
    to: "    case 'crew':       return step(4)",
    expect: '참여자 = stepInputLink(2)',
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
