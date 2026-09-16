/** 시트별 빈칸 요약 — 6단계 배선 대기열이 여기서 나온다.
 *  ⭐ `tokenCells` 열은 **독립 검증**이다: 슬롯 규칙(테두리·병합·라벨 제외)과 manifest의
 *    토큰 씨앗은 완전히 다른 경로인데, 배선된 시트에선 두 수가 만나야 한다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-blank-summary.mts */
import { blankReport } from '../src/lib/fire-plan-blanks.ts'
import { FIRE_PLAN_MANIFEST as M } from '../src/lib/fire-plan-xlsx-manifest.ts'

const names = M.sheets.map(s => s.name)
const rs = await blankReport(names, null)

type R = (typeof rs)[number]
/** ERP가 이 시트에 **한 칸도** 안 넣는다 — 값 슬롯도 상자도 */
const untouched = (r: R) => (r.slots > 0 || r.boxes > 0) && r.wired === 0 && r.wiredBoxes === 0
/** 채울 수 있는 칸을 **전부** 채운다 */
const complete = (r: R) => (r.slots > 0 || r.boxes > 0) && r.wired === r.slots && r.wiredBoxes === r.boxes

console.log('슬롯 배선 미배선 | 상자 배선 | 토큰   시트')
let t = { s: 0, w: 0, b: 0, wb: 0 }
for (const r of rs) {
  const m = M.sheets.find(s => s.name === r.sheet)!
  const tok = Object.keys(m.tokenCells).length
  t = { s: t.s + r.slots, w: t.w + r.wired, b: t.b + r.boxes, wb: t.wb + r.wiredBoxes }
  // 🚨 판정은 **한 벌**이다. 처음엔 이 표식이 `wired===0`만 보고 대기열은 상자까지 봐서,
  //   상자 9칸이 배선된 1.10.1이 「미배선」으로 찍혔다 — 같은 파일 안 두 판정기 드리프트다.
  const flag = untouched(r) ? ' 🚨한 칸도 안 채움' : complete(r) ? ' ✅완비' : ''
  console.log(
    String(r.slots).padStart(4) + String(r.wired).padStart(5) + String(r.slots - r.wired).padStart(7)
    + ' |' + String(r.boxes).padStart(5) + String(r.wiredBoxes).padStart(5)
    + ' |' + String(tok).padStart(6) + '   ' + r.sheet + flag)
}
console.log(`\n합계  슬롯 ${t.s} · 배선 ${t.w}(${(t.w / t.s * 100).toFixed(1)}%) · 상자 ${t.b} · 배선 ${t.wb}(${(t.wb / t.b * 100).toFixed(1)}%)`)

const red = rs.filter(untouched)
console.log(`\n🚨 한 칸도 안 채우는 시트 ${red.length}장 — 6단계 대기열(슬롯+상자 많은 순)`)
for (const r of [...red].sort((a, b) => (b.slots + b.boxes) - (a.slots + a.boxes)).slice(0, 15)) {
  console.log(`   슬롯 ${String(r.slots).padStart(4)} · 상자 ${String(r.boxes).padStart(4)}   ${r.sheet}`)
}
