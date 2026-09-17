import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { FIRE_PLAN_ANCHORS, HAZARD_SHEET } from '../src/lib/fire-plan-anchors.ts'
import { buildFirePlanValues, hazardUnmatched } from '../src/lib/fire-plan-xlsx-values.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
const bytes = new Uint8Array(readFileSync('templates/fire-plan-workbook.xlsx'))
const fx = { buildingName: 'X', facilities: [], brigade: [], zones: [],
  hazards: [
    { place: '보일러실', location: '지하1층', factors: ['기계적 요인', '가스누출(폭발)'] },
    { place: '전기실', location: '1층 EPS', factors: ['전기적 요인'] },
    { place: '창고', location: '옥탑', factors: ['부주의'] },   // 양식에 자리 없음
  ], forms: {} } as never
const c = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
if (!c.ok) { console.error('앵커 실패', c.failures.slice(0,3)); process.exit(1) }
const { targets } = toInjectTargets(buildFirePlanValues(fx), c.anchors)
const out = await injectWorkbook(bytes, targets)
const g = await readSheetGrid(await JSZip.loadAsync(out.bytes), HAZARD_SHEET)
const at = (r: string) => g.cells.find(x => x.ref === r)?.text ?? ''
console.log('보일러실(r4) 위치 N4 =', JSON.stringify(at('N4')))
console.log('  AB4 전기=', at('AB4'), '| AB5 기계=', at('AB5'), '| AB7 가스=', at('AB7'))
console.log('주방(r8) 위치 N8 =', JSON.stringify(at('N8')), ' (미입력이라 빈칸이어야)')
console.log('  AB8 전기=', at('AB8'), '| AO9 부주의=', at('AO9'))
console.log('전기실(r12) 위치 N12 =', JSON.stringify(at('N12')))
console.log('  AB12 전기=', at('AB12'))
console.log('장소 라벨 A4 =', JSON.stringify(at('A4')), '(법정 자구 보존)')
console.log('맞물리지 못한 장소:', hazardUnmatched(fx))
