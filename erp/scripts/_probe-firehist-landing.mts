/** 1.10.4 착지 확인 — 값이 **실제로 그 칸에** 들어갔는가.
 *
 *  앵커를 세우고 값을 채워도 「착지」는 별개 사실이다. 라우트와 같은 경로로 워크북을 만들고
 *  2단계 리더로 **되읽어** 확인한다 — 리더를 만든 보람이 여기 있다.
 *  실행: npx tsx scripts/_probe-firehist-landing.mts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { FIRE_PLAN_ANCHORS, FIREHIST_SHEET, FIREHIST_ROWS } from '../src/lib/fire-plan-anchors.ts'
import { buildFirePlanValues } from '../src/lib/fire-plan-xlsx-values.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
import type { FirePlanGenData } from '../src/lib/fire-plan-template.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const bytes = new Uint8Array(readFileSync(resolve(HERE, '../templates/fire-plan-workbook.xlsx')))

const fixture = {
  buildingName: '가상건물', facilities: [], brigade: [], zones: [],
  forms: {
    fireHistory: [
      { kind: '화재', at: '2025-03-01', place: '지하1층 전기실', cause: '누전', action: '차단기 교체' },
      { kind: '비화재보', at: '2025-07-14', place: '3층 복도', cause: '연기감지기 오동작', action: '감지기 교체' },
    ],
  },
} as unknown as FirePlanGenData

const check = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
if (!check.ok) { console.error('🚨 앵커 검증 실패:', check.failures.slice(0, 5)); process.exit(1) }
console.log(`앵커 ${check.anchors.length}개 · 1.10.4 반복행 ${FIREHIST_ROWS}행`)

const values = buildFirePlanValues(fixture)
const { targets, unmapped } = toInjectTargets(values, check.anchors)
if (unmapped.length) { console.error('🚨 미매핑:', unmapped.slice(0, 5)); process.exit(1) }

const out = await injectWorkbook(bytes, targets)
if (out.missed.length) { console.error('🚨 미착지:', out.missed.slice(0, 5)); process.exit(1) }

const g = await readSheetGrid(await JSZip.loadAsync(out.bytes), FIREHIST_SHEET)
const at = (ref: string) => g.cells.find(c => c.ref === ref)?.text ?? '(없음)'

console.log('\n되읽은 1.10.4 — 1·2행(데이터 있음) / 3행(빈 행이어야)')
for (const r of [3, 4, 5]) {
  console.log(`  r${r}  A=${JSON.stringify(at(`A${r}`))}  I=${JSON.stringify(at(`I${r}`))}  Q=${JSON.stringify(at(`Q${r}`))}  Z=${JSON.stringify(at(`Z${r}`))}  AM=${JSON.stringify(at(`AM${r}`))}`)
}
const ok = at('A3') === '화재' && at('Q3') === '지하1층 전기실'
  && at('A4') === '비화재보' && at('AM4') === '감지기 교체'
  && at('A5') === '' && at('AM5') === ''
console.log(`\n${ok ? '✅' : '🚨'} 두 행 착지 + 셋째 행은 빈칸 유지`)
process.exit(ok ? 0 : 1)
