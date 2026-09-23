// 변이 프로브 — 고객 등록 화면 정렬(2026-09-23)이 실제로 물리는지 본다.
//
// 가장 무서운 변이는 G1·G2 — 주소 검색이 **친 이름을 덮는** 옛 동작이 돌아오는 것. 고객명을 첫 커서로
// 올린 순간 「이름부터 치고 주소 검색」이 정상 동선이 되므로, 이 가드가 없으면 첫 커서 요청이 곧
// 데이터 손실 경로가 된다. 그리고 O3 — 필수 칸이 접힌 ④로 들어가면 [등록]이 영영 잠긴다(화면엔 에러 없음).
//
// 🚨 from은 한 줄짜리만, 파일 안에 **정확히 1건**이어야 한다(여러 번이면 엉뚱한 자리를 문다).
// 실행: node scripts/_mutate-customer-new-layout.mjs   (MUT=G1 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const FORM = 'src/components/customers/customer-new-client.tsx'
const SUITE = 'npx tsx scripts/test-customer-new-layout.mts'

const MUTANTS = [
  {
    name: 'F1 첫 커서를 뺀다 — 페이지를 열어도 커서가 어디에도 없다',
    from: '              autoFocus\n',
    to: '',
    expect: 'autoFocus가 있다',
  },
  {
    name: 'F2 첫 커서를 주소로 옮긴다 — autoFocus가 둘이면 마지막이 이긴다',
    from: '                id="new-address"',
    to: '                id="new-address" autoFocus',
    expect: '하나뿐',
  },
  {
    name: 'G1 ★ 주소 검색이 다시 무조건 덮는다 — 친 이름이 건물명으로 바뀐다',
    from: "      const building = typedName ? '' : extractBuildingName(data.roadAddress)",
    to: '      const building = extractBuildingName(data.roadAddress)',
    expect: '뽑지도 않는다',
  },
  {
    name: 'G2 ★ setForm 가드를 뺀다 — 늦게 친 이름도 덮는다',
    from: '        setForm(prev => ({ ...prev, customer_name: prev.customer_name.trim() ? prev.customer_name : building }))',
    to: '        setForm(prev => ({ ...prev, customer_name: building }))',
    expect: '비었을 때만 채운다',
  },
  {
    name: 'G3 판정을 낡은 form으로 — 콜백 당시 값이라 방금 친 이름을 못 본다',
    from: "      const typedName = (customerNameRef.current?.value ?? '').trim()",
    to: '      const typedName = form.customer_name.trim()',
    expect: '지금 칸의 값',
  },
  {
    // 두 날짜 칸의 **자리를 맞바꾼다**(id 교환) — 점검일자가 사용승인일보다 앞에 선다(종전 배치).
    //   첫 판은 라벨 글자만 비틀어 순서를 안 바꿨다 — 아무것도 되돌리지 않는 변이는 무엇도 증명 못 한다.
    name: 'O1 사용승인일과 점검일자의 자리를 맞바꾼다',
    swap: ['              id="new-use-approval"', '            id="new-anchor-date"'],
    swapTo: ['              id="new-anchor-date"', '            id="new-use-approval"'],
    expect: '순서',
  },
  {
    name: 'O2 두 칸 배치를 되살린다',
    from: '    <div className="max-w-3xl space-y-4">',
    to: '    <div className="flex flex-col lg:flex-row gap-6 items-start">',
    expect: '두 칸 배치',
  },
  {
    name: 'O3 ★ 사용승인일 id를 ④ 안의 계약일과 맞바꾼다 — 필수가 접힌 칸에 들어간다',
    from: '              id="new-contract-date"',
    to: '              id="new-use-approval"',
    expect: '어느 것도 ④ 안에 없다',
  },
  {
    name: 'O4 읽기전용 우편번호 칸을 되살린다',
    from: '            <p data-testid="new-address-meta" className="text-form-xs text-ink-meta">',
    to: '            <p data-testid="new-address-meta" className="text-form-xs text-ink-meta"><input readOnly value="" />',
    expect: '읽기전용',
  },
  {
    name: 'C1 ④를 기본 펼침으로 되돌린다',
    from: '  const [showOptional, setShowOptional] = useState(false)',
    to: '  const [showOptional, setShowOptional] = useState(true)',
    expect: '기본 접힘',
  },
  {
    name: 'C2 하단 바의 sticky를 뺀다 — 스크롤하면 [등록]이 사라진다',
    from: '        className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 py-3 bg-surface/95 backdrop-blur border-t border-line"',
    to: '        className="flex flex-wrap items-center gap-3 py-3 bg-surface/95 backdrop-blur border-t border-line"',
    expect: 'sticky',
  },
  {
    name: 'C3 칩 순서를 옛 순서로 — 주소가 고객명보다 앞',
    from: "    ['고객명', !!form.customer_name.trim()],\n    ['주소', !!form.address.trim()],",
    to: "    ['주소', !!form.address.trim()],\n    ['고객명', !!form.customer_name.trim()],",
    expect: '칩 순서',
  },
]

const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only + ' ')) : MUTANTS
if (only && TARGETS.length === 0) throw new Error(`MUT=${only} 에 맞는 변이가 없다`)

let caught = 0
for (const m of TARGETS) {
  const original = readFileSync(FORM, 'utf8')
  // 이 파일이 CRLF로 바뀌어 있어도 물리도록 줄끝을 맞춘다(0건 치환 방지)
  const nl = original.includes('\r\n') ? '\r\n' : '\n'
  const from = (m.from ?? '').replace(/\n/g, nl), to = (m.to ?? '').replace(/\n/g, nl)
  try {
    let mutated
    if (m.swap) {
      // 두 자리를 **동시에** 바꾼다(자리표 경유) — 한쪽씩 바꾸면 두 번째가 첫 번째 결과를 문다
      for (const x of m.swap) {
        const k = original.split(x).length - 1
        if (k !== 1) throw new Error(`swap 대상이 ${k}건 — 정확히 1건이어야 한다: ${x}`)
      }
      mutated = original.replace(m.swap[0], '\u0000A').replace(m.swap[1], '\u0000B')
        .replace('\u0000A', m.swapTo[0]).replace('\u0000B', m.swapTo[1])
    } else {
      const n = original.split(from).length - 1
      if (n !== 1) throw new Error(`치환 대상이 ${n}건 — 정확히 1건이어야 한다:\n${m.from}`)
      mutated = original.replace(from, to)
    }
    if (mutated === original) throw new Error(`0건 치환 — 변이가 안 먹었다: ${m.name}`)
    writeFileSync(FORM, mutated)
    let out = '', failed = false
    try { out = execSync(SUITE, { encoding: 'utf8', stdio: 'pipe' }) }
    catch (err) { failed = true; out = `${err.stdout ?? ''}${err.stderr ?? ''}` }
    const red = out.split('\n').filter(l => l.includes('❌'))
    const hit = red.some(l => l.includes(m.expect))
    if (failed && hit) { caught++; console.log(`✅ ${m.name}\n     → 빨강: ${red.map(l => l.trim()).slice(0, 2).join(' | ')}`) }
    else if (failed) console.log(`⚠️  ${m.name}\n     → 빨강이긴 한데 의도한 단언이 아니다(기대: "${m.expect}")\n     → ${red.map(l => l.trim()).slice(0, 2).join(' | ') || '(❌ 줄 없음)'}`)
    else console.log(`❌ ${m.name}\n     → 제품을 되돌렸는데 스위트가 초록이다 — 이 축을 무는 단언이 없다`)
  } finally {
    writeFileSync(FORM, original)
  }
}
console.log(`\n변이 ${caught}/${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
