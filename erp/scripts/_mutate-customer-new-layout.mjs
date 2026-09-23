// 변이 프로브 — 고객 화면 「그룹 단위 정렬 + 핵심 칸 강조」(2026-09-23)가 실제로 물리는지 본다.
//
// 가장 무서운 변이:
//  · R1 — 배지 판정이 뒤집힌다: 화면이 「사용승인일=기산점」이라 말하는데 일정은 점검일자로 잡힌다.
//         강조 디자인이 **거짓을 크게** 말하게 된다(안 보이던 때보다 나쁘다).
//  · G1·G2 — 주소 검색이 친 이름을 덮는다(고객명이 첫 칸이라 이름부터 친다).
//  · C1 — 열 수를 화면 폭으로: 상세 탭(요약 패널 옆)에서 날짜가 잘리고 글자가 꺾인다(실측으로 잡은 결함).
//
// 🚨 from은 파일 안에 **정확히 1건**. 줄끝(CRLF/LF)은 파일에 맞춘다. swap은 두 자리를 동시에 맞바꾼다.
// 실행: node scripts/_mutate-customer-new-layout.mjs   (MUT=R1 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const NEW = 'src/components/customers/customer-new-client.tsx'
const INFO = 'src/components/customers/edit-customer-info-client.tsx'
const KF = 'src/components/customers/key-fields.tsx'
const ROLE = 'src/lib/anchor-role.ts'
const TABS = 'src/components/customers/customer-tabs.tsx'
const PAGE = 'src/app/(dashboard)/customers/[id]/page.tsx'
const SUITE = 'npx tsx scripts/test-customer-new-layout.mts'

const MUTANTS = [
  { name: 'F1 첫 커서를 뺀다', file: NEW, from: '                autoFocus\n', to: '', expect: 'autoFocus' },
  { name: 'G1 ★ 주소 검색이 다시 무조건 덮는다', file: NEW,
    from: "      const building = typedName ? '' : extractBuildingName(data.roadAddress)",
    to: '      const building = extractBuildingName(data.roadAddress)', expect: '뽑지 않는다' },
  { name: 'G2 ★ setForm 가드를 뺀다', file: NEW,
    from: '        setForm(prev => ({ ...prev, customer_name: prev.customer_name.trim() ? prev.customer_name : building }))',
    to: '        setForm(prev => ({ ...prev, customer_name: building }))', expect: 'setForm도 비었을 때만' },
  { name: 'R1 ★ 배지 판정을 뒤집는다 — 화면이 거짓 기산점을 크게 말한다', file: ROLE,
    from: "    approval: role(r.source === 'approval', c.use_approval_date),",
    to: "    approval: role(r.source !== 'approval', c.use_approval_date),", expect: '기산점' },
  { name: 'R2 배지가 예외 스위치를 못 본다 — 「점검일자 쓰기」를 켜도 사용승인일=기산점', file: NEW,
    from: '    plan_anchor_manual: anchorManual,\n  })\n  const need', to: '  })\n  const need', expect: '예외 스위치' },
  { name: 'A1 등록 기준일 줄의 강조를 뺀다', file: NEW,
    from: '<SubRow label="기준일" accent testId="new-keydates">', to: '<SubRow label="기준일" testId="new-keydates">',
    expect: '강조 줄(accent)' },
  { name: 'A2 기본정보 기준일 줄의 강조를 뺀다', file: INFO,
    from: '<SubRow label="기준일" accent testId="info-keydates">', to: '<SubRow label="기준일" testId="info-keydates">',
    expect: '한 강조 줄 안' },
  { name: 'K1 사용승인일을 보통 칸으로 — 크게 안 보인다', file: NEW,
    from: "              className={`${inputCls} ${keyInputCls} ${need(reqOf('사용승인일')) ? emptyRequiredCls : ''}`}",
    to: "              className={`${inputCls} ${need(reqOf('사용승인일')) ? emptyRequiredCls : ''}`}", expect: '큰 칸(keyInputCls)' },
  { name: 'S1 법정 시기를 기준일 줄 밖으로 — 날짜를 고쳐도 옆에서 안 바뀐다', file: INFO,
    from: '          <Cell span={2} label="이 날짜로 잡히는 일정" testId="info-legal">',
    to: '        </SubRow><SubRow label="결과">\n          <Cell span={2} label="이 날짜로 잡히는 일정" testId="info-legal">', expect: '한 강조 줄 안' },
  { name: 'N1 기본정보 첫 줄에서 고객명을 담당 뒤로', file: INFO,
    swap: ['<input id="cf-name" ', '<input id="cf-station" '], swapTo: ['<input id="cf-station" ', '<input id="cf-name" '],
    expect: '순서' },
  { name: 'C1 ★ 열 수를 화면 폭으로 되돌린다 — 상세 탭에서 날짜가 잘린다', file: KF,
    from: '@md:grid-cols-2 @4xl:grid-cols-4', to: 'sm:grid-cols-2 xl:grid-cols-4', expect: '상자 폭(@container)' },
  { name: 'W1 기본정보 탭의 넓게 쓰기를 뺀다', file: PAGE,
    from: "        wideKeys={['info', 'buildings', 'contacts']}", to: '', expect: '넓게(wideKeys)' },
  { name: 'W2 넓게 쓰면서 요약 패널까지 접는다', file: TABS,
    from: '{summary && !isFull && summary}', to: '{summary && !isFull && !isWide && summary}', expect: '넓게(wideKeys)' },
  // ── 2026-09-23 후속: 저장 버튼 상시 · 담당 칸 · 건물·관계인 「기본정보처럼」 ──
  { name: 'V1 ★ 저장 버튼을 다시 「고쳐야만」 보이게 — 사용자가 「저장버튼이 없네?」라 한 그 화면', file: INFO,
    from: '        {canManage && (\n          <div data-testid="info-save-bar"',
    to: '        {canManage && isDirty && (\n          <div data-testid="info-save-bar"', expect: '늘** 있다' },
  { name: 'V2 그룹 상자를 overflow-hidden으로 — sticky 저장 줄이 안 붙는다', file: KF,
    from: "overflow-clip`}>", to: "overflow-hidden`}>", expect: 'sticky' },
  { name: 'V3 담당 칸의 fill을 뺀다 — 옆 칸보다 낮고 좁게', file: PAGE,
    from: '              canAssign={canAssign}\n              fill\n', to: '              canAssign={canAssign}\n', expect: 'fill' },
  { name: 'B1 건물 기준일 줄의 강조를 뺀다', file: 'src/components/customers/building-inline-panel.tsx',
    from: '<SubRow label="기준일" accent testId="building-keydates">', to: '<SubRow label="기준일" testId="building-keydates">',
    expect: '사용승인일·건축허가일' },
  { name: 'B2 건물 상자 제목을 탭 이름으로 — §10-2 ③ 확정 위반', file: 'src/components/customers/building-inline-panel.tsx',
    from: '<GroupBox n={2} title="건물정보"', to: '<GroupBox n={2} title="건물·시설"', expect: '「건물정보」 그대로' },
  { name: 'P1 ★ 선임일·교육이수일 순서를 바꾼다 — E2E의 .first()가 엉뚱한 칸을 문다',
    file: 'src/components/customers/fire-safety-manager-panel.tsx',
    swap: ['            <label className={labelCls}>선임일</label>', '            <label className={labelCls}>최근 교육이수일</label>'],
    swapTo: ['            <label className={labelCls}>최근 교육이수일</label>', '            <label className={labelCls}>선임일</label>'],
    expect: '첫 날짜 칸' },
  { name: 'P2 관계인 탭을 넓게 쓰지 않는다', file: PAGE,
    from: "wideKeys={['info', 'buildings', 'contacts']}", to: "wideKeys={['info', 'buildings']}", expect: '세 탭 모두 넓게' },
]

const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only + ' ')) : MUTANTS
if (only && TARGETS.length === 0) throw new Error(`MUT=${only} 에 맞는 변이가 없다`)

let caught = 0
for (const m of TARGETS) {
  const original = readFileSync(m.file, 'utf8')
  const nl = original.includes('\r\n') ? '\r\n' : '\n'
  const fix = s => (s ?? '').replace(/\r?\n/g, nl)
  try {
    let mutated
    if (m.swap) {
      for (const x of m.swap) {
        const k = original.split(x).length - 1
        if (k !== 1) throw new Error(`swap 대상이 ${k}건 — 정확히 1건이어야 한다: ${x}`)
      }
      mutated = original.replace(m.swap[0], '\u0000A').replace(m.swap[1], '\u0000B')
        .replace('\u0000A', m.swapTo[0]).replace('\u0000B', m.swapTo[1])
    } else {
      const from = fix(m.from), to = fix(m.to)
      const n = original.split(from).length - 1
      if (n !== 1) throw new Error(`치환 대상이 ${n}건 (${m.file}) — 정확히 1건이어야 한다:\n${m.from}`)
      mutated = original.replace(from, to)
    }
    if (mutated === original) throw new Error(`0건 치환: ${m.name}`)
    writeFileSync(m.file, mutated)
    let out = '', failed = false
    try { out = execSync(SUITE, { encoding: 'utf8', stdio: 'pipe' }) }
    catch (err) { failed = true; out = `${err.stdout ?? ''}${err.stderr ?? ''}` }
    const red = out.split('\n').filter(l => l.includes('❌'))
    const hit = red.some(l => l.includes(m.expect))
    if (failed && hit) { caught++; console.log(`✅ ${m.name}\n     → 빨강: ${red.map(l => l.trim()).slice(0, 2).join(' | ')}`) }
    else if (failed) console.log(`⚠️  ${m.name}\n     → 빨강이긴 한데 의도한 단언이 아니다(기대: "${m.expect}")\n     → ${red.map(l => l.trim()).slice(0, 2).join(' | ') || '(❌ 줄 없음)'}`)
    else console.log(`❌ ${m.name}\n     → 제품을 되돌렸는데 스위트가 초록이다 — 이 축을 무는 단언이 없다`)
  } finally {
    writeFileSync(m.file, original)
  }
}
console.log(`\n변이 ${caught}/${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
