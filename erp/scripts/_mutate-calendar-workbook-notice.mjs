// 변이 프로브 — 달력 데이 패널의 엑셀 고지 축이 실제로 물리는지 본다.
//
// 🚨 2026-09-23 **다시 썼다.** 2026-09-22 사용자 요청으로 달력은 보고서 고지를 **그리지 않는다**
//   (31/31 상시라 400px 사이드바를 덮었다). 옛 변이 M3~M7은 사라진 배선을 물어 0건 치환이었다 →
//   W1~W9로 교대: 「뺀 화면이 조용히 돌아오는가」와 「과잉으로 오류·소방계획서 고지까지 걷었는가」.
//   목록·분류 축(M1·M2·M8·M9)은 소방계획서 칩이 계속 쓰므로 그대로 둔다.
//
// ── 아래는 첫 판(2026-09-22)의 머리말 ──
// 「고지 → 채우러 가기 → 자동 재발행」 축
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
  // ── 🚨 2026-09-23 계약 교대: 달력은 **보고서 고지를 그리지 않는다** ─────────────
  //   (옛 M3~M7은 사라진 배선 — 쪽지·복귀 띠·목적지 조립 — 을 물고 있어 0건 치환이었다)
  {
    name: 'W1 owns 식에서 onError를 뺀다 — 달력이 onError만 넘기면 버튼이 자기 고지를 되살린다',
    file: BTN,
    from: '  const owns = !onNotice && !onError          // 고지를 내가 그리는가',
    to: '  const owns = !onNotice',
    expect: 'owns 판정',
  },
  {
    name: 'W2 owns를 무시하고 늘 자기 고지를 쓴다',
    file: BTN,
    from: "  const notice = owns ? selfNotice : ''",
    to: '  const notice = selfNotice',
    expect: 'owns 판정',
  },
  {
    name: 'W3 달력이 보고서 고지를 다시 받는다',
    file: CLIENT,
    from: '                  onError={setWbError}',
    to: '                  onNotice={raw => setWbNotice(parseWorkbookNotice(raw))} onError={setWbError}',
    expect: '받지도 않는다',
  },
  {
    name: 'W4 보고서 줄에 고지 목록을 다시 그린다',
    file: CLIENT,
    from: '                {wbError && <p className="text-form-2xs text-red-600 w-full">{wbError}</p>}',
    to: '                <DocNoticeList parts={[]} />\n                {wbError && <p className="text-form-2xs text-red-600 w-full">{wbError}</p>}',
    expect: '고지 목록을 그리지',
  },
  {
    // 가장 그럴듯한 과잉 — 고지를 걷다가 오류까지 걷는다. 그러면 owns=true가 되어 **고지도 되살아난다**.
    name: 'W5 onError까지 걷어 낸다 — 다운로드 실패가 조용해지고 버튼 토스트가 되살아난다',
    file: CLIENT,
    from: '                  onError={setWbError}',
    to: '',
    expect: '오류 표시는 남아',
  },
  {
    name: 'W6 오류를 받기는 하는데 안 그린다',
    file: CLIENT,
    from: '                {wbError && <p className="text-form-2xs text-red-600 w-full">{wbError}</p>}',
    to: '',
    expect: '오류 표시는 남아',
  },
  {
    name: 'W7 회차가 바뀌어도 이전 오류를 안 버린다',
    file: CLIENT,
    from: "setWbError(''); setFpNotice([]); setFpError('')",
    to: "setFpNotice([]); setFpError('')",
    expect: '회차가 바뀌면',
  },
  {
    name: 'W8 달력에 발행 가드를 이식한다 — 이 패널이 명시적으로 금지한 방향',
    file: CLIENT,
    from: '                data-testid="daypanel-workbook"',
    to: `                data-testid="daypanel-workbook" onClickCapture={e => { if (!window.confirm('미입력이 있습니다')) e.preventDefault() }}`,
    expect: 'window.confirm',
  },
  {
    name: 'W9 과잉 제거 — 소방계획서 고지까지 걷는다(사용자는 「보고서 엑셀만」이라 했다)',
    file: CLIENT,
    from: 'parts={fpNotice}',
    to: 'parts={[]}',
    expect: '소방계획서 고지는',
  },
  // ── 목록 컴포넌트·분류 축 (소방계획서 칩이 계속 쓴다 — 종전 변이 유지) ─────────
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
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only + ' ')) : MUTANTS
if (only && TARGETS.length === 0) throw new Error(`MUT=${only} 에 맞는 변이가 없다`)

let caught = 0
for (const m of TARGETS) {
  const original = readFileSync(m.file, 'utf8')
  try {
    // 파일에 **정확히 한 번** 있어야 한다 — 여러 번이면 엉뚱한 자리를 물 수 있다.
    const n = original.split(m.from).length - 1
    if (n !== 1) throw new Error(`치환 대상이 ${n}건 (${m.file}) — 정확히 1건이어야 한다:\n${m.from}`)
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
