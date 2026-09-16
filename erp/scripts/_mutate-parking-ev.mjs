// 변이 프로브 — 전기차충전소 축(2026-09-16, 서식 1.1 `AS13`)의 단언이 실제로 "무는지" 본다.
//
// 왜 필요한가: `test-parking-surface.mts`가 초록이라는 사실은 "무언가를 잡는다"만 말해 줄 뿐
// "이것을 잡는다"를 말해 주지 않는다. 제품을 되돌리는 변이를 심어 **빨강이 되는지**,
// 그것도 **의도한 단언이** 빨강이 되는지 확인한다.
//
// 이 축의 쟁점은 둘이다:
//   ① 배선 — 판정·엑셀·PDF·화면 네 층 중 하나만 끊겨도 사용자에겐 없는 기능이다.
//   ② 누출 — 한 칸(`parking_summary`)을 두 사실이 나눠 쓰므로, 새 낱말이 별지 9호 상자나
//      14행 네 칸을 건드리면 **다른 서식이 조용히 틀린다**. M5가 그 감시자다.
//
// 실행: node scripts/_mutate-parking-ev.mjs        (DB·서버 불필요 — 순수 함수 축)
//       MUT=M5 node scripts/_mutate-parking-ev.mjs (하나만)
//
// 🚨 치환이 조용히 빗나가면 제품이 멀쩡한 채로 돌아 "초록 → 변이를 못 잡았다"로 오독하게 된다.
//    그래서 from 문자열이 없으면 **그 자리에서 죽인다**(건너뛰기 금지). CRLF도 함께 시도한다.
// 🚨 이게 도는 동안 대상 파일을 편집하지 말 것 — 변이마다 스냅샷을 떠서 되돌리므로 중간에 얹은
//    편집이 말없이 사라진다. `git status`는 그 되돌림을 안 알려 준다.
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const SUITE = 'npx tsx --conditions=react-server scripts/test-parking-surface.mts'

const R9 = 'src/lib/doc-templates/report9.ts'
const VAL = 'src/lib/fire-plan-xlsx-values.ts'
const ANC = 'src/lib/fire-plan-anchors.ts'
const TPL = 'src/lib/fire-plan-template.ts'
const UI = 'src/components/customers/building-inline-panel.tsx'
const ASM = 'src/lib/report9-assemble.ts'

/** expect = 이 변이로 빨강이 되어야 하는 단언 이름의 일부 (그 단언이 물어야 의미가 있다) */
const MUTANTS = [
  { name: 'M1 판정이 늘 거짓 — 채워도 상자가 안 켜진다',
    file: R9,
    from: '  return new RegExp(PK_EV_PATTERN).test(pk)',
    to: '  return false',
    expect: '「…, 전기차충전소」→ 켜짐' },

  { name: 'M2 엑셀 값 축 미배선 — 규칙은 옳은데 셀에 안 닿는다(이 결함의 원래 모양)',
    file: VAL,
    from: "boxLabelCell(FP_SHEET.F1_1, 'AS13', parseParkingEv(d.parkingSummary ?? ''))",
    to: "boxLabelCell(FP_SHEET.F1_1, 'AS13', false)",
    expect: '체크(■)된다' },

  { name: 'M3 앵커를 안 세운다 — 좌표가 없으면 값도 갈 곳이 없다',
    file: ANC,
    from: "  { field: 'parking_ev', sheet: FP_SHEET.F1_1, cell: 'AS13', labelCell: 'D13' },\n",
    to: '',
    expect: '앵커가 한 칸이다' },

  { name: 'M4 PDF만 미배선 — 엑셀은 켜지는데 인쇄물은 빈 상자(D-7 갈라짐)',
    file: TPL,
    from: " ${ck(pkEv, '전기차충전소')}",
    to: '',
    expect: 'PDF: 전기차충전소가 체크로 표시된다' },

  // 🚨 이 축의 핵심 감시자 — 낱말이 별지 9호 판정으로 새면 없는 주차장이 인쇄된다
  { name: 'M5 누출 — 전기차 낱말이 별지 9호 「옥외」까지 켠다',
    file: R9,
    from: "    pkOut: pk.includes('옥외'),",
    to: "    pkOut: pk.includes('옥외') || pk.includes('충전'),",
    expect: '별지 9호 일곱 상자가 하나도 안 켜진다' },

  { name: 'M6 판정과 지우기가 갈라진다 — 「전기차 충전기」가 칩으로 안 꺼진다',
    file: R9,
    from: "  return pk.replace(new RegExp(PK_EV_PATTERN, 'g'), '')",
    to: '  return pk.split(PK_EV_WORD).join(\'\')',
    expect: '손으로 「전기차 충전기」라 적어도 칩으로 끌 수 있다' },

  { name: 'M7 화면에 칩이 없다 — 켤 방법이 없으면 배선은 죽은 코드다',
    file: UI,
    from: "  { flag: 'ev', word: PK_EV_WORD, label: '전기차충전소' },\n",
    to: '',
    expect: '화면 칩 8개를 실제로 뽑았다' },

  { name: 'M8 칩 낱말 드리프트 — 라벨·플래그는 맞는데 눌러도 아무 일이 없다',
    file: UI,
    from: "  { flag: 'ev', word: PK_EV_WORD, label: '전기차충전소' },",
    to: "  { flag: 'ev', word: '전기차', label: '전기차충전소' },",
    expect: '의 낱말이 그 칩을 켠다' },

  { name: 'M9 화면 안내가 거짓이 된다 — 별지 9호에 인쇄된다고 적힌 채로 둔다',
    file: UI,
    from: ' · 「전기차충전소」는 별지 9호엔 칸이 없어 소방계획서 서식 1.1에만 인쇄',
    to: '',
    expect: '화면 안내가 전기차 칩의 인쇄처를 따로 밝힌다' },

  /* 🚨 `/g` 리터럴을 모듈에 두고 `.test()`를 부르면 `lastIndex`가 남아 같은 입력에 참·거짓이
   *   번갈아 나온다. 한 번만 묻는 검사로는 절대 안 보이는 부류다. */
  // 🚨 거짓 경보 축 — 한 칸을 두 사실이 나눠 쓰면서 생긴 결함이고, 잡는 단언이 없었다
  { name: 'M11 경보가 전기차 낱말을 안 걷는다 — 정상 문서마다 「미반영」 거짓 경보',
    file: R9,
    from: '  const rest = tidyParkingText(stripParkingEv(pk)).trim()',
    to: '  const rest = tidyParkingText(pk).trim()',
    expect: '전기차만 켠 값은 미반영 경고를 내지 않는다' },

  { name: 'M12 조립기가 그 술어를 안 부른다 — 규칙은 고쳤는데 경보는 옛것 그대로',
    file: ASM,
    from: '  const pkUnmatched = parkingUnmatchedForAnnex9(pk)',
    to: "  const pkUnmatched = pk.trim() && !data.pkIn ? pk.trim() : ''",
    expect: '배선: 조립기가 그 술어를 부른다' },

  { name: 'M10 정규식을 모듈에 /g로 들고 있는다 — 같은 입력에 답이 번갈아 나온다',
    file: R9,
    from: 'export function parseParkingEv(pk: string): boolean {\n  return new RegExp(PK_EV_PATTERN).test(pk)\n}',
    to: "const PK_EV_RE_G = new RegExp(PK_EV_PATTERN, 'g')\nexport function parseParkingEv(pk: string): boolean {\n  return PK_EV_RE_G.test(pk)\n}",
    expect: '같은 입력을 두 번 물어도 답이 같다' },
]

const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only)) : MUTANTS
if (only && !TARGETS.length) throw new Error(`MUT=${only} 없음`)
let caught = 0
for (const m of TARGETS) {
  const orig = readFileSync(m.file, 'utf8')
  try {
    const from = orig.includes(m.from) ? m.from : m.from.replace(/\n/g, '\r\n')
    if (!orig.includes(from)) throw new Error(`치환 대상을 못 찾음 (${m.file}):\n${m.from}`)
    const to = from === m.from ? m.to : m.to.replace(/\n/g, '\r\n')
    const mutated = orig.replace(from, to)
    // 🚨 0건 치환·무변화를 여기서 죽인다 — 제품이 그대로면 초록은 "못 잡았다"가 아니라 "안 돌았다"다
    if (mutated === orig) throw new Error(`치환했는데 내용이 그대로다 (${m.file}) — ${m.name}`)
    writeFileSync(m.file, mutated)
    let out = '', failed = false
    try { out = execSync(SUITE, { encoding: 'utf8', stdio: 'pipe' }) }
    catch (e) { failed = true; out = `${e.stdout ?? ''}${e.stderr ?? ''}` }
    const red = out.split('\n').filter(l => l.includes('FAIL'))
    const hit = red.some(l => l.includes(m.expect))
    if (failed && hit) { caught++; console.log(`✅ ${m.name}\n     → 빨강: ${red.map(l => l.trim()).slice(0, 3).join(' | ')}`) }
    else if (failed) console.log(`⚠️  ${m.name}\n     → 빨강이나 의도한 단언이 아니다(기대 "${m.expect}")\n     → ${red.map(l => l.trim()).slice(0, 3).join(' | ') || '(FAIL 없음 — 스위트가 죽었다)'}`)
    else console.log(`❌ ${m.name}\n     → 되돌렸는데 초록이다 — 무는 단언이 없다`)
  } finally { writeFileSync(m.file, orig) }
}
console.log(`\n변이 결과: ${caught} / ${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
