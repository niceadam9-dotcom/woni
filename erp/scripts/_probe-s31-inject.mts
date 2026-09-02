/** 현1 3-1 동별 수량 주입 왕복 검증 — 서림사 실데이터 형상(A동 12/2/6 · B동 1/1/1).
 *  실행: npx tsx scripts/_probe-s31-inject.mts
 *  단언: 동명·수량(n타입)·합계 캐시(수식 보존)·빈 행의 자산 잔재('3'~'8') 소거·빈 합계 캐시 제거. */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { ANCHORS, validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'

const bytes = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const values = buildWorkbookValues({
  official: {
    company: { name: 'X', address: 'X', phone: 'X', fax: 'X' },
    docNo: 'X', sendDate: 'X', recipient: 'X', reference: 'X', sender: 'X',
    senderSign: { name: 'X', title: 'X', rep: 'X' }, year: 2026, typeLabel: 'X',
  },
  delegation: {
    typeLabel: 'X', owner: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
    agent: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
    periodLabel: 'X', daysLabel: '1일', submitDate: 'X', station: 'X',
  },
  customerAddress: 'X', startISO: '2026-07-23', endISO: '2026-07-23', useApprovalISO: null,
  installedCodes: [], evacTypes: [], building: null,
  report9: {
    ckOp: true, ckInitial: false, ckCompEtc: false, consent: null, repRole: '',
    managerGrade: '', mgrEduDate: '', rampCount: '', main: null, assistants: [],
    hasFirePlan: false, prevOpDone: false, prevCompDone: false, eduDone: false, drillDone: false,
    insuranceJoined: null, insCompany: '', insPeriod: '', insPerson: '', insProperty: '',
    multiUseNone: false, multiUseCounts: {},
    stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
    rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
    stairsCount: '', elvR: '', elvE: '', elvV: '',
    pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
    resultMarks: {},
    specs: {
      s31_extinguisher: {
        summary: {
          types: ['소화기(분말)', '소화기(기타)', '자동확산소화기'],
          dong_rows: [
            { dong: 'A동', qty_ext_powder: 12, qty_ext_other: 2, qty_auto_diffuse: 6 },
            { dong: 'B동', qty_ext_powder: 1, qty_ext_other: 1, qty_auto_diffuse: 1 },
          ],
        },
      },
    },
  },
})

const vres = validateAnchors(bytes, ANCHORS)
if (!vres.ok) { console.error('앵커 검증 실패:', vres.failures.join(' · ')); process.exit(1) }
const { targets, unmapped } = toInjectTargets(values, vres.anchors)
if (unmapped.length) { console.error('값 누락:', unmapped.map(a => a.field).join(',')); process.exit(1) }
const result = await injectWorkbook(bytes, targets)
if (result.missed.length) { console.error('미발견 셀:', result.missed.join(',')); process.exit(1) }

// 출력에서 현1 셀 읽기 (원시 XML — SheetJS 금지 축과 같은 방식)
const zip = await JSZip.loadAsync(result.bytes)
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const sheets = [...wbXml.matchAll(/<sheet[^>]*\sname="([^"]+)"[^>]*r:id="([^"]+)"/g)]
  .map(m => ({ name: m[1], path: 'xl/' + relMap.get(m[2])!.replace(/^\//, '').replace(/^xl\//, '') }))
const xml = await zip.file(sheets.find(s => s.name === '현1')!.path)!.async('string')

type Cell = { t: string; v: string | null; f: string | null; inline: string | null }
const cells = new Map<string, Cell>()
for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
  const attrs = m[1], body = m[2] ?? ''
  const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '?'
  cells.set(ref, {
    t: /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n',
    v: /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? null,
    f: /<f[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1] ?? null,
    inline: [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('') || null,
  })
}
const txt = (ref: string) => cells.get(ref)?.inline ?? cells.get(ref)?.v ?? ''
const num = (ref: string) => ({ v: cells.get(ref)?.v, t: cells.get(ref)?.t })

console.log('[왕복 단언]')
check('A7 = A동', txt('A7') === 'A동', JSON.stringify(txt('A7')))
check('B7 = 12 (n타입)', num('B7').v === '12' && num('B7').t === 'n', JSON.stringify(num('B7')))
check('G7 = 2', num('G7').v === '2', JSON.stringify(num('G7')))
check('N7 = 6', num('N7').v === '6', JSON.stringify(num('N7')))
check('A8 = B동', txt('A8') === 'B동', JSON.stringify(txt('A8')))
check('B8 = 1', num('B8').v === '1', JSON.stringify(num('B8')))
check('빈 행 잔재 소거 — A9~A14 전부 공란',
  ['A9', 'A10', 'A11', 'A12', 'A13', 'A14'].every(r => !txt(r)), JSON.stringify(txt('A9')))
check('합계 B5 캐시 = 13 · SUM 수식 보존', num('B5').v === '13' && !!cells.get('B5')?.f, JSON.stringify(num('B5')) + ' f=' + cells.get('B5')?.f)
check('합계 G5 캐시 = 3', num('G5').v === '3', JSON.stringify(num('G5')))
check('합계 N5 캐시 = 7', num('N5').v === '7', JSON.stringify(num('N5')))
check('빈 합계 I5 — 캐시 제거·수식 보존', (cells.get('I5')?.v ?? null) === null && !!cells.get('I5')?.f, JSON.stringify(cells.get('I5')))
check('빈 합계 Q5 — 캐시 제거·수식 보존', (cells.get('Q5')?.v ?? null) === null && !!cells.get('Q5')?.f, JSON.stringify(cells.get('Q5')))
check('체크 — 분말 [√]', txt('B4').includes('√'), JSON.stringify(txt('B4')))
check('체크 — 자동확산 [√]', txt('O3').includes('√'), JSON.stringify(txt('O3')))
check('체크 — 자동소화장치 [  ]', !txt('R3').includes('√'), JSON.stringify(txt('R3')))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
