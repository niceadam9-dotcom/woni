/** 변이 — 점검 기간(종료일↔일수) 단언이 **정말 빨강이 되는가**.
 *
 *  실행: node scripts/_mut-inspection-period.mjs        (목록)
 *        node scripts/_mut-inspection-period.mjs P1     (적용 — 검사 뒤 반드시 restore)
 *        node scripts/_mut-inspection-period.mjs restore
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs'

const F = {
  lib: new URL('../src/lib/inspection-period.ts', import.meta.url),
  ui: new URL('../src/components/inspections/inspection-multiday-client.tsx', import.meta.url),
  act: new URL('../src/app/(dashboard)/inspections/actions.ts', import.meta.url),
}
const BAK = new URL('../src/lib/.period-mutbak.json', import.meta.url)

const MUTS = [
  {
    id: 'P1', file: 'ui',
    desc: '종료일 → 일수 연결을 끊는다 (이번에 고친 그 결함 — 사용자가 신고한 증상)',
    find: `    if (n !== null) setD(String(n))`,
    repl: `    void n`,
    n: 1, expect: '② 종료일을 넣으면 일수가 따라온다',
  },
  {
    id: 'P2', file: 'ui',
    desc: '일수 → 종료일 연결을 끊는다 (사용자가 함께 요청한 반대 방향)',
    find: `    setEnd(endFromDays(startDate, n))`,
    repl: `    // (변이) 종료일 연동 제거`,
    n: 1, expect: '② 일수를 넣으면 종료일이 따라온다 / ③ 종료일도 5일치로',
  },
  {
    id: 'P3', file: 'lib',
    desc: '양끝 포함을 깬다 — 종료 = 시작 + 일수 (종전 「+N」 하루 어긋남 재현)',
    find: `  return addCalendarDays(start, (days as number) - 1)`,
    repl: `  return addCalendarDays(start, days as number)`,
    n: 1, expect: '① 3일이면 종료 = 시작+2 · ① 왕복 항등 전건',
  },
  {
    id: 'P4', file: 'lib',
    desc: '상한 판정을 없앤다 — 5일 초과가 조용히 통과한다',
    find: `  if (days !== null && days > MAX_INSPECTION_DAYS) {`,
    repl: `  if (false) {`,
    n: 1, expect: '① 상한 초과는 막는다 · ③ 경고·저장잠금',
  },
  {
    id: 'P5', file: 'act',
    desc: '서버가 **받은 일수를 그대로** 쓴다 — 화면을 우회하면 어긋난 쌍이 박힌다',
    /* ⚠ 치환문이 `daysFromRange`를 **계속 참조해야** 한다. 처음엔 통째로 `input.days`로 바꿨더니
       import가 미사용이 돼 dev 빌드가 깨졌고, 로그인 타임아웃이 「변이가 죽었다」처럼 보였다
       (실은 계측기가 죽은 것). 변이는 **그 줄의 뜻만** 바꾸고 나머지는 건드리지 않는다. */
    find: `  const days = daysFromRange(start, input.endDate) ?? 1`,
    repl: `  const days = Number.isFinite(input.days) ? input.days : (daysFromRange(start, input.endDate) ?? 1)`,
    n: 1, expect: '⑤ 서버가 기간에서 다시 센다 · (음성) input.days 직접 사용 금지',
  },
  {
    id: 'P6', file: 'lib',
    desc: '역전 판정을 뒤로 민다 — 거꾸로 입력에 「최대 5일」이라는 엉뚱한 이유가 붙는다',
    find: `  if (end < start) return '점검 종료일: 종료일이 시작일보다 빠를 수 없습니다.'`,
    repl: `  // (변이) 역전 판정 제거`,
    n: 1, expect: '① 역전은 거꾸로다라고 말한다',
  },
]

const arg = process.argv[2]

if (arg === 'restore') {
  if (!existsSync(BAK)) { console.log('백업 없음'); process.exit(0) }
  const saved = JSON.parse(readFileSync(BAK, 'utf8'))
  writeFileSync(F[saved.file], saved.text, 'utf8')
  unlinkSync(BAK)
  console.log(`복원 완료 (${saved.file})`)
  process.exit(0)
}
if (!arg) {
  console.log('변이 목록:')
  for (const m of MUTS) console.log(`  ${m.id}  [${m.file}] ${m.desc}\n        기대 빨강: ${m.expect}`)
  process.exit(0)
}
const m = MUTS.find(x => x.id === arg)
if (!m) { console.log(`알 수 없는 변이: ${arg}`); process.exit(1) }
if (existsSync(BAK)) { console.log('🚨 이전 변이가 안 걷혔다 — 먼저 restore'); process.exit(1) }

const target = F[m.file]
const src = readFileSync(target, 'utf8')
const hits = src.split(m.find).length - 1
if (hits !== m.n) {
  console.log(`🚨 앵커 ${hits}건 (기대 ${m.n}) — 치환 중단. 0건이면 CRLF·들여쓰기로 빗나간 것이다.`)
  process.exit(1)
}
writeFileSync(BAK, JSON.stringify({ file: m.file, text: src }), 'utf8')
writeFileSync(target, src.split(m.find).join(m.repl), 'utf8')
console.log(`${m.id} 적용 (${hits}건) — ${m.desc}`)
console.log(`기대 빨강: ${m.expect}`)
