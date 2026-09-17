/** 1.11.1 착지 확인 — 교육·훈련 월이 **각자의 블록**에만 켜지는가(교차 오염 음성). */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { FIRE_PLAN_ANCHORS, TRAIN_SHEET, TRAIN_MONTH_COLS } from '../src/lib/fire-plan-anchors.ts'
import { buildFirePlanValues } from '../src/lib/fire-plan-xlsx-values.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
const bytes = new Uint8Array(readFileSync('templates/fire-plan-workbook.xlsx'))
const fx = {
  buildingName: 'X', facilities: [], brigade: [{ team: '자위소방대장', name: 'A' }, { team: '부대장', name: 'B' }],
  zones: [], hazards: [],
  ops: { headcountWorker: '12', headcountResident: '40' },
  forms: { training: { eduMonths: [3, 9], drillMonths: [5] } },
} as never
const c = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
if (!c.ok) { console.error(c.failures.slice(0, 3)); process.exit(1) }
const { targets } = toInjectTargets(buildFirePlanValues(fx), c.anchors)
const out = await injectWorkbook(bytes, targets)
const g = await readSheetGrid(await JSZip.loadAsync(out.bytes), TRAIN_SHEET)
const at = (r: string) => g.cells.find(x => x.ref === r)?.text ?? ''
const row = (n: number) => TRAIN_MONTH_COLS.map((c2, i) => (at(`${c2}${n}`).includes('■') ? i + 1 : 0)).filter(Boolean)
console.log('교육 소방교육  r9  켜진 월:', row(9))
console.log('교육 피난교육  r10 켜진 월:', row(10))
console.log('교육 자위소방대 r11 켜진 월:', row(11))
console.log('훈련 소방훈련  r15 켜진 월:', row(15))
console.log('훈련 피난훈련  r16 켜진 월:', row(16))
console.log('훈련 자위소방대 r17 켜진 월:', row(17))
console.log('대상자 근무자 I4 =', at('I4'), '→', JSON.stringify(at('AA4')))
console.log('대상자 거주자 AH4 =', at('AH4'), '→', JSON.stringify(at('BB4')), '(감싼단위칸)')
console.log('대상자 자위소방대 I5 =', at('I5'), '→', JSON.stringify(at('AA5')))
