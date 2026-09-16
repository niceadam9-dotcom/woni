/** 상자칸 분류 대조 — `wiredBoxes`가 실제 배선을 제대로 세는가.
 *
 *  1.8은 `agency18_*` 앵커가 6개인데 `wiredBoxes`가 0으로 나왔다. 둘 중 하나가 틀렸다.
 *  🚨 숫자가 안 맞으면 **제품보다 계측기를 먼저** 의심한다 — 오늘 이미 여러 번 그랬다. */
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'
import { sheetManifest, FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'

for (const sheet of ['1.8 업무대행 현황', '1.1 건축물 일반현황', '1.4 소방시설 현황']) {
  const m = sheetManifest(sheet)
  const anchors = FIRE_PLAN_ANCHORS.filter(a => a.sheet === sheet)
  console.log(`\n${sheet} — 앵커 ${anchors.length} · manifest.boxes ${Object.keys(m.boxes).length} · labels ${Object.keys(m.labels).length}`)
  let inBox = 0, inLabel = 0, neither = 0
  for (const a of anchors) {
    const b = !!m.boxes[a.cell], l = !!m.labels[a.cell]
    if (b) inBox++; else if (l) inLabel++; else neither++
  }
  console.log(`  앵커가 앉는 자리: boxes ${inBox} · labels(상자 아님) ${inLabel} · 둘 다 아님 ${neither}`)
  for (const a of anchors.slice(0, 6)) {
    console.log(`    ${a.cell.padEnd(5)} ${a.field.padEnd(22)} box=${m.boxes[a.cell] ?? '-'} label=${JSON.stringify(m.labels[a.cell] ?? '-').slice(0, 34)}`)
  }
}

// 전 워크북 — 앵커가 상자칸/라벨칸/순수슬롯 중 어디에 앉는가
let b = 0, l = 0, n = 0
for (const a of FIRE_PLAN_ANCHORS) {
  const m = sheetManifest(a.sheet)
  if (m.boxes[a.cell]) b++
  else if (m.labels[a.cell]) l++
  else n++
}
console.log(`\n전 워크북 앵커 ${FIRE_PLAN_ANCHORS.length}: 상자칸 ${b} · 라벨칸(상자 아님) ${l} · 순수 빈칸 ${n}`)
console.log(`manifest.boxes 총합: ${FIRE_PLAN_MANIFEST.sheets.reduce((s, x) => s + Object.keys(x.boxes).length, 0)}`)
