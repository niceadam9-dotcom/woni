/** 자사 정보 4칸 배선 — **출력이 한 글자도 안 바뀐다**는 것이 이 배선의 전제다 (소방계획서_43 D-8)
 *
 *  갑지 서식에는 자사 정보가 6시트 18칸에 동결 리터럴로 박혀 있다. 정본은 DB `company_profile`이고
 *  PDF는 그 값을 인쇄하므로, 회사 정보가 바뀌면 두 표면이 갈라진다(D-7).
 *
 *  🚫 그런데 전수 배선은 지금 하면 **인쇄물이 나빠진다**(2026-09-08 실측): 상호가 템플릿에 4종인데
 *     DB는 2개뿐이고 글자가 다르며(배선하면 계약서에서 `㈜`가 사라진다), 주소는 지번이 소실되고,
 *     `management_reg_no`는 더미 `1234567`이라 실제 등록번호를 덮는다.
 *     그래서 **DB 값이 서식 리터럴과 글자까지 같은 4칸만** 열었다.
 *
 *  이 검사가 지키는 것:
 *   [1] 앵커 4칸이 서식 라벨 대조를 통과한다(개수 하한 선단언)
 *   [2] **주입 전후 그 4칸의 값이 같다** — 배선의 전제. 깨지면 인쇄물이 조용히 바뀐 것이다.
 *   [3] 위험한 칸(상호·주소·등록번호)은 **여전히 미배선**이다 — 나중에 무심코 열리는 것을 막는다.
 *   [4] 값이 비면 리터럴을 지운다(옛 값이 남아 인쇄되지 않는다)
 *
 *  실행: npx tsx --conditions=react-server scripts/test-company-anchors.mts */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { ANCHORS, validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'

const bytes = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${m}${d ? ` — ${d}` : ''}`); c ? pass++ : fail++
}

/** 서식 실측값 — 이 값들이 DB와 같다는 것이 배선의 근거였다(_probe-43-d8-labels 2026-09-08) */
const TPL = {
  '완료보고서!I12': '586-86-00740',
  '완료보고서!C14': '김흥준',
  '완료보고서!F14': '031-772-3019',
  '계약서!H28': '031-772-3019',
} as const

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
const build = (company: { name: string; address: string; phone: string; fax: string; bizNo?: string }, rep: string) =>
  buildWorkbookValues({
    official: {
      company, docNo: 'X', sendDate: 'X', recipient: 'X', reference: 'X', sender: 'X',
      senderSign: { name: 'X', title: 'X', rep }, year: 2026, typeLabel: 'X',
    },
    delegation: {
      typeLabel: 'X', owner: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
      agent: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
      periodLabel: 'X', daysLabel: '1일', submitDate: 'X', station: 'X',
    },
    customerAddress: 'X', startISO: '2026-07-23', endISO: '2026-07-23', useApprovalISO: null,
    installedCodes: [], evacTypes: [], building: null, report9: R9_BLANK as never,
  })

async function readCells(out: Uint8Array, wanted: string[]) {
  const zip = await JSZip.loadAsync(out)
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const relTarget = new Map([...rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
  const shared: string[] = []
  const ss = zip.file('xl/sharedStrings.xml')
  if (ss) {
    for (const si of (await ss.async('string')).match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
    }
  }
  const out2 = new Map<string, string>()
  for (const ref of wanted) {
    const [sheet, cell] = ref.split('!')
    const hit = [...wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)].find(m => m[1] === sheet)
    if (!hit) continue
    const xml = await zip.file('xl/' + (relTarget.get(hit[2]) ?? '').replace(/^\/?xl\//, ''))!.async('string')
    const c = (xml.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) ?? []).find(x => x.includes(`r="${cell}"`))
    if (!c) { out2.set(ref, ''); continue }
    const t = c.match(/ t="([^"]+)"/)?.[1] ?? 'n'
    const raw = c.match(/<v>([\s\S]*?)<\/v>/)?.[1]
    const inline = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1]
    out2.set(ref, t === 's' && raw ? (shared[Number(raw)] ?? '') : (inline ?? raw ?? ''))
  }
  return out2
}

const REAL = { name: '승진소방ENG', address: '경기 양평군 양평읍 잿말길10번길 50-1', phone: '031-772-3019', fax: '', bizNo: '586-86-00740' }

console.log('── [1] 앵커 4칸 ──')
const FIELDS = ['companyBizNo', 'companyRepName', 'companyPhone', 'companyPhone2']
const got = ANCHORS.filter(a => FIELDS.includes(a.field))
ok(got.length === 4, `자사 앵커 ${got.length}칸(개수 하한 선단언)`, got.map(a => `${a.sheet}!${a.cell}`).join(' '))
for (const [ref] of Object.entries(TPL)) {
  ok(got.some(a => `${a.sheet}!${a.cell}` === ref), `${ref} 배선됨`)
}
ok(got.every(a => a.dropFormula === true), '4칸 전부 dropFormula(서식 리터럴을 값으로 대체)')
const vres = validateAnchors(bytes, ANCHORS)
ok(vres.ok && !(vres.healed ?? []).some(h => FIELDS.some(f => h.includes(f))), '서식 라벨 대조 통과(자가치유 0)')

console.log('── [2] 배선의 전제 — 주입 전후 값이 같다 ──')
{
  const before = await readCells(bytes, Object.keys(TPL))
  for (const [ref, want] of Object.entries(TPL)) {
    ok(before.get(ref) === want, `주입 전 서식값 = "${want}"`, `${ref} 실제 "${before.get(ref)}"`)
  }
  const { targets, unmapped } = toInjectTargets(build(REAL, '김흥준'), vres.ok ? vres.anchors : ANCHORS)
  if (unmapped.length) { console.error('값 누락:', unmapped.map(a => a.field).join(',')); process.exit(1) }
  const res = await injectWorkbook(bytes, targets)
  const after = await readCells(res.bytes, Object.keys(TPL))
  for (const [ref, want] of Object.entries(TPL)) {
    ok(after.get(ref) === want, `🚨 주입 후에도 같다(인쇄물 무변화) ${ref}`,
      `"${after.get(ref)}" (전 "${before.get(ref)}")`)
  }
}

console.log('── [3] 위험한 칸은 여전히 미배선 ──')
// 상호·주소·등록번호를 무심코 열면 계약서의 ㈜가 사라지고 등록번호가 더미로 덮인다(M-19).
// 열려면 **데이터 교정이 선행**이라는 사실을 검사로 못박는다.
for (const ref of ['완료보고서!B12', '완료보고서!B16', '계약서!D27', '계약서!D28', '공문!A1', '공문!A2', '대상물2!A23']) {
  const [sheet, cell] = ref.split('!')
  ok(!ANCHORS.some(a => a.sheet === sheet && a.cell === cell),
    `${ref} 미배선 유지(상호·주소·등록번호는 데이터 교정 선행)`)
}

console.log('── [4] 값이 비면 옛 리터럴을 지운다 ──')
{
  const empty = build({ name: '', address: '', phone: '', fax: '', bizNo: '' }, '')
  ok(FIELDS.every(f => empty.get(f) === null), '회사 정보 공란 → 4칸 전부 null(리터럴 소거)',
    FIELDS.map(f => `${f}=${JSON.stringify(empty.get(f))}`).join(' '))
  const { targets } = toInjectTargets(empty, vres.ok ? vres.anchors : ANCHORS)
  const res = await injectWorkbook(bytes, targets)
  const after = await readCells(res.bytes, Object.keys(TPL))
  ok(Object.keys(TPL).every(ref => (after.get(ref) ?? '').trim() === ''),
    '주입 후 4칸이 비었다(남의 옛 값이 인쇄되지 않는다)',
    Object.keys(TPL).map(r => `${r}="${after.get(r)}"`).join(' '))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed · ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
