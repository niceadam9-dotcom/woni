/** 위임장!P15 위임 일자 · 계획서!L30 제출 일자 — PDF 미리보기와 같은 날짜 (2026-10-06 사용자 신고)
 *
 *  신고: 「위임장과 계획서 제출일 날짜가 보고서엑셀과 미리보기 화면 날짜와 동일하지 않아」.
 *  원인: 두 칸 모두 서식 `=개요!B10`(발신일자 = 점검 종료/시작일)인데 PDF는 보고일
 *  (`annexReportDateISO` — 수기 > 제출 기록 > 오늘)을 인쇄했다. 운영 6/6 불일치 실측.
 *
 *  단언: ①앵커 2칸이 서식 라벨을 통과(자가치유 0) ②ISO를 주면 시리얼이 실리고 `=개요!B10`이 끊긴다
 *  ③수기 위임 일자가 날짜로 안 읽히면 그 표기 그대로 ④미공급이면 서식 수식 존치(종전 동작)
 *  ⑤수기 표기 해석기(parseKoreanDateISO)
 *  실행: npx tsx --conditions=react-server scripts/test-delegation-plan-date.mts */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { ANCHORS, validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { parseKoreanDateISO } from '../src/lib/annex-cover-official.ts'

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
const build = (submitDate: string, submitISO: string | null | undefined, planReportDateISO?: string) => buildWorkbookValues({
  official: {
    company: { name: 'X', address: 'X', phone: 'X', fax: 'X' },
    docNo: 'X', sendDate: 'X', recipient: 'X', reference: 'X', sender: 'X',
    senderSign: { name: 'X', title: 'X', rep: 'X' }, year: 2026, typeLabel: 'X',
  },
  delegation: {
    typeLabel: 'X', owner: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
    agent: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
    periodLabel: 'X', daysLabel: '1일', submitDate, submitISO, station: 'X',
  },
  // 점검일(발신일자) 10-02 — 고친 뒤 두 칸이 이 날짜를 **따라가지 않아야** 한다
  customerAddress: 'X', startISO: '2026-10-02', endISO: '2026-10-02', useApprovalISO: null,
  installedCodes: [], evacTypes: [], building: null,
  report9: { ...R9_BLANK, planReportDateISO } as never,
})

async function readSheet(out: Uint8Array, sheet: string) {
  const zip = await JSZip.loadAsync(out)
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const relTarget = new Map([...rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
  const hit = [...wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)].find(m => m[1] === sheet)!
  const xml = await zip.file('xl/' + (relTarget.get(hit[2]) ?? '').replace(/^\/?xl\//, ''))!.async('string')
  const shared: string[] = []
  const ss = zip.file('xl/sharedStrings.xml')
  if (ss) {
    for (const si of (await ss.async('string')).match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
    }
  }
  const cells = new Map<string, { v: string; f: string | null }>()
  for (const c of xml.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) ?? []) {
    const ref = c.match(/r="([A-Z]+\d+)"/)?.[1]
    if (!ref) continue
    const t = c.match(/ t="([^"]+)"/)?.[1] ?? 'n'
    const f = c.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1] ?? null
    const raw = c.match(/<v>([\s\S]*?)<\/v>/)?.[1]
    const inline = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1]
    cells.set(ref, { v: t === 's' && raw ? (shared[Number(raw)] ?? '') : (inline ?? raw ?? ''), f })
  }
  return cells
}

const inject = async (submitDate: string, submitISO: string | null | undefined, planISO?: string) => {
  const vres = validateAnchors(bytes, ANCHORS)
  if (!vres.ok) { console.error('앵커 검증 실패:', vres.failures.join(' · ')); process.exit(1) }
  const { targets, unmapped } = toInjectTargets(build(submitDate, submitISO, planISO), vres.anchors)
  if (unmapped.length) { console.error('값 누락:', unmapped.map(a => a.field).join(',')); process.exit(1) }
  const out = (await injectWorkbook(bytes, targets)).bytes
  return { dg: (await readSheet(out, '위임장')).get('P15'), pl: (await readSheet(out, '계획서')).get('L30') }
}

console.log('── A. 앵커 2칸 ──')
{
  const a1 = ANCHORS.find(a => a.field === 'delegationDateSerial')
  const a2 = ANCHORS.find(a => a.field === 'planReportSerial')
  check('위임장!P15 앵커 존재', a1?.sheet === '위임장' && a1.cell === 'P15')
  check('계획서!L30 앵커 존재', a2?.sheet === '계획서' && a2.cell === 'L30')
  check('둘 다 dropFormula + keepFormulaWhenEmpty', !!(a1?.dropFormula && a1.keepFormulaWhenEmpty && a2?.dropFormula && a2.keepFormulaWhenEmpty))
  const vres = validateAnchors(bytes, ANCHORS)
  check('서식 라벨 대조 통과·두 칸 자가치유 0', vres.ok
    && !vres.healed.some(h => h.startsWith('delegationDateSerial') || h.startsWith('planReportSerial')), (vres.failures ?? []).join(' · '))
}

console.log('── B. 보고일 ISO를 주면 그 날짜 시리얼 · =개요!B10 끊김 ──')
{
  // 2026-10-21 = 46316, 2026-10-30 = 46325. 검산: 2026-01-01 = 46023, 10/21은 연중 294일째
  // (31+28+31+30+31+30+31+31+30=273, +21) → 46023+293. 점검일 10-02(46297)와 달라야 한다.
  const { dg, pl } = await inject('2026년 10월 21일', '2026-10-21', '2026-10-30')
  check('위임장 P15 = 2026-10-21 시리얼', dg?.v === '46316', `실제 "${dg?.v}"`)
  check('계획서 L30 = 2026-10-30 시리얼', pl?.v === '46325', `실제 "${pl?.v}"`)
  check('🚨 P15 수식 =개요!B10 끊김', dg?.f === null, dg?.f ? `잔존 =${dg.f}` : '')
  check('🚨 L30 수식 =개요!B10 끊김', pl?.f === null, pl?.f ? `잔존 =${pl.f}` : '')
  check('점검일(46297)을 따라가지 않는다', dg?.v !== '46297' && pl?.v !== '46297')
}

console.log('── C. 수기 위임 일자가 날짜가 아니면 표기 그대로 ──')
{
  const { dg } = await inject('10월 중', null, '2026-10-30')
  check('P15 = "10월 중"', dg?.v === '10월 중', `실제 "${dg?.v}"`)
  check('P15 수식 없음', dg?.f === null)
}

console.log('── D. 미공급(옛 호출부·픽스처)이면 서식 수식 존치 ──')
{
  const { dg, pl } = await inject('X', undefined, undefined)
  check('P15 = 개요!B10 존치', dg?.f === '개요!B10', `실제 f=${dg?.f}`)
  check('L30 = 개요!B10 존치', pl?.f === '개요!B10', `실제 f=${pl?.f}`)
}

console.log('── E. 수기 표기 해석기 ──')
for (const [s, want] of [
  ['2026년 7월 16일', '2026-07-16'], ['2026-07-16', '2026-07-16'], ['2026.7.6', '2026-07-06'],
  ['2026년7월6일', '2026-07-06'], ['2026-02-30', null], ['7월 중', null], ['', null], ['2026년 13월 1일', null],
] as const) {
  const got = parseKoreanDateISO(s)
  check(`"${s}" → ${want}`, got === want, `실제 ${got}`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
