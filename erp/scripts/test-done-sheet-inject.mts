/** 완료보고서(별지 11호) 「이행완료 사항」 8칸 주입 왕복 검증 (소방계획서_43 S5-2)
 *
 *  단언: ①앵커 8칸이 서식 라벨 대조를 통과한다 ②B19~B22에 내용, I19~I22에 날짜 시리얼이 실린다
 *  ③**I20의 `=개요!G10`이 끊긴다**(살려 두면 Excel 재계산이 실제 완료일을 계획 종료일로 되돌린다 — D-2)
 *  ④문구 상태(해당없음)는 1행만 차고 나머지는 공백 1칸(빈 셀이면 0으로 읽힌다) ⑤짝 유지
 *
 *  ⚠ 개수 하한을 **먼저** 단언한다 — 대상 셀이 0개여도 초록이 되는 공허 통과를 막는다
 *    ([[feedback_exhaustive_has_an_axis]]).
 *  실행: npx tsx --conditions=react-server scripts/test-done-sheet-inject.mts */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { ANCHORS, validateAnchors, DONE_ROWS } from '../src/lib/xlsx-anchors.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { annexDoneRows } from '../src/lib/report9-assemble.ts'
import { type AnnexDone } from '../src/lib/doc-templates/report9.ts'

const bytes = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const R9_BLANK = {
  ckOp: true, ckInitial: false, ckCompEtc: false, consent: null, repRole: '',
  managerGrade: '', mgrEduDate: '', rampCount: '', main: null, assistants: [],
  hasFirePlan: false, prevOpDone: false, prevCompDone: false, eduDone: false, drillDone: false,
  insuranceJoined: null, insCompany: '', insPeriod: '', insPerson: '', insProperty: '',
  multiUseNone: false, multiUseCounts: {},
  stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
  stairsCount: '', elvR: '', elvE: '', elvV: '',
  pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
  resultMarks: {}, defectRows: [],
}
const build = (done: AnnexDone, reportDateISO?: string) => buildWorkbookValues({
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
  report9: { ...R9_BLANK, done, reportDateISO } as never,
})

/** 주입 결과에서 완료보고서 시트 XML을 꺼내 셀을 읽는다(수식 존치 여부까지 본다) */
async function readDoneSheet(out: Uint8Array) {
  const zip = await JSZip.loadAsync(out)
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const relTarget = new Map([...rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
  const hit = [...wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)].find(m => m[1] === '완료보고서')!
  const xml = await zip.file('xl/' + (relTarget.get(hit[2]) ?? '').replace(/^\/?xl\//, ''))!.async('string')
  const shared: string[] = []
  const ss = zip.file('xl/sharedStrings.xml')
  if (ss) {
    for (const si of (await ss.async('string')).match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
    }
  }
  const cells = new Map<string, { v: string; f: string | null; t: string }>()
  for (const c of xml.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) ?? []) {
    const ref = c.match(/r="([A-Z]+\d+)"/)?.[1]
    if (!ref) continue
    const t = c.match(/ t="([^"]+)"/)?.[1] ?? 'n'
    const f = c.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1] ?? null
    const raw = c.match(/<v>([\s\S]*?)<\/v>/)?.[1]
    const inline = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1]
    const v = t === 's' && raw ? (shared[Number(raw)] ?? '') : (inline ?? raw ?? '')
    cells.set(ref, { v, f, t })
  }
  return cells
}

const inject = async (done: AnnexDone, reportDateISO?: string) => {
  const vres = validateAnchors(bytes, ANCHORS)
  if (!vres.ok) { console.error('앵커 검증 실패:', vres.failures.join(' · ')); process.exit(1) }
  const { targets, unmapped } = toInjectTargets(build(done, reportDateISO), vres.anchors)
  if (unmapped.length) { console.error('값 누락:', unmapped.map(a => a.field).join(',')); process.exit(1) }
  const res = await injectWorkbook(bytes, targets)
  return { cells: await readDoneSheet(res.bytes), targets }
}

const d = (name: string, taken: string, at: string) =>
  ({ defect_name: name, action_taken: taken, action_completed_at: at })

console.log('── A. 앵커 8칸이 존재하고 서식 라벨을 통과한다 ──')
// ⚠ 분모를 '완료보고서 시트의 전 앵커'로 잡으면 **다른 작업이 그 시트에 칸을 하나 더 열 때마다**
//   이 검사가 붉어진다(실제로 D-8 자사 3칸이 열리며 9→12가 됐다). 이 스위트가 지키는 것은
//   「이행완료 사항」 축이므로 분모도 그 축으로 좁힌다 — 다만 **0에서 공허 통과**하지 않도록
//   개수를 먼저 못박는다([[feedback_exhaustive_has_an_axis]]).
const doneAnchors = ANCHORS.filter(a => a.sheet === '완료보고서' && /^done/.test(a.field))
const doneCellAnchors = doneAnchors.filter(a => /^done(Content|Date)\d+$/.test(a.field))
check(`이행완료 사항 앵커 ${doneCellAnchors.length}칸 + 보고일 1칸`,
  doneCellAnchors.length === 8 && doneAnchors.length === 9, '개수 하한 선단언(공허 통과 방지)')
check('내용 4칸 = B19~B22', DONE_ROWS.every(r => doneAnchors.some(a => a.cell === `B${r}` && a.field === `doneContent${r}`)))
check('일자 4칸 = I19~I22', DONE_ROWS.every(r => doneAnchors.some(a => a.cell === `I${r}` && a.field === `doneDate${r}`)))
check('8칸 전부 dropFormula', doneAnchors.every(a => a.dropFormula === true), 'I20의 =개요!G10을 끊기 위한 필수 조건')
{
  const vres = validateAnchors(bytes, ANCHORS)
  check('validateAnchors 통과(자가치유 0)', vres.ok && vres.healed.filter(h => h.includes('done')).length === 0)
}

console.log('── B. 완료 3건 주입 ──')
{
  const { cells } = await inject(annexDoneRows([
    d('소화기 불량', '소화기 교체', '2026-08-20'),
    d('유도등 불량', '유도등 안정기 교체', '2026-08-21'),
    d('수신기 불량', '수신기 정비', '2026-08-22'),
  ], { hasAnyDefect: true, applicable: true }))
  check('B19 = 소화기 교체', cells.get('B19')?.v === '소화기 교체', `실제 "${cells.get('B19')?.v}"`)
  check('B20 = 유도등 안정기 교체', cells.get('B20')?.v === '유도등 안정기 교체')
  check('B21 = 수신기 정비', cells.get('B21')?.v === '수신기 정비')
  check('B22 = 공백 1칸(4건째 없음)', cells.get('B22')?.v === ' ', `실제 "${cells.get('B22')?.v}"`)
  // 2026-08-20 = 시리얼 46254. 검산: 2000-01-01=36526 → 2026-01-01 = 36526 + (26×365 + 윤 7) = 46023,
  // 2026은 평년이라 8/20은 연중 232일째(31+28+31+30+31+30+31=212, +20) → 46023 + 231 = 46254.
  // ⚠ 이 숫자를 손으로 46264라 적었다가 4건이 붉어졌다 — **제품이 아니라 검사가 틀렸다**.
  //   기대값을 isoToSerial로 계산하면 순환이라 상수로 박되, 산식을 함께 남겨 재검산 가능하게 둔다.
  check('I19 = 2026-08-20 시리얼', cells.get('I19')?.v === '46254', `실제 "${cells.get('I19')?.v}"`)
  check('I20 = 2026-08-21 시리얼', cells.get('I20')?.v === '46255', `실제 "${cells.get('I20')?.v}"`)
  check('I21 = 2026-08-22 시리얼', cells.get('I21')?.v === '46256')
  check('I22 = 공백 1칸', cells.get('I22')?.v === ' ')
  // ③ 핵심 — 서식의 =개요!G10이 남아 있으면 Excel이 열면서 계획 종료일로 되돌린다
  check('🚨 I20의 수식 =개요!G10 이 끊겼다', cells.get('I20')?.f === null,
    cells.get('I20')?.f ? `잔존: =${cells.get('I20')?.f}` : '수식 없음')
  check('일자 4칸 어디에도 수식이 없다', DONE_ROWS.every(r => cells.get(`I${r}`)?.f === null))
  check('짝 유지 — 내용 순서와 일자 순서가 같다',
    cells.get('B19')?.v === '소화기 교체' && cells.get('I19')?.v === '46254'
    && cells.get('B21')?.v === '수신기 정비' && cells.get('I21')?.v === '46256')
}

console.log('── C. 5건 → 접기 ──')
{
  const many = Array.from({ length: 5 }, (_, i) => d(`불량${i + 1}`, `조치${i + 1}`, `2026-08-2${i}`))
  const { cells } = await inject(annexDoneRows(many, { hasAnyDefect: true, applicable: true }))
  check('B19~B21 = 앞 3건', ['조치1', '조치2', '조치3'].every((x, i) => cells.get(`B${19 + i}`)?.v === x))
  check('B22 = 「외 2건 (별첨 참조)」', cells.get('B22')?.v === '외 2건 (별첨 참조)', `실제 "${cells.get('B22')?.v}"`)
  check('I22 = 공백 1칸(접기 행에 날짜 금지)', cells.get('I22')?.v === ' ')
}

console.log('── D. 문구 상태(해당없음) ──')
{
  const { cells } = await inject(annexDoneRows([], { hasAnyDefect: false, applicable: false }))
  check('B19 = 해당없음', cells.get('B19')?.v === '해당없음')
  check('B20~B22 = 공백 1칸(빈 셀 금지 — 0으로 읽힌다)',
    [20, 21, 22].every(r => cells.get(`B${r}`)?.v === ' '))
  check('일자 4칸 전부 공백 1칸(문구 옆 날짜 자리표 금지)',
    DONE_ROWS.every(r => cells.get(`I${r}`)?.v === ' '))
}

console.log('── E2. 보고일 G25 (43 S4 / D-4) ──')
{
  // 서식은 `=개요!G10+5`(이행조치 종료일 + 5일)라는 근거 없는 추정이었다. PDF 11호는
  // `annexReportDateISO()`(수기값 또는 오늘 KST)를 찍으므로 두 표면이 다른 날짜를 인쇄했다.
  const g25 = ANCHORS.filter(a => a.sheet === '완료보고서' && a.cell === 'G25')
  check(`G25 앵커 = ${g25.length}개`, g25.length === 1, '개수 하한 선단언')
  check('G25 labelCell = A24(법정 문구 — 이 칸엔 인접 라벨이 없다)', g25[0]?.labelCell === 'A24')
  check('G25 dropFormula + keepFormulaWhenEmpty',
    g25[0]?.dropFormula === true && g25[0]?.keepFormulaWhenEmpty === true)

  // 수기값 축 — 2026-08-20 = 46254(test-annex-done-rows와 같은 산식)
  const withDate = await inject(annexDoneRows([d('X', '조치', '2026-08-20')], { hasAnyDefect: true, applicable: true }), '2026-08-20')
  check('G25 = 보고일 시리얼', withDate.cells.get('G25')?.v === '46254', `실제 "${withDate.cells.get('G25')?.v}"`)
  check('🚨 G25의 `=개요!G10+5`가 끊겼다', withDate.cells.get('G25')?.f === null,
    withDate.cells.get('G25')?.f ? `잔존: =${withDate.cells.get('G25')?.f}` : '수식 없음')

  // 미공급(구 호출부·픽스처) — keepFormulaWhenEmpty가 서식 수식을 살린다(대조군 보호)
  const noDate = await inject(annexDoneRows([d('X', '조치', '2026-08-20')], { hasAnyDefect: true, applicable: true }))
  check('보고일 미공급이면 서식 수식 `개요!G10+5` 보존',
    (noDate.cells.get('G25')?.f ?? '').replace(/\s/g, '') === '개요!G10+5',
    `f=${noDate.cells.get('G25')?.f ?? '(없음)'}`)

  // 라벨이 긴 법정 문구라도 normLabel 대조를 통과하는가 — 여기가 깨지면 생성이 통째로 막힌다
  const vres = validateAnchors(bytes, ANCHORS)
  check('A24 법정 문구 라벨 대조 통과(자가치유 0)',
    vres.ok && !(vres.healed ?? []).some(h => h.includes('doneReportSerial')))
}

console.log('── E. 표본 고객 흔적이 늘지 않았다 ──')
{
  const { cells } = await inject(annexDoneRows([d('X', '조치', '2026-08-20')], { hasAnyDefect: true, applicable: true }))
  // 주입은 8칸만 건드린다 — 서식의 자사(소방공사업체) 칸은 그대로여야 한다(범위 밖 변경 금지)
  check('B12 자사명 무손상', cells.get('B12')?.v === '㈜승진소방ENG', `실제 "${cells.get('B12')?.v}"`)
  check('A24 법정 문구 무손상', (cells.get('A24')?.v ?? '').includes('이행완료 보고서를 제출합니다'))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed · ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
