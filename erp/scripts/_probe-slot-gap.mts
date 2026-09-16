/** 회계 1칸 차이 추적 — 「순수 빈칸에 앉는 앵커 131」 vs 「배선된 값 슬롯 130」.
 *  🚨 1칸이라도 안 맞으면 분류 규칙 어딘가가 틀렸다는 뜻이다. 반올림으로 넘기지 않는다. */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
import { sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { FIRE_PLAN_ANCHORS, FIRE_PLAN_IMAGE_BOXES } from '../src/lib/fire-plan-anchors.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(resolve(HERE, '../templates/fire-plan-workbook.xlsx'))))
const photo = new Set(FIRE_PLAN_IMAGE_BOXES.map(b => `${b.sheet}!${b.cell}`))

for (const a of FIRE_PLAN_ANCHORS) {
  const man = sheetManifest(a.sheet)
  if (man.boxes[a.cell] || man.labels[a.cell]) continue     // 상자칸·라벨칸은 별도 축
  const g = await readSheetGrid(zip, a.sheet)
  const c = g.cells.find(x => x.ref === a.cell)
  if (!c) { console.log(`❗ ${a.sheet}!${a.cell} (${a.field}) — 셀이 XML에 없다`); continue }
  const hasBorder = c.style.left !== 'none' || c.style.right !== 'none' || c.style.top !== 'none' || c.style.bottom !== 'none'
  const why: string[] = []
  if (c.covered) why.push('병합에 덮임')
  if (!hasBorder) why.push('테두리 없음')
  if (man.bannerRows.includes(c.row)) why.push('머리띠 행')
  if (photo.has(`${a.sheet}!${a.cell}`)) why.push('사진 상자')
  if (why.length) console.log(`❗ ${a.sheet}!${a.cell} (${a.field}) — 슬롯에서 빠진 이유: ${why.join(' · ')}`)
}
console.log('(위에 아무것도 없으면 131 == 130이 아니라 다른 데서 어긋난 것이다)')
