/** [5] 이웃 라벨 표본 재선정 — 「둘째 패스(같은 열 위쪽 머리글)」로 결정되는 미배선 칸 찾기
 *  (1.7.1!A10이 배선돼 표본이 소진됐다 — 표본은 **미배선 칸**이어야 산다)
 *  실행: npx tsx --conditions=react-server scripts/_probe-near-sample.mts */
import { blankReport } from '../src/lib/fire-plan-blanks.ts'
import { FIRE_PLAN_MANIFEST as M } from '../src/lib/fire-plan-xlsx-manifest.ts'

const rs = await blankReport(M.sheets.map(s => s.name), null)
/** 같은 행 왼쪽에 라벨이 없고(=첫째 패스 실패) 이웃 라벨이 붙은 칸 = 둘째 패스 산물 */
for (const r of rs) {
  const man = M.sheets.find(s => s.name === r.sheet)!
  for (const b of r.blanks) {
    if (!b.near) continue
    const row = Number(/\d+/.exec(b.ref)![0])
    const col = b.ref.replace(/\d+/g, '')
    const sameRowLabels = Object.keys(man.labels).filter(c => Number(/\d+/.exec(c)![0]) === row)
    if (sameRowLabels.length > 0) continue          // 같은 행에 라벨이 있으면 첫째 패스일 수 있다
    console.log(`${r.sheet}!${b.ref} (열 ${col}·행 ${row}) → '${b.near}'`)
  }
}
