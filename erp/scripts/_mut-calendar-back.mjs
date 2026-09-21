/** 변이 검사 — 달력↔점검표 복귀 단언이 **실제로 무는가** (2026-09-21).
 *  🚨 소스는 node에서 utf8로만(PowerShell은 한글을 깬다) · 치환 건수를 가드한다.
 *  실행: node scripts/_mut-calendar-back.mjs   (dev 서버 필요)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const CAL = 'src/components/inspections/inspection-calendar-client.tsx'
const LINK = 'src/lib/inspection-step-links.ts'
const SHEET = 'src/components/inspections/sheet-entry-client.tsx'
const PAGE = 'src/app/(dashboard)/inspections/calendar/page.tsx'

const MUTANTS = [
  /* 2026-09-21 재겨냥 — 타 세션의 6단계 확장(B-3)과 합쳐지며 복귀 주소를 **JSX에서** 잇게 됐다.
     종전 겨냥(세 번째 위치인자 backTo)은 사라져 0건 치환으로 조용히 건너뛰었다.
     쿼리 이름만 바꿔 받는 쪽이 못 알아보게 한다 — 타입은 성립하고 기능만 죽는다. */
  { id: 'M1', file: CAL, desc: '링크가 복귀 주소를 안 싣는다(쿼리 이름을 바꿔 무력화)',
    from: "inputLink.href.includes('?') ? '&' : '?'}from=", to: "inputLink.href.includes('?') ? '&' : '?'}xfrom=",
    expect: '② [점검표 입력] 링크가 from= 을 싣는다' },
  { id: 'M2', file: CAL, desc: 'from= 에 insp 덮어쓰기 제거(effect 순서 함정 부활)',
    from: "sp.set('insp', selectedInspection.id)", to: "void selectedInspection",
    expect: '② 그 from= 이 **패널까지 담긴** 달력 주소다' },
  { id: 'M3', file: PAGE, desc: '?insp= 복원 폐지 — 돌아와도 패널이 안 열린다',
    from: "const initialInspectionId = /^[0-9a-f-]{36}$/i.test(params.insp ?? '') ? params.insp! : ''",
    to: "const initialInspectionId = ''",
    expect: '④ 돌아오니 그 사이드 패널이 다시 열려 있다' },
  /* ⚠ 변이는 **타입이 성립해야** 판정이 된다. 종전 `if (false) …!`는 컴파일을 깨 프로브가
     0통과/1실패로 끝났고 — 그건 「단언이 물었다」가 아니라 「아무것도 못 쟀다」이다. */
  { id: 'M4', file: CAL, desc: '패널 열림을 URL에 안 적음 — 복귀 주소의 원천이 사라진다',
    from: "if (selectedInspectionId) sp.set('insp', selectedInspectionId)",
    to: "if (selectedInspectionId) sp.delete('insp')",
    expect: '① 주소에 ?insp= 가 박힌다' },
  /* 🚫 뺀 변이 — 「늦게 온 replaceState가 진행 중 이동을 덮는 경합」(sheet-entry-client의 pathname 가드).
     프로브가 시트 적재가 끝난 뒤 누르도록 고쳐져 있어(계측기가 스스로 경합을 만들지 않으려고)
     이 변이는 **관측될 수 없다**. 되살리려면 프로브를 다시 불안정하게 만들어야 하므로 목록에서 뺀다 —
     가드 자체는 실측으로 재현한 진짜 결함의 수리다(2026-09-21 _diag-back-click). */
  // 달력엔 같은 줄이 **둘**(?cust=·?insp=)이라 건수를 2로 못박는다 — 「1건이어야」로 두면 조용히 건너뛴다
  { id: 'M6', file: CAL, desc: 'replaceState가 라우터 상태를 지움(브라우저 back 깨짐 — 결정적인 곳은 달력이다)',
    from: 'window.history.replaceState(window.history.state,', to: 'window.history.replaceState(null,',
    count: 2, expect: '⑤ 브라우저 뒤로가기로도 패널이 열려 있다' },
]

function runProbe() {
  try {
    return execFileSync('npx', ['tsx', 'scripts/_probe-calendar-sheet-back.mts'],
      { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) { return `${e.stdout ?? ''}${e.stderr ?? ''}` }
}

console.log('기준선(변이 없음) 실행…')
const base = runProbe()
if (!/0 실패/.test(base)) {
  console.log('  기준선에 빨강 — 변이 판정 무효'); console.log(base.trim().split('\n').slice(-5).join('\n')); process.exit(1)
}
console.log('  기준선 전부 초록 ✅ ', base.trim().split('\n').pop())

let caught = 0
for (const m of MUTANTS) {
  const orig = readFileSync(m.file, 'utf8')
  const want = m.count ?? 1
  const hits = orig.split(m.from).length - 1
  if (hits !== want) { console.log(`${m.id} ⚠ 치환 ${hits}건(${want}이어야) — 건너뜀: ${m.desc}`); continue }
  writeFileSync(m.file, want > 1 ? orig.split(m.from).join(m.to) : orig.replace(m.from, m.to), 'utf8')
  try {
    const out = runProbe()
    const red = out.split('\n').filter(l => l.includes(m.expect) && l.includes('❌'))
    if (red.length) caught++
    console.log(`${m.id} ${red.length ? '✅ 잡힘' : '🚨 생존'} — ${m.desc}`)
    console.log(`     ${(red[0] ?? '(기대 단언이 빨강이 아니다)').trim().slice(0, 150)}`)
    console.log(`     ${out.trim().split('\n').pop()}`)
  } finally { writeFileSync(m.file, orig, 'utf8') }
}
console.log(`\n변이 결과: ${caught}/${MUTANTS.length} 잡힘`)
