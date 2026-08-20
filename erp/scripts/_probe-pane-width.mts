/** 작업대 3칸 폭 조절 계산 검증 — 순수 함수 단언(DB·브라우저 불필요)
 *  실행: npx tsx --conditions=react-server scripts/_probe-pane-width.mts */
import mod from '../src/lib/pane-width.ts'

const {
  PANE_BASE, PANE_STEP, PANE_MIN, nudgePaneW, paneCols, paneWidthOk, parsePaneW,
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
ok('null → null', parsePaneW(null) === null)
ok('빈 문자열 → null', parsePaneW('') === null)
ok('JSON 아님 → null', parsePaneW('{oops') === null)
ok('길이 2 → null', parsePaneW('[0,0]') === null)
ok('숫자 아님 → null', parsePaneW('[0,"a",0]') === null)
ok('NaN → null', parsePaneW('[0,null,0]') === null)
ok('최소폭 위반 저장값 → null(기본 비율로 복귀)', parsePaneW('[0,-5,5]') === null)
ok('정상값은 그대로', JSON.stringify(parsePaneW('[0.25,-0.125,-0.125]')) === '[0.25,-0.125,-0.125]')

console.log(`\n결과: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
