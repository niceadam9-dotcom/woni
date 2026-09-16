/** 슬롯 분모 실측 — 「사람이 무언가를 적어야 하는 칸」이 시트마다 몇 개인가.
 *
 *  🚨 2단계 리더가 계획을 뒤집었다: 「테두리가 하나라도 none이 아니면 슬롯」으로 잡으면
 *    **1.1은 1,620칸 전부**가 슬롯이 된다(조밀한 표라 모든 칸이 어떤 표 안에 있다).
 *    그 규칙으로는 커버리지 분모가 뜻을 못 갖는다.
 *
 *  그래서 후보 규칙을 **여러 개 동시에 재서** 어느 것이 뜻을 갖는지 본다. 설계를 정하기 전에
 *  숫자를 먼저 본다 — 이 저장소에서 실측이 범위를 여러 번 고쳤다.
 *
 *  실행: npx tsx scripts/_probe-slot-denominator.mts
 */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
import { FIRE_PLAN_MANIFEST, sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { FIRE_PLAN_ANCHORS, FIRE_PLAN_IMAGE_BOXES } from '../src/lib/fire-plan-anchors.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(resolve(HERE, '../templates/fire-plan-workbook.xlsx'))))

const anchoredBySheet = new Map<string, Set<string>>()
for (const a of FIRE_PLAN_ANCHORS) {
  if (!anchoredBySheet.has(a.sheet)) anchoredBySheet.set(a.sheet, new Set())
  anchoredBySheet.get(a.sheet)!.add(a.cell)
}
const photoBySheet = new Map<string, Set<string>>()
for (const b of FIRE_PLAN_IMAGE_BOXES) {
  if (!photoBySheet.has(b.sheet)) photoBySheet.set(b.sheet, new Set())
  photoBySheet.get(b.sheet)!.add(b.cell)
}

type Row = { name: string; cells: number; drawable: number; r1: number; r2: number; r3: number; anchored: number }
const rows: Row[] = []
let tot = { cells: 0, drawable: 0, r1: 0, r2: 0, r3: 0, anchored: 0 }

for (const s of FIRE_PLAN_MANIFEST.sheets) {
  const g = await readSheetGrid(zip, s.name)
  const man = sheetManifest(s.name)
  const banner = new Set(man.bannerRows)
  const anchored = anchoredBySheet.get(s.name) ?? new Set()
  const photo = photoBySheet.get(s.name) ?? new Set()
  const hasBorder = (c: (typeof g.cells)[number]) =>
    c.style.left !== 'none' || c.style.right !== 'none' || c.style.top !== 'none' || c.style.bottom !== 'none'

  // 그릴 수 있는 칸 = 병합에 덮이지 않은 칸(덮인 칸은 화면에도 없다)
  const drawable = g.cells.filter(c => !c.covered)
  // 후보① 테두리만 본다(계획서 원안)
  const r1 = drawable.filter(hasBorder)
  // 후보② ① − 라벨·상자·배너·사진
  const r2 = r1.filter(c =>
    !banner.has(c.row) && !man.labels[c.ref] && !man.boxes[c.ref] && !photo.has(c.ref))
  // 후보③ ② + **글자가 비어 있다**(라벨이 아닌데 글자가 있으면 표본 잔재이거나 이미 채워진 칸)
  const r3 = r2.filter(c => c.text === '')

  const row = {
    name: s.name, cells: g.cells.length, drawable: drawable.length,
    r1: r1.length, r2: r2.length, r3: r3.length,
    anchored: [...anchored].length,
  }
  rows.push(row)
  tot = {
    cells: tot.cells + row.cells, drawable: tot.drawable + row.drawable,
    r1: tot.r1 + row.r1, r2: tot.r2 + row.r2, r3: tot.r3 + row.r3,
    anchored: tot.anchored + row.anchored,
  }
}

console.log('시트별 — 셀 / 그릴수있음 / ①테두리 / ②−라벨상자배너 / ③+글자빔 / 앵커')
for (const r of rows) {
  console.log(`  ${String(r.cells).padStart(5)} ${String(r.drawable).padStart(5)} ${String(r.r1).padStart(5)} ${String(r.r2).padStart(5)} ${String(r.r3).padStart(5)} ${String(r.anchored).padStart(4)}   ${r.name}`)
}
console.log(`\n합계  셀 ${tot.cells} · 그릴수있음 ${tot.drawable} · ①${tot.r1} · ②${tot.r2} · ③${tot.r3} · 앵커 ${tot.anchored}`)
console.log(`배선률  ①${(tot.anchored / tot.r1 * 100).toFixed(1)}%  ②${(tot.anchored / tot.r2 * 100).toFixed(1)}%  ③${(tot.anchored / tot.r3 * 100).toFixed(1)}%`)

// 🚨 자기검사 — 앵커가 후보 집합 **밖**에 있으면 그 후보 규칙은 틀렸다(배선된 칸은 정의상 슬롯이다)
console.log('\n🚨 자기검사 — 앵커인데 후보③에 안 잡히는 칸(규칙이 틀렸다는 뜻)')
let outside = 0
for (const s of FIRE_PLAN_MANIFEST.sheets) {
  const g = await readSheetGrid(zip, s.name)
  const man = sheetManifest(s.name)
  const banner = new Set(man.bannerRows)
  const anchored = anchoredBySheet.get(s.name) ?? new Set()
  const photo = photoBySheet.get(s.name) ?? new Set()
  const hasBorder = (c: (typeof g.cells)[number]) =>
    c.style.left !== 'none' || c.style.right !== 'none' || c.style.top !== 'none' || c.style.bottom !== 'none'
  const set3 = new Set(g.cells.filter(c => !c.covered).filter(hasBorder)
    .filter(c => !banner.has(c.row) && !man.labels[c.ref] && !man.boxes[c.ref] && !photo.has(c.ref))
    .filter(c => c.text === '').map(c => c.ref))
  for (const cell of anchored) {
    if (!set3.has(cell)) {
      if (outside < 12) console.log(`   ${s.name}!${cell}  라벨=${man.labels[cell] ? 'Y' : '-'} 상자=${man.boxes[cell] ? 'Y' : '-'}`)
      outside++
    }
  }
}
console.log(`   합계 ${outside}칸`)
