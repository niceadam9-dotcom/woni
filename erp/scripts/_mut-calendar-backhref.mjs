/** 변이 — 「복귀 주소 단일 원천(calendarBackHref)」 단언이 **정말 빨강이 되는가**.
 *
 *  🚨 이 저장소에서 「모양만 보는 소스 단언」이 여러 번 공허하게 초록이었다. 그래서
 *     고친 자리를 되돌려 놓고 검사가 무는지 확인한다. 무는 게 없으면 그 단언은 장식이다.
 *  🚨 치환 건수를 **못박는다** — CRLF·들여쓰기로 앵커가 빗나가면 0건 치환인데 초록이 된다.
 *
 *  실행: node scripts/_mut-calendar-backhref.mjs        (목록)
 *        node scripts/_mut-calendar-backhref.mjs M1     (적용 — 검사 돌린 뒤 반드시 restore)
 *        node scripts/_mut-calendar-backhref.mjs restore
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs'

const CAL = new URL('../src/components/inspections/inspection-calendar-client.tsx', import.meta.url)
const BAK = new URL('../src/components/inspections/inspection-calendar-client.tsx.mutbak', import.meta.url)

const MUTS = [
  {
    id: 'M1',
    desc: '패널 하단 링크가 **자기 자리에서 다시 조립**한다 — insp·cust 유실(이번에 고친 그 결함)',
    find: `    q.set('from', calendarBackHref)`,
    repl: `    const qs0 = searchParams.toString()\n    q.set('from', \`\${pathname}\${qs0 ? \`?\${qs0}\` : ''}\`)`,
    n: 1,
    expect: '③ [문B] from= 에 **열린 패널(insp)**이 실린다 / (음성) panelEntryQuery…',
  },
  {
    id: 'M2',
    desc: '복귀 주소가 **insp를 안 덮어쓴다** — 두 문이 동시에 죽는다',
    find: `    if (selectedInspectionId) sp.set('insp', selectedInspectionId); else sp.delete('insp')`,
    repl: `    // (변이) insp 보정 제거`,
    n: 1,
    expect: '②·③ 두 문 모두 insp 없음 · ⑤ 우측바 복원 실패',
  },
  {
    id: 'M3',
    desc: '단계 [입력] 링크만 **제 자리에서** 다시 조립 — 규약이 갈라진 옛 상태로 되돌린다',
    find: `from=\${encodeURIComponent(calendarBackHref)}\``,
    repl: `from=\${encodeURIComponent(\`\${pathname}?insp=\${selectedInspection.id}\`)}\``,
    n: 1,
    expect: '🚨 B-3 두 링크가 **같은 한 곳**(calendarBackHref)에서 받는다',
  },
  {
    id: 'M4',
    desc: '복귀 주소가 **cust를 안 덮어쓴다** — 돌아오면 고객 검색어가 풀린다',
    find: `    if (custQuery) sp.set('cust', custQuery); else sp.delete('cust')`,
    repl: `    // (변이) cust 보정 제거`,
    n: 1,
    expect: '🚨 B-3 복귀 주소가 replaceState 소유 값(cust·insp)을 덮어쓴다',
  },
]

const arg = process.argv[2]

if (arg === 'restore') {
  if (!existsSync(BAK)) { console.log('백업 없음 — 되돌릴 것이 없다'); process.exit(0) }
  copyFileSync(BAK, CAL); unlinkSync(BAK)
  console.log('복원 완료')
  process.exit(0)
}

if (!arg) {
  console.log('변이 목록:')
  for (const m of MUTS) console.log(`  ${m.id}  ${m.desc}\n        기대 빨강: ${m.expect}`)
  process.exit(0)
}

const m = MUTS.find(x => x.id === arg)
if (!m) { console.log(`알 수 없는 변이: ${arg}`); process.exit(1) }
if (existsSync(BAK)) { console.log('🚨 이전 변이가 안 걷혔다 — 먼저 restore'); process.exit(1) }

const src = readFileSync(CAL, 'utf8')
const hits = src.split(m.find).length - 1
if (hits !== m.n) {
  console.log(`🚨 앵커 ${hits}건 (기대 ${m.n}) — 치환 중단. 0건이면 CRLF·들여쓰기로 빗나간 것이다.`)
  process.exit(1)
}
copyFileSync(CAL, BAK)
writeFileSync(CAL, src.split(m.find).join(m.repl), 'utf8')
console.log(`${m.id} 적용 (${hits}건 치환) — ${m.desc}`)
console.log(`기대 빨강: ${m.expect}`)
