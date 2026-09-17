/** 1.10.3 착지 확인 — 해당 시 채우고, **해당 없으면 전부 비는가**(음성이 핵심). */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { FIRE_PLAN_ANCHORS, MU_SHEET } from '../src/lib/fire-plan-anchors.ts'
import { buildFirePlanValues } from '../src/lib/fire-plan-xlsx-values.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
const bytes = new Uint8Array(readFileSync('templates/fire-plan-workbook.xlsx'))
const base = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [] }
const mk = (mu: unknown) => ({ ...base, forms: { multiUse: mu } }) as never
const run = async (fx: never) => {
  const c = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (!c.ok) { console.error('앵커 실패', c.failures.slice(0, 3)); process.exit(1) }
  const { targets } = toInjectTargets(buildFirePlanValues(fx), c.anchors)
  const out = await injectWorkbook(bytes, targets)
  const g = await readSheetGrid(await JSZip.loadAsync(out.bytes), MU_SHEET)
  return (r: string) => g.cells.find(x => x.ref === r)?.text ?? ''
}
console.log('── 해당 O ──')
let at = await run(mk({
  applicable: true, bizName: '행복노래연습장', categories: { 노래연습장: '2' },
  location: '지하1층', owner: '홍길동', phone: '031-000-0000', capacity: '50',
  hoursDetail: { wkDay: '09:00~18:00', wkNight: '', holDay: '', holNight: '22:00~02:00' },
  userTypes: ['청소년'],
}))
console.log('  사업장명 N3 =', JSON.stringify(at('N3')), '| 업종 AS3 =', JSON.stringify(at('AS3')))
console.log('  위치 N4 =', JSON.stringify(at('N4')), '| 수용인원 AS8 =', JSON.stringify(at('AS8')))
console.log('  평일 N6 =', at('N6'), '| 평일주간 V6 =', at('V6'), '→', JSON.stringify(at('AD6')))
console.log('  평일야간 V7 =', at('V7'), '→', JSON.stringify(at('AD7')), '(빈 값 → 자리표시 유지)')
console.log('  휴일 AK6 =', at('AK6'), '| 휴일야간 AS7 =', at('AS7'), '→', JSON.stringify(at('BA7')))
console.log('  이용자 청소년 N9 =', at('N9'), '| 노유자 N8 =', at('N8'), '(음성)')
console.log('── 해당 X ──')
at = await run(mk({ applicable: false, categories: {}, bizName: '', location: '', owner: '', phone: '', hours: '', users: '', capacity: '' }))
console.log('  사업장명 N3 =', JSON.stringify(at('N3')), '| 평일 N6 =', at('N6'), '| AD6 =', JSON.stringify(at('AD6')))
