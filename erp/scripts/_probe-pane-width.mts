/** 작업대 3칸 폭 조절 계산 검증 — 순수 함수 단언(DB·브라우저 불필요)
 *  실행: npx tsx --conditions=react-server scripts/_probe-pane-width.mts */
import { readFileSync } from 'node:fs'
import mod from '../src/lib/pane-width.ts'

const {
  PANE_BASE, PANE_STEP, PANE_MIN, nudgePaneW, paneCols, paneWidthOk, parsePaneW, paneLabels,
} = mod as unknown as typeof import('../src/lib/pane-width.ts')

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const ZERO = [0, 0, 0] as [number, number, number]
const sum = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100

console.log('— 합 보존: 한 칸이 얻은 만큼 나머지 둘이 나눠 낸다(전체 폭 불변)')
for (let i = 0; i < 3; i++) {
  const w = nudgePaneW(ZERO, i, 1)!
  ok(`${i}번 칸 넓히기 — 합 0 유지`, sum(w) === 0, JSON.stringify(w))
  ok(`${i}번 칸이 +${PANE_STEP}`, w[i] === PANE_STEP, JSON.stringify(w))
  ok(`나머지 둘이 각 -${PANE_STEP / 2}`,
    w.every((v, j) => j === i || v === -PANE_STEP / 2), JSON.stringify(w))
}

console.log('— 되돌리기: 넓힌 뒤 좁히면 원위치')
{
  const w = nudgePaneW(nudgePaneW(ZERO, 2, 1)!, 2, -1)!
  ok('넓히기 → 좁히기 = [0,0,0]', JSON.stringify(w) === JSON.stringify(ZERO), JSON.stringify(w))
}

console.log('— 최소폭: 어느 화면폭·단계에서도 칸이 뭉개지지 않는다')
{
  // 가운데 칸을 계속 좁혀 본다 — 2xl 미리보기 기본값 0.9가 가장 먼저 바닥에 닿는다
  let w = ZERO, steps = 0
  while (steps < 50) {
    const n = nudgePaneW(w, 1, -1)
    if (!n) break
    w = n; steps++
  }
  ok('좁히기가 유한 번에 멈춘다(무한 진행 아님)', steps > 0 && steps < 50, `steps=${steps}`)
  ok('멈춘 지점도 양쪽 기본값 전부 최소폭 이상', paneWidthOk(w), JSON.stringify(w))
  const bases = [PANE_BASE.lg.preview, PANE_BASE.lg.normal, PANE_BASE.xl.preview, PANE_BASE.xl.normal]
  ok('한 걸음 더 가면 최소폭 위반 — 즉 경계까지 갔다',
    nudgePaneW(w, 1, -1) === null
    && bases.some(b => b[1] + w[1] - PANE_STEP < PANE_MIN), JSON.stringify(w))
}
{
  // ⚠ lg만 보고 판정하면 통과하지만 2xl에서 뭉개지는 값 — 양쪽 검사가 실제로 걸리는지
  //    가운데 칸 -0.48: lg 0.95→0.47(통과) / 2xl 0.9→0.42(위반)
  const lgOnly: [number, number, number] = [0.24, -0.48, 0.24]
  ok('lg(0.95)만 보면 통과할 값이 2xl(0.9) 때문에 거부된다',
    PANE_BASE.lg.preview[1] + lgOnly[1] >= PANE_MIN && !paneWidthOk(lgOnly),
    `lg=${PANE_BASE.lg.preview[1] + lgOnly[1]} / 2xl=${PANE_BASE.xl.preview[1] + lgOnly[1]}`)
}

console.log('— CSS 값 생성')
{
  const css = paneCols(PANE_BASE.lg.preview, ZERO)
  ok('기본값은 종전 하드코딩 비율과 동일', css === 'minmax(0,1.15fr) minmax(0,0.95fr) minmax(0,1.5fr)', css)
  const wide = paneCols(PANE_BASE.xl.preview, nudgePaneW(ZERO, 2, 1)!)
  ok('셋째 칸 넓히면 3번째 값이 커진다', wide.includes('2.05fr'), wide)
  // 3자리까지는 정상(눈금 0.125). 그보다 길면 반올림이 빠진 것 — 0.30000000000000004 류
  ok('부동소수 잔재 없음(0.30000000000000004 류)', !/\d\.\d{4,}fr/.test(wide), wide)
}

console.log('— 저장값 검증(깨진 값이 화면을 망가뜨리지 않는다)')
/* 🚨 2026-09-11 — 저장 형식이 바뀌었다(키 v1→v2). 종전엔 3칸 배열 하나였는데, ④가 2칸이 되면서
   **칸 수별 묶음** `{"2":[...],"3":[...]}`이 됐다. 길이가 안 맞는 값을 조용히 자르면 사용자가
   맞춰 둔 폭이 엉뚱한 칸으로 옮겨 가므로, 길이가 어긋나면 무조건 null(기본값)이다. */
ok('null → null', parsePaneW(null, 3) === null)
ok('빈 문자열 → null', parsePaneW('', 3) === null)
ok('JSON 아님 → null', parsePaneW('{oops', 3) === null)
ok('배열(v1 옛 형식) → null — 칸 수별 묶음이 아니다', parsePaneW('[0.25,-0.125,-0.125]', 3) === null)
ok('그 칸 수 항목이 없으면 → null', parsePaneW('{"2":[0,0]}', 3) === null)
ok('길이가 칸 수와 다르면 → null', parsePaneW('{"3":[0,0]}', 3) === null)
ok('숫자 아님 → null', parsePaneW('{"3":[0,"a",0]}', 3) === null)
ok('NaN → null', parsePaneW('{"3":[0,null,0]}', 3) === null)
ok('최소폭 위반 저장값 → null(기본 비율로 복귀)', parsePaneW('{"3":[0,-5,5]}', 3) === null)
ok('정상값은 그대로', JSON.stringify(parsePaneW('{"3":[0.25,-0.125,-0.125]}', 3)) === '[0.25,-0.125,-0.125]')
ok('🎯 2칸 값도 같은 묶음에서 꺼낸다', JSON.stringify(parsePaneW('{"2":[0.25,-0.25],"3":[0,0,0]}', 2)) === '[0.25,-0.25]')
ok('🚨 (음성) 2칸을 3으로 읽지 않는다 — 길이가 섞이면 폭이 엉뚱한 칸으로 간다',
  parsePaneW('{"2":[0.25,-0.25]}', 3) === null)

console.log('\n— 2칸(④ 소방서 제출) 축 — 3칸을 타입으로 못 박고 있던 것을 푼 자리')
const ZERO2 = [0, 0]
ok('duo 기본값이 2칸이다', PANE_BASE.lg.duo.length === 2 && PANE_BASE.xl.duo.length === 2,
  JSON.stringify([PANE_BASE.lg.duo, PANE_BASE.xl.duo]))
// 🎯 사용자 요청의 본질: 생성·제출 칸이 종전 3칸 preview보다 **넓어졌는가**
ok('🎯 생성·제출 칸이 종전보다 넓다(lg)', PANE_BASE.lg.duo[0] > PANE_BASE.lg.preview[1],
  `${PANE_BASE.lg.duo[0]} vs ${PANE_BASE.lg.preview[1]}`)
ok('🎯 생성·제출 칸이 종전보다 넓다(xl)', PANE_BASE.xl.duo[0] > PANE_BASE.xl.preview[1],
  `${PANE_BASE.xl.duo[0]} vs ${PANE_BASE.xl.preview[1]}`)
// 🚨 미리보기 칸은 줄이지 않는다 — 서식을 읽는 칸이라 좁히면 이 화면의 목적이 무너진다
ok('🚨 미리보기 칸을 좁히지 않았다(xl)', PANE_BASE.xl.duo[1] >= PANE_BASE.xl.preview[2],
  `${PANE_BASE.xl.duo[1]} vs ${PANE_BASE.xl.preview[2]}`)
// ⚠ 나누는 수가 length-1이어야 합이 0이다. 3으로 박아 두면 2칸에서 전체 폭이 흔들린다.
for (let i = 0; i < 2; i++) {
  const w = nudgePaneW(ZERO2, i, 1)!
  ok(`2칸 ${i}번을 넓혀도 합이 0`, !!w && sum([...w]) === 0, JSON.stringify(w))
  ok(`2칸 ${i}번이 실제로 넓어진다`, !!w && w[i] === PANE_STEP, JSON.stringify(w))
}
ok('2칸 왕복(넓혔다 좁히면) 원위치', JSON.stringify(nudgePaneW(nudgePaneW(ZERO2, 0, 1)!, 0, -1)!) === '[0,0]')
ok('🚨 (음성) 칸 수가 기본값과 안 맞으면 거부한다', paneWidthOk([0, 0, 0, 0]) === false)
ok('paneCols가 2칸이면 두 칸만 낸다', paneCols(PANE_BASE.xl.duo, ZERO2).split(' ').length === 2,
  paneCols(PANE_BASE.xl.duo, ZERO2))
// 라벨도 칸 수를 따라야 한다 — 2칸에서 「가운데 칸」이라 부르면 가운데가 없어 거짓말이 된다
ok('2칸 라벨은 2개이고 「가운데」가 없다',
  paneLabels(2).length === 2 && !paneLabels(2).some(l => l.includes('가운데')), paneLabels(2).join('·'))
ok('3칸 라벨은 종전 그대로', paneLabels(3).join('·') === '첫째 칸·가운데 칸·셋째 칸')

console.log('\n— ④ 화면 구조 — 계산이 옳아도 화면이 그걸 안 쓰면 소용없다')
/* 🚨 순수 함수만 보면 「duo가 2칸이다」까지만 안다. **작업대가 ④에서 duo를 고르는가**,
   그리고 칸을 없애면서 **잃으면 안 되는 것을 옮겼는가**는 소스를 읽어야 알 수 있다.
   [종료일 고치기]는 살아 있는 화면에서 유일한 입구라(timeline-client는 렌더 안 됨),
   지우면 기한 자체를 못 고치고 법정 15일 판정이 통째로 어긋난다. */
const wbSrc = readFileSync(new URL('../src/components/inspections/inspection-workbench.tsx', import.meta.url), 'utf8')
const submit9Block = (() => {
  const i = wbSrc.indexOf("{sel === 'submit9' && (<>")
  const j = wbSrc.indexOf("{sel === 'repair'", i)
  return i < 0 ? '' : wbSrc.slice(i, j < 0 ? undefined : j)
})()
ok('④ 블록을 찾았다', submit9Block.length > 0)
ok("🎯 ④가 duo(2칸)를 고른다", /sel === 'submit9' \? 'duo'/.test(wbSrc))
ok('🎯 ④는 Pane이 정확히 2개다',
  (submit9Block.match(/<Pane\s/g) ?? []).length === 2, String((submit9Block.match(/<Pane\s/g) ?? []).length))
/* 🚨 단언은 **주석이 아니라 요소**를 물어야 한다. 처음엔 `includes('종료일 고치기')`로 썼는데,
   바로 위 주석에 그 말을 적어 둬서 **버튼을 지워도 초록이었다**(변이 실험이 잡았다).
   같은 이유로 `p.href`만 보면 `{false && p.href && …}`로 죽여도 통과한다 — 조건까지 본다. */
ok('🚨 [종료일 고치기] **버튼**이 ④ 안에 살아 있다(유일한 입구)',
  />종료일 고치기<\/button>/.test(submit9Block))
ok('  · 그 버튼이 종료일 편집을 실제로 연다', /setAnchorEdit\(true\)/.test(submit9Block))
ok('🚨 전제 체크가 ④ 안에 남아 있다', submit9Block.includes('data.prereqs'))
ok('🎯 전제의 detail을 화면에 쓴다(종전엔 서버가 보내고도 안 썼다)',
  /\{p\.detail && </.test(submit9Block))
ok('🎯 전제의 고치러 가는 링크(href)를 살렸다 — ⚠인 항목에서만',
  /\{!p\.ok && p\.href && \(/.test(submit9Block) && /hrefLabel/.test(submit9Block))
ok('전제는 접이식이다(전부 ✓면 한 줄)', /submit9-prereq-toggle/.test(submit9Block))
// 초기화 버튼이 마지막 칸에 붙는가 — `i === 2`로 박혀 있으면 2칸 화면에서 통째로 사라진다
ok('🚨 폭 초기화 버튼이 마지막 칸 기준이다(2칸에서도 보인다)', /i === paneCount - 1/.test(wbSrc))
ok('🚨 (음성) 3칸을 못 박은 PANE_LABELS·PANE_W_DEFAULT를 더 쓰지 않는다',
  !/PANE_LABELS|PANE_W_DEFAULT/.test(wbSrc))

console.log(`\n결과: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
