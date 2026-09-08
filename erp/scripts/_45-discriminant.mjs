/* 소방계획서_45 R-5 — 새 단언이 **구 구현에서 실제로 떨어지는지** 확인하는 통제 프로브.
 * 제품 파일을 뮤테이션하지 않고(공유 작업트리라 위험), 구 구현식을 그대로 옮겨 같은 픽스처에 대입한다.
 * S8-1의 가드는 이 확인을 못 해 "추론"으로 남았던 자리다. */

/* 구 구현 (45 1차) */
const oldVoid = e => (e.defectsTotal === 0 && (e.sheetX ?? 0) > 0) ? true : e.defectsDone < e.defectsTotal
const oldDone5 = e => e.defectsTotal > 0 && e.defectsDone >= e.defectsTotal

/* 신 구현 (R-5) */
const newVoid = e => (e.unregisteredX ?? 0) > 0 ? true : e.defectsDone < e.defectsTotal
const newDone5 = e => e.defectsTotal > 0 && e.defectsDone >= e.defectsTotal && (e.unregisteredX ?? 0) === 0

/* 3건 ✕ 중 1건만 등록·조치 (deleteDefectAction 경로로 도달) */
const partial = { sheetX: 3, unregisteredX: 2, defectsTotal: 1, defectsDone: 1 }
/* 전건 등록·전건 조치 — 반대쪽으로 새지 않는지 */
const full = { sheetX: 3, unregisteredX: 0, defectsTotal: 3, defectsDone: 3 }

const cases = [
  ['partial isForced5Void  기대 true ', oldVoid(partial), newVoid(partial), true],
  ['partial evidenceDone5  기대 false', oldDone5(partial), newDone5(partial), false],
  ['full    evidenceDone5  기대 true ', oldDone5(full), newDone5(full), true],
]

let bites = 0
for (const [name, o, n, want] of cases) {
  const oldFails = o !== want
  if (oldFails) bites++
  console.log(`${name} | 구=${String(o).padEnd(5)} 신=${String(n).padEnd(5)} | 구 구현 ${oldFails ? '떨어진다 (판별식)' : '통과 (눈멂)'}`)
}
const newAllOk = cases.every(([, , n, want]) => n === want)
console.log(`\n판별식 ${bites}/3 · 신 구현 기대 일치 ${newAllOk}`)
process.exit(bites >= 2 && newAllOk ? 0 : 1)
