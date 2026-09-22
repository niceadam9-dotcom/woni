/** 변이 — 점검달력 R3·R7·R8b 단언이 **정말 빨강이 되는가**.
 *
 *  🚨 이 저장소에서 「모양만 보는 소스 단언」이 여러 번 공허하게 초록이었다(빈 배열로 내보내도
 *     초록 / 전제 없이 음성 단언 넷이 빈 화면에서 통과 / 죽은 방어). 그래서 고친 자리를
 *     되돌려 놓고 검사가 무는지 확인한다. 무는 게 없으면 그 단언은 장식이다.
 *  🚨 치환 건수를 **못박는다** — CRLF·들여쓰기로 앵커가 빗나가면 0건 치환인데 초록이 된다
 *     (이 저장소에서 실제로 두 번 일어났다).
 *
 *  실행: node scripts/_mut-calendar-r-series.mjs            (목록)
 *        node scripts/_mut-calendar-r-series.mjs M1         (적용)
 *        npx tsx scripts/test-calendar-r-series.mts         (빨강이어야 한다)
 *        node scripts/_mut-calendar-r-series.mjs restore    (반드시)
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs'

const F = {
  closed: new URL('../src/lib/inspection-closed.ts', import.meta.url),
  drag: new URL('../src/lib/calendar-drag.ts', import.meta.url),
  page: new URL('../src/app/(dashboard)/inspections/calendar/page.tsx', import.meta.url),
  client: new URL('../src/components/inspections/inspection-calendar-client.tsx', import.meta.url),
  period: new URL('../src/lib/inspection-period.ts', import.meta.url),
}
const bakOf = (u) => new URL(u.href + '.mutbak')

const MUTS = [
  // ── R7 판정(순수) ────────────────────────────────────────────────────────
  {
    id: 'M1', file: 'closed', n: 1,
    desc: 'R7 — 단계 0건을 **종료됨**으로 연다(「없음」을 「완료 0건」으로 읽는 그 사고)',
    find: `  if (steps.length === 0) return { closed: false }`,
    repl: `  if (steps.length === 0) return { closed: true }`,
    expect: 'R7① 단계 0건은 종료가 아니다',
  },
  {
    id: 'M2', file: 'closed', n: 1,
    desc: 'R7 — **의무 축을 무시**하고 받은 단계 전부로 센다(모두 합격 회차가 영원히 안 끝난다)',
    find: `  const required = activeNums ? steps.filter(s => activeNums.has(s.step_num)) : [...steps]`,
    repl: `  const required = [...steps]`,
    expect: 'R7① 모두 합격(⑤⑥ 해당없음) — ①~④만 끝나면 종료됨',
  },
  {
    id: 'M3', file: 'closed', n: 1,
    desc: 'R7 — 종료 시각을 **가장 이른** 완료로(마지막이 아니라 첫 단계 날짜를 마감일로 찍는다)',
    find: `  const closedAt = stamps.length > 0 ? stamps.reduce((a, b) => (a >= b ? a : b)) : null`,
    repl: `  const closedAt = stamps.length > 0 ? stamps.reduce((a, b) => (a <= b ? a : b)) : null`,
    expect: 'R7① 종료 시각 = **가장 늦게** 완료된 의무 단계',
  },
  {
    id: 'M4', file: 'closed', n: 1,
    desc: 'R7 — 의무 집합이 비어도 **종료**로 본다(재료가 어긋난 회차가 전부 끝난 것으로 보인다)',
    find: `  if (required.length === 0) return { closed: false }`,
    repl: `  if (required.length === 0) return { closed: true }`,
    expect: 'R7① 의무 집합이 비면 종료가 아니다',
  },
  // ── R7 배선(축) ─────────────────────────────────────────────────────────
  {
    id: 'M5', file: 'page', n: 1,
    desc: 'R7 배선 — **표시 축**(stepsMap)을 넘긴다. 불량 0이면 숨겨진 ⑤⑥ 미완을 「종료됨」으로 그린다',
    find: `        closed: closedVerdict(allStepsMap.get(insp.id) ?? [], activeCal.map.get(insp.id)),`,
    repl: `        closed: closedVerdict(stepsMap.get(insp.id) ?? [], activeCal.map.get(insp.id)),`,
    expect: 'R7② 1인자가 allStepsMap · R7② 표시 축을 넘기지 않는다',
  },
  {
    id: 'M6', file: 'page', n: 1,
    desc: 'R7 배선 — 의무 집합 자리에 **visibleMap**(표시 축)을 넘긴다',
    find: `activeCal.map.get(insp.id)),`,
    repl: `activeCal.visibleMap.get(insp.id)),`,
    expect: 'R7② 2인자가 activeCal.map(의무)이다',
  },
  // ── R8b 판정(순수) ───────────────────────────────────────────────────────
  {
    id: 'M7', file: 'drag', n: 1,
    desc: 'R8b — **전 단계**를 끌 수 있게 한다(2~6단계 마감일이 산식 밖에서 생긴다)',
    find: `  if (chip.kind === 'step') return chip.stepNum === 1 && chip.dateChange?.allowed === true`,
    repl: `  if (chip.kind === 'step') return chip.dateChange?.allowed === true`,
    expect: 'R8b① 2~6단계 칩은 안 끌린다 (5줄)',
  },
  {
    id: 'M8', file: 'drag', n: 1,
    desc: 'R8b — **모름을 허용으로** 읽는다(판정을 못 받은 칩이 끌린다 — 기울기 반전)',
    find: `  if (chip.kind === 'step') return chip.stepNum === 1 && chip.dateChange?.allowed === true`,
    repl: `  if (chip.kind === 'step') return chip.stepNum === 1 && chip.dateChange?.allowed !== false`,
    expect: 'R8b① dateChange가 없으면 안 끌린다',
  },
  {
    id: 'M9', file: 'drag', n: 1,
    desc: 'R8b — 자체점검 계획도 끌리게 한다(드롭 한 번이 **법정 점검 개시**가 된다)',
    find: `    return chip.planType === 'monthly' && MOVABLE_PLAN_STATUS.has(chip.planStatus ?? '')`,
    repl: `    return MOVABLE_PLAN_STATUS.has(chip.planStatus ?? '')`,
    expect: 'R8b① special_종합·special_작동·event 계획 칩은 안 끌린다',
  },
  // ── R8b 배선 ────────────────────────────────────────────────────────────
  {
    id: 'M10', file: 'client', n: 1,
    desc: 'R8b 배선 — 단계 분기의 **return을 지운다**. 드롭 한 번에 모달 둘이 겹쳐 뜬다',
    find: `      openDateChangeAt(r.inspectionId, from, to)\n      return\n    }`,
    repl: `      openDateChangeAt(r.inspectionId, from, to)\n    }`,
    expect: 'R8b② 단계 분기가 openDateChangeAt 뒤 return으로 **닫힌다**',
  },
  {
    id: 'M11', file: 'client', n: 1,
    desc: 'R8b 배선 — 단계 이벤트에서 **서버 판정을 뺀다**. 판정은 맞는데 칩이 하나도 안 잡힌다',
    find: `              dateChange: insp.dateChange,`,
    repl: `              `,
    expect: 'R8b② 단계 이벤트에 서버 판정(dateChange)이 실린다',
  },
  {
    id: 'M12', file: 'client', n: 1,
    desc: `R8b 배선 — kind:'step'을 안 싣는다(종전 상태로 되돌림 — 단계 칩이 판정에서 빠진다)`,
    find: `              kind: 'step' as const,\n`,
    repl: ``,
    expect: `R8b② 단계 이벤트에 kind:'step'이 실린다`,
  },
  {
    id: 'M13', file: 'client', n: 1,
    desc: 'R8b 배선 — 미리보기를 **상태에서** 읽게 되돌린다(드롭 경로가 조회를 통째로 건너뛴다)',
    find: `  const fetchDateChangePreview = useCallback((id: string, to: string) => {`,
    repl: `  const fetchDateChangePreview = useCallback((_id: string, to: string) => {\n    const id = dateChange?.inspectionId ?? ''`,
    expect: 'R8b② 미리보기 본체가 id를 인자로 받는다',
  },
  // ── R3 배선 ─────────────────────────────────────────────────────────────
  {
    id: 'M14', file: 'period', n: 1,
    desc: 'R3 — **어긋남을 안 본다**(저장값 1일 · 기간 5일인 행에서 화면이 서류와 다른 말을 한다)',
    find: `  const mismatch = days !== null && stored !== null && stored !== days`,
    repl: `  const mismatch = false`,
    expect: 'R3① 기간 5일인데 저장값이 1이면 **어긋남을 말한다**',
  },
  {
    id: 'M17', file: 'client', n: 2,
    desc: 'R3 — 어긋남을 **계산만 하고 화면에 안 쓴다**(죽은 방어 — 가장 나쁜 부류)',
    find: `{period.mismatch && (`,
    repl: `{false && (`,
    expect: 'R3② 어긋남을 화면이 **실제로 읽는다**',
  },
  {
    id: 'M15', file: 'page', n: 1,
    desc: 'R3 — 서버가 **종료일·일수를 안 싣는다**(패널이 기간을 말할 재료가 없다)',
    find: `inspection_start_date, inspection_end_date, inspection_days, status`,
    repl: `inspection_start_date, status`,
    expect: 'R3② 서버가 종료일·일수를 싣는다 · select 문에 두 칸',
  },
  {
    id: 'M16', file: 'client', n: 1,
    desc: 'R3 — 점검기간 줄을 **펼친 채로** 둔다(「접힌 한 줄」이 아니다)',
    find: `              <details data-testid="daypanel-period" className="group`,
    repl: `              <details open data-testid="daypanel-period" className="group`,
    expect: 'R3② 기본이 접힘이다(details에 open을 안 붙였다)',
  },
]

const arg = process.argv[2]

if (!arg) {
  console.log('변이 목록 — 점검달력 R3·R7·R8b\n')
  for (const m of MUTS) console.log(`  ${m.id.padEnd(4)} [${m.file.padEnd(6)}] ${m.desc}\n       기대: ${m.expect}`)
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
// 🚨 건수를 센다 — 앵커가 빗나가 0건 치환인데 「적용됨」으로 보이는 것이 가장 나쁜 실패다
const hits = src.split(mut.find).length - 1
if (hits !== mut.n) {
  console.error(`앵커 불일치: ${mut.id} — ${hits}건 발견, ${mut.n}건 기대. 변이를 적용하지 않았습니다.`)
  process.exit(3)
}

copyFileSync(target, bakOf(target))
writeFileSync(target, src.split(mut.find).join(mut.repl), 'utf8')
console.log(`  ✂ ${mut.id} 적용 (${mut.file}, ${hits}건 치환)`)
console.log(`     ${mut.desc}`)
console.log(`     기대 빨강: ${mut.expect}`)
console.log(`\n  npx tsx scripts/test-calendar-r-series.mts   → 빨강이어야 한다`)
console.log(`  node scripts/_mut-calendar-r-series.mjs restore`)
