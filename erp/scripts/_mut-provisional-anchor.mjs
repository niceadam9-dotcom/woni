/** 변이 — 「잠정 기산점」 단언이 **정말 빨강이 되는가**.
 *
 *  🚨 이 저장소에서 「모양만 보는 소스 단언」이 여러 번 공허하게 초록이었다. 바로 직전
 *     R-시리즈에서도 변이 둘이 살아남아 구멍을 드러냈다(식별자만 보는 단언 / 속성 위치).
 *  🚨 치환 건수를 **못박는다** — CRLF·들여쓰기로 앵커가 빗나가면 0건 치환인데 초록이 된다.
 *
 *  실행: node scripts/_mut-provisional-anchor.mjs           (목록)
 *        node scripts/_mut-provisional-anchor.mjs N1        (적용)
 *        npx tsx scripts/test-provisional-anchor.mts        (빨강이어야 한다)
 *        node scripts/_mut-provisional-anchor.mjs restore   (반드시)
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs'

const F = {
  anchor: new URL('../src/lib/plan-anchor.ts', import.meta.url),
  list: new URL('../src/lib/customer-list.ts', import.meta.url),
  listpage: new URL('../src/app/(dashboard)/customers/page.tsx', import.meta.url),
  neu: new URL('../src/components/customers/customer-new-client.tsx', import.meta.url),
  edit: new URL('../src/components/customers/edit-customer-info-client.tsx', import.meta.url),
  cal: new URL('../src/components/inspections/inspection-calendar-client.tsx', import.meta.url),
}
const bakOf = (u) => new URL(u.href + '.mutbak')

const MUTS = [
  // ── 판정(순수) ───────────────────────────────────────────────────────────
  {
    id: 'N1', file: 'anchor', n: 1,
    desc: '사람이 고른 예외(manual=true)도 **잠정으로 본다** — 정상인 87명이 전부 빨간 칩을 단다',
    find: `  if (c.plan_anchor_manual === true) return false\n  const r = resolveAnchor(c)`,
    repl: `  const r = resolveAnchor(c)`,
    expect: '①🎯 사용승인일 없음 + manual=true = 잠정 아님 / ① 레거시 + manual=true',
  },
  {
    id: 'N2', file: 'anchor', n: 1,
    desc: '**보유로 판정**(`!use_approval_date`)으로 되돌림 — 레거시에서 「가지고도 안 쓰는」 상태를 놓친다',
    find: `  return r.source !== 'approval'`,
    repl: `  return !c.use_approval_date`,
    expect: '①🚨 레거시 + 사용승인일 있음 = **잠정**',
  },
  {
    id: 'N3', file: 'anchor', n: 1,
    desc: '기산점이 **아예 없어도** 잠정으로 본다 — 「없음」과 「잠정」이 뭉개진다',
    find: `  if (!r.date) return false\n`,
    repl: ``,
    expect: '① 기산점 자체가 없으면 잠정이 아니다',
  },
  {
    id: 'N4', file: 'anchor', n: 1,
    desc: '판정을 **반전** — 법정 축인 고객만 잠정이 된다',
    find: `  return r.source !== 'approval'`,
    repl: `  return r.source === 'approval'`,
    expect: '①🎯 사용승인일 없음 + manual=false = 잠정 (외 다수)',
  },
  // ── 목록 배선 ───────────────────────────────────────────────────────────
  {
    id: 'N5', file: 'list', n: 1,
    desc: '판정 재료(plan_anchor_manual)를 **안 싣는다** — 전원이 레거시로 읽혀 87명이 오판된다',
    find: `      plan_anchor_manual,\n`,
    repl: ``,
    expect: '④ 판정 재료(plan_anchor_manual)를 실제로 조회한다',
  },
  {
    id: 'N6', file: 'list', n: 1,
    desc: '목록이 **자기 식으로 다시 센다**(규칙 두 벌 — manual=true 87명이 갈린다)',
    find: `      provisionalAnchor: isProvisionalAnchor({`,
    repl: `      provisionalAnchor: !r.use_approval_date && !!({`,
    expect: '④ 판정은 공용 함수 한 벌 / ④ 목록이 잠정을 계산해 싣는다',
  },
  {
    id: 'N7', file: 'list', n: 1,
    desc: '「잠정 기산점만」 필터가 **엉뚱한 걸 거른다**(미완료 전체)',
    find: `  if (f.inc === 'approval') return items.filter(i => i.provisionalAnchor)`,
    repl: `  if (f.inc === 'approval') return items.filter(i => i.incompleteAreas.length > 0)`,
    expect: '④ 그 필터가 provisionalAnchor로 거른다',
  },
  {
    id: 'N8', file: 'listpage', n: 1,
    desc: '목록 행 칩을 **행에서 다시 센다** — 서버 판정과 갈린다',
    find: `                        {c.provisionalAnchor && (`,
    repl: `                        {!c.use_approval_date && (`,
    expect: '④ 칩이 **서버가 준 값**을 읽는다',
  },
  {
    id: 'N9', file: 'listpage', n: 1,
    desc: '필터 드롭다운에서 선택지를 **뺀다** — 판정은 있는데 고를 수가 없다',
    find: `          <option value="approval">잠정 기산점만</option>\n`,
    repl: ``,
    expect: '④ 화면 드롭다운에 그 선택지가 있다',
  },
  // ── 등록 폼 ─────────────────────────────────────────────────────────────
  {
    id: 'N10', file: 'neu', n: 1,
    desc: '잠정 안내에서 「일정은 그대로 생성된다」를 **뺀다** — 막힌 줄 알고 사용자가 멈춘다',
    find: `                  일정은 <b>그대로 생성</b>되고(종합·작동·정기), 나중에 사용승인일을 넣으면 <b>법정 자리로 자동 재배치</b>됩니다.`,
    repl: `                  사용승인일을 입력해주세요.`,
    expect: '② 「일정은 그대로 생성된다」 / ② 「나중에 넣으면 재배치」',
  },
  {
    id: 'N11', file: 'neu', n: 1,
    desc: '사용승인일을 **저장 차단 조건으로** 쓴다 — 군부대·쉼터가 등록 불가가 된다',
    find: `    if (!form.plan_anchor_date) { setError('점검일자를 입력해주세요.'); return }`,
    repl: `    if (!form.plan_anchor_date) { setError('점검일자를 입력해주세요.'); return }\n    if (!form.use_approval_date) { setError('사용승인일을 입력해주세요.'); return }`,
    expect: '②⛔ 사용승인일을 저장 차단 조건으로 쓰지 않는다',
  },
  // ── 고객 화면 ───────────────────────────────────────────────────────────
  {
    id: 'N12', file: 'edit', n: 1,
    desc: '수정 화면이 배지에 잠정을 **안 넘긴다** — 판정은 있는데 화면이 침묵한다',
    find: `              provisional={isProvisionalAnchor(anchorInput)}\n`,
    repl: ``,
    expect: '③ 고객 수정 화면이 배지에 잠정을 넘긴다',
  },
  // ── 달력 입구 ───────────────────────────────────────────────────────────
  {
    id: 'N13', file: 'cal', n: 1,
    desc: '칸의 `+`를 **호버 전엔 숨긴다** — 터치·비호버 환경에선 없는 것과 같다',
    find: `              className="opacity-40 hover:opacity-100 focus:opacity-100 text-brand`,
    repl: `              className="opacity-0 hover:opacity-100 focus:opacity-100 text-brand`,
    expect: '⑤ 흐리게 두되 숨기지 않는다(opacity-0가 아니다)',
  },
  {
    id: 'N14', file: 'cal', n: 1,
    desc: '칸 `+`의 **전파를 안 끊는다** — 누르면 등록 모달과 데이 패널이 같이 열린다',
    find: `              onClick={e => { e.stopPropagation(); e.preventDefault(); openNewCustomer(iso) }}`,
    repl: `              onClick={() => openNewCustomer(iso)}`,
    expect: '⑤ 전파를 끊는다',
  },
  {
    id: 'N15', file: 'cal', n: 1,
    desc: '데이 패널 등록 버튼을 **테두리로 되돌림** — 형제 셋에 다시 묻힌다',
    find: `                        className="text-form-xs font-medium bg-brand text-white rounded-lg px-2.5 py-1 hover:opacity-90`,
    repl: `                        className="text-form-xs font-medium text-brand border border-brand-line rounded-lg px-2 py-0.5 hover:bg-brand-tint`,
    expect: '⑤ 데이 패널 등록 버튼이 채움색이다',
  },
  {
    id: 'N16', file: 'cal', n: 1,
    desc: '형제(사전안내)도 **채움으로** — 채움이 둘이면 강조가 죽는다',
    find: `                        className="text-form-xs font-medium text-brand border border-brand-line rounded-lg px-2 py-0.5 hover:bg-brand-tint transition-colors inline-flex items-center gap-1 whitespace-nowrap"\n                        title="이 날짜에 방문하는 고객에게 사전 안내 문자를 보냅니다">`,
    repl: `                        className="text-form-xs font-medium bg-brand text-white rounded-lg px-2 py-0.5 transition-colors inline-flex items-center gap-1 whitespace-nowrap"\n                        title="이 날짜에 방문하는 고객에게 사전 안내 문자를 보냅니다">`,
    expect: '⑤ 형제 버튼(사전안내)은 테두리 그대로다',
  },
  {
    id: 'N17', file: 'cal', n: 1,
    desc: '칸 `+`를 **권한 없이도** 그린다 — 등록 못 하는 사람에게 입구를 보여준다',
    find: `          {canCreateCustomer && (\n            <button\n              type="button"\n              data-testid="calendar-cell-new-customer"`,
    repl: `          {true && (\n            <button\n              type="button"\n              data-testid="calendar-cell-new-customer"`,
    expect: '⑤ 권한이 없으면 안 그린다',
  },
]

const arg = process.argv[2]

if (!arg) {
  console.log('변이 목록 — 잠정 기산점\n')
  for (const m of MUTS) console.log(`  ${m.id.padEnd(4)} [${m.file.padEnd(8)}] ${m.desc}\n       기대: ${m.expect}`)
  console.log(`\n총 ${MUTS.length}건`)
  process.exit(0)
}

if (arg === 'restore') {
  let n = 0
  for (const key of Object.keys(F)) {
    const bak = bakOf(F[key])
    if (!existsSync(bak)) continue
    copyFileSync(bak, F[key]); unlinkSync(bak); n++
    console.log(`  ↩ ${key} 복원`)
  }
  console.log(n ? `\n${n}개 파일 복원 완료` : '\n복원할 백업이 없습니다(이미 원본)')
  process.exit(0)
}

const mut = MUTS.find(m => m.id === arg)
if (!mut) { console.error(`알 수 없는 변이: ${arg}`); process.exit(2) }
const target = F[mut.file]
if (existsSync(bakOf(target))) {
  console.error(`이미 변이가 적용돼 있습니다(${mut.file}) — 먼저 restore 하세요`); process.exit(2)
}
const src = readFileSync(target, 'utf8')
/* 🚨 줄끝을 **양쪽 다** 시도한다. 이 저장소는 파일마다 LF·CRLF가 섞여 있어서(같은 커밋 안에서도
   갈린다) `\n`만 든 앵커는 CRLF 파일에서 **0건 치환**이 된다 — 실제로 N5·N9·N12가 그렇게 빗나갔다.
   0건인데 「적용됨」으로 보이면 변이가 안 돌았는데 초록이라 **검사가 무사한 줄 착각**한다. */
const crlf = (s) => s.replace(/\n/g, '\r\n')
const variants = [[mut.find, mut.repl], [crlf(mut.find), crlf(mut.repl)]]
const picked = variants.find(([f]) => src.split(f).length - 1 === mut.n)
if (!picked) {
  const counts = variants.map(([f]) => src.split(f).length - 1)
  console.error(`앵커 불일치: ${mut.id} — LF ${counts[0]}건 / CRLF ${counts[1]}건 발견, ${mut.n}건 기대. 변이를 적용하지 않았습니다.`)
  process.exit(3)
}
const hits = mut.n
copyFileSync(target, bakOf(target))
writeFileSync(target, src.split(picked[0]).join(picked[1]), 'utf8')
console.log(`  ✂ ${mut.id} 적용 (${mut.file}, ${hits}건 치환) — ${mut.desc}`)
console.log(`     기대 빨강: ${mut.expect}`)
