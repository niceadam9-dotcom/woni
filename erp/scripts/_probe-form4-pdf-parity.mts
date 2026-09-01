/** ⭐ D-7 대조 — 같은 점검 건의 **별지 4호 1쪽 PDF**와 **갑지 엑셀 `현황` 시트**가 같은 판정을 찍는가
 *  (소방계획서_27, 2026-08-25). 실행: npx tsx scripts/_probe-form4-pdf-parity.mts
 *
 *  왜 이 축이 필요한가 —
 *  ERP는 점검 결과를 이미 안다(assembleReport9 → resultMarks). 별지 9호 3쪽·별지 4호 1쪽 PDF는
 *  그 값을 **이미 인쇄하고 있었다**. 그런데 엑셀 갑지의 같은 칸(64칸)은 비어 있었다 —
 *  즉 같은 점검 건에서 **PDF는 판정을 찍고 엑셀은 공란**인, D-7('PDF와 엑셀이 갈라지지 않는다')이
 *  깨진 상태였다. 좌표·행 순서·글리프 어느 하나만 어긋나도 조용히 갈라지는 부류라,
 *  **PDF HTML을 실제로 렌더해 행 단위로 기계 대조**한다(둘 다 같은 조립 데이터에서 출발).
 *
 *  이 프로브는 LibreOffice가 필요 없다(캐시 층까지만 본다). **재계산 후에도 같은가**는
 *  `scripts/_probe-xlsx-recalc.mts`의 [7] 축이 LO 왕복으로 확인한다 — 두 축은 짝이다. */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { facilityResultSection, muResultSection, FORM3_ITEMS } from '../src/lib/doc-templates/report9.ts'
import { rollUpForm3Results, legacySheetOnlyStats, foldSheetResult, type SheetStat } from '../src/lib/sheet-facility-map.ts'
import { FORM4_ROWS, FORM4_UNWIRED, FORM4_SHEET } from '../src/lib/xlsx-form4.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook, sheetFileMap } from '../src/lib/xlsx-inject.ts'
import { SCRUB_NEEDLES } from '../src/lib/xlsx-anchors.ts'
import type { OfficialData } from '../src/lib/doc-templates/official.ts'
import type { DelegationData } from '../src/lib/doc-templates/delegation.ts'

const TPL = process.argv[2] ?? 'templates/report-workbook-full.xlsx'
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

// ── 픽스처 ───────────────────────────────────────────────────────────────────
// 한 파일에서 다섯 방향을 다 본다: ○ · × · ／(전부 해당없음) · 공란(설치인데 무응답) ·
// 그리고 **미설치인데 응답이 있는** 반대 방향(대장 누락 의심 — PDF는 결과를 지우지 않는다).
/** 대표 1동 설비 대장 — 별지 9호 조립(report9-assemble)이 보는 축(ledgerCodes) */
const LEDGER = [
  '소화기구 및 자동소화장치', '소화기(소화기·자동확산·간이)', '주거용주방자동소화장치',
  '옥내소화전설비', '스프링클러설비', '자동화재탐지설비 및 시각경보기',
  '유도등', '유도표지', '피난기구', '인명구조기구', '비상조명등', '연결송수관설비',
]
/** 워크북 라우트가 넘기는 설치 목록 — **전 동**이라 대표 1동보다 넓을 수 있다(실제 코드의 축 차이).
 *  판정 칸이 이 목록이 아니라 PDF와 같은 축을 보는지 확인하려고 일부러 1종을 더 넣는다. */
const INSTALLED = [...LEDGER, '옥외소화전설비']
const EVAC = ['완강기', '승강식피난기']   // 그룹 0·2 설치, 그룹 1(다수인피난장비) 미설치

const SHEETS: Array<[string, Array<'O' | 'X' | 'N'>]> = [
  ['소화기구 및 자동소화장치', ['O', 'O']],                 // 부모 ○ → 첫 설치 하위 1칸에만
  ['옥내소화전설비', ['O', 'X']],                            // × 하나면 ×
  ['스프링클러설비', ['N', 'N']],                            // 응답은 있는데 전부 ／
  ['자동화재탐지설비 및 시각경보장치', ['O']],               // 형제 화재알림설비는 미설치 → 번지지 않음
  ['유도등 및 유도표지', ['O']],                             // 피난유도선(미설치)로 번지지 않음
  ['피난기구 및 인명구조기구', ['X']],
  ['비상조명등 및 휴대용비상조명등', ['O']],                 // 휴대용(미설치)로 번지지 않음
  ['연소방지설비', ['O']],                                   // ⚠ 미설치인데 응답 — PDF는 지우지 않는다
  // '연결송수관설비'는 일부러 비운다 — 설치인데 무응답 = 공란(양호 아님)
]
const sheetStat = new Map<string, SheetStat>()
for (const [name, results] of SHEETS) {
  for (const r of results) sheetStat.set(name, foldSheetResult(sheetStat.get(name), r))
}
const { facilityChecks, resultMarks } = rollUpForm3Results(legacySheetOnlyStats(sheetStat), FORM3_ITEMS, LEDGER)
const etcMarks = { door: 'O' as const, exit: 'X' as const, flame: 'N' as const }
const muResults: Record<string, 'O' | 'X' | 'N'> = Object.fromEntries(
  Array.from({ length: 16 }, (_, i) => [`MU-${String(i + 1).padStart(3, '0')}`, (['O', 'X', 'N'] as const)[i % 3]]))
const specs = { s36_evac: { evac_equipment: { types: EVAC } } }

console.log(`[0] 픽스처 — 설치(대장) ${LEDGER.length}종 · 결과 마크 ${Object.keys(resultMarks).length}칸`)
{
  const dist = new Set(Object.values(resultMarks))
  check('resultMarks가 O·X·N 세 값을 모두 담는다(상수 픽스처 아님)',
    dist.has('O') && dist.has('X') && dist.has('N'), [...dist].join(''))
  const blank = facilityChecks.filter(i => !resultMarks[i])
  check('설치인데 무응답(공란) 항목이 1건 이상', blank.length > 0, blank.join(', '))
}

// ── PDF 렌더 ─────────────────────────────────────────────────────────────────
const r9d = { facilityChecks, resultMarks, ledgerCodes: LEDGER, specs, etcMarks }
const html1 = facilityResultSection(r9d, { form: 'annex4' })
const html2 = muResultSection({ muResults }, { form: 'annex4' })

/** p3Table 행 → { label, mark }. 좌 표가 먼저 오고 우 표가 뒤에 온다(문서 순서 = 서식 순서) */
function pdfRows(html: string): Array<{ label: string; mark: string }> {
  const out: Array<{ label: string; mark: string }> = []
  for (const m of html.matchAll(/<td class="pre">([\s\S]*?)<\/td><td class="center mk">([\s\S]*?)<\/td>/g)) {
    const text = (s: string) => s.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    out.push({ label: text(m[1]).replace(/^\[[\s√]*\]\s*/, ''), mark: text(m[2]) })
  }
  return out
}
const rows1 = pdfRows(html1)
const rows2 = pdfRows(html2)

// ── 엑셀 주입 ────────────────────────────────────────────────────────────────
const official: OfficialData = {
  company: { name: '㈜테스트소방', address: '주소', phone: '031-000-0000', fax: '031-000-0001' },
  docNo: '승 진 2608-7', sendDate: '2026년 8월', recipient: '대조대상빌딩', reference: '관계인',
  sender: '㈜테스트소방', senderSign: { name: '㈜테스트소방', title: '대표이사', rep: '홍대표' },
  year: 2026, typeLabel: '작동점검',
}
const delegation: DelegationData = {
  typeLabel: '작동점검',
  owner: { name: '박관계', position: '소방안전관리자', phone: '010-1111-2222', birth: '1980.01.02' },
  agent: { name: '김점검', position: '과장', phone: '010-3333-4444', birth: '1990.03.04' },
  periodLabel: '2026.08.20 부터 ~ 2026.08.21 까지', daysLabel: '2일', submitDate: '2026년 8월 21일', station: '양평',
}
const values = buildWorkbookValues({
  official, delegation, customerAddress: '경기도 양평군 대조로 1',
  startISO: '2026-08-20', endISO: '2026-08-21', useApprovalISO: '2011-06-25',
  installedCodes: INSTALLED, evacTypes: EVAC, building: null,
  report9: {
    ckOp: true, ckInitial: false, ckCompEtc: false, consent: true, repRole: '관리자',
    managerGrade: '2급', mgrEduDate: '2024년 5월 2일', rampCount: '2',
    main: { name: '김주된', grade: '소방시설관리사', licenseNo: '제2026-1호' }, assistants: [],
    hasFirePlan: true, prevOpDone: true, prevCompDone: false, eduDone: true, drillDone: true,
    insuranceJoined: true, insCompany: '현대해상', insPeriod: '2026.4.1~2027.3.31',
    insPerson: '5000', insProperty: '50000', multiUseNone: true, multiUseCounts: {},
    stCon: true, stSteel: false, stBrick: false, stWood: false, stEtc: false,
    rfSlab: true, rfTile: false, rfSlate: false, rfEtc: false,
    stairsCount: '3', elvR: '2', elvE: '', elvV: '',
    pkIn: false, pkMech: false, pkRoof: false, pkOut: true,
    // ⭐ 이 세 축이 D-7의 핵심 — PDF가 쓰는 것을 **그대로** 넘긴다
    resultMarks, ledgerCodes: LEDGER,
  },
})
const template = new Uint8Array(readFileSync(TPL))
const injected = await injectWorkbook(template, toInjectTargets(values).targets, { forbidden: SCRUB_NEEDLES })
check('주입 대상 미발견 0', injected.missed.length === 0, injected.missed.slice(0, 5).join(', '))

const z = await JSZip.loadAsync(injected.bytes)
const hyunXml = await z.file((await sheetFileMap(z)).get(FORM4_SHEET)!)!.async('string')
/** 셀의 **표시 값** — inlineStr / t="str" 캐시 / 숫자. `=""`만 남은 칸은 공란이다.
 *  ⚠ 자기닫힘 `<c …/>`을 함께 받지 않으면 좌표가 앞 빈 셀로 밀린다(이 저장소가 세 번 물린 함정) */
const cellCache = new Map<string, string>()
for (const m of hyunXml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
  const inner = m[3] ?? ''
  const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(inner)?.[1]
  const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
  cellCache.set(m[1], (inline ?? v ?? '').replace(/&amp;/g, '&').trim())
}
const cell = (ref: string) => cellCache.get(ref) ?? ''

// ── 축 대조: PDF 행 순서 ↔ 엑셀 좌표 ────────────────────────────────────────
// 서식 원문 배치(실측). 좌 표 28행 + 우 표 23행 = 51행. `(비고)`·부모 2행은 엑셀에 판정 칸이 없다.
const LEFT_SEQ = ['C6', 'D7', 'D8', 'D9', 'D10', 'D11',
  'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21', 'C22', 'C23', 'C24', 'C25',
  'C26', 'C27', 'C28', 'C29', 'C30', 'C31', 'C32', 'C33']
const RIGHT_SEQ = ['Y6', 'Z7', 'Z9', 'Z10',
  'Y12', 'Y13', 'Y14', 'Y15', 'Y16', 'Y17', 'Y18', 'Y19',
  'Y20', 'Y21', 'Y22', 'Y23', 'Y24', 'Y25', 'Y26', 'Y27', 'Y28', 'Y29', '(비고)']
const SEQ1 = [...LEFT_SEQ, ...RIGHT_SEQ]
/** 2쪽 다중이용업소 — 좌 8행 + 우 9행(마지막이 비고) */
const SEQ2 = ['C37', 'C38', 'C39', 'C40', 'C41', 'C42', 'C43', 'C44',
  'Y37', 'Y38', 'Y39', 'Y40', 'Y41', 'Y42', 'Y43', 'Y44', '(비고)']

const rowByCell = new Map(FORM4_ROWS.map(r => [r.cell, r]))
const unwiredByCell = new Map(FORM4_UNWIRED.map(u => [u.cell, u]))

console.log('[1] 축 — PDF 행 수 = 엑셀 좌표 수, 그리고 표의 전 칸이 배치에 실린다')
{
  check(`1쪽 PDF ${rows1.length}행 = 배치 ${SEQ1.length}칸`, rows1.length === SEQ1.length)
  check(`2쪽 PDF ${rows2.length}행 = 배치 ${SEQ2.length}칸`, rows2.length === SEQ2.length)
  const placed = new Set([...SEQ1, ...SEQ2])
  const missing = [...FORM4_ROWS.map(r => r.cell), ...FORM4_UNWIRED.map(u => u.cell)].filter(c => !placed.has(c))
  check('FORM4 표의 전 칸이 PDF 배치에 실린다(손목록 위의 전수 방지)', missing.length === 0, missing.join(', '))
  const stray = [...SEQ1, ...SEQ2].filter(c => c !== '(비고)' && !rowByCell.has(c) && !unwiredByCell.has(c))
  check('배치에 표 밖 좌표 0', stray.length === 0, stray.join(', '))
}

console.log('[2] 라벨 — 같은 줄을 보고 있는가(순서가 밀리면 여기가 먼저 붉어진다)')
{
  // 갑지 엑셀 서식의 자구가 고시 원문과 다른 자리(실측) — 새 드리프트가 생기면 붉어지도록 못박는다
  const KNOWN_DRIFT: Record<string, string> = {
    C23: '강화액소화전설비',        // 갑지 '강화액소화설비'
    C24: '고체에어로졸소화전설비',  // 갑지 '고체에어로졸소화설비'
    Y27: '방화문, 자동방화셔터',    // 갑지 '방화문, 방화셔터'
  }
  const nz = (s: string) => s.replace(/[\s,ㆍ·・()]/g, '')
  const bad: string[] = []
  const zip1 = SEQ1.map((c, i) => [c, rows1[i]] as const)
  for (const [c, row] of zip1) {
    if (c === '(비고)' || !row) continue
    const excel = rowByCell.get(c)?.label ?? unwiredByCell.get(c)?.label ?? ''
    const drift = KNOWN_DRIFT[c]
    const ok = drift ? nz(row.label) === nz(drift)
      : nz(row.label).startsWith(nz(excel)) || nz(excel).startsWith(nz(row.label))
    if (!ok) bad.push(`${c}: 엑셀 '${excel}' ↔ PDF '${row.label}'`)
  }
  check(`1쪽 ${zip1.length - 1}행 라벨 정합(알려진 자구 드리프트 ${Object.keys(KNOWN_DRIFT).length}건 제외)`,
    bad.length === 0, bad.slice(0, 6).join(' | '))
}

console.log('[3] ⭐ 판정 값 — 배선 45칸이 PDF와 글자까지 같은가')
{
  const mismatch: string[] = []
  let compared = 0
  SEQ1.forEach((c, i) => {
    const row = rowByCell.get(c)
    if (!row?.verdictCell) return
    compared++
    const got = cell(row.verdictCell)
    const want = rows1[i]?.mark ?? ''
    if (got !== want) mismatch.push(`${row.verdictCell}(${row.label}) 엑셀='${got}' PDF='${want}'`)
  })
  check(`1쪽 배선 ${compared}칸 전부 PDF와 일치`, mismatch.length === 0 && compared === 45,
    mismatch.length ? mismatch.slice(0, 10).join(' | ') : `대조 ${compared}칸`)
  // 민감도 — 대조가 '둘 다 공란'으로 공허하게 통과하지 않는다는 증명
  const nonEmpty = SEQ1.filter((c, i) => rowByCell.get(c)?.verdictCell && (rows1[i]?.mark ?? '') !== '').length
  check('그중 PDF가 실제 마크를 찍는 칸이 30칸 이상(공허 통과 아님)', nonEmpty >= 30, `${nonEmpty}칸`)
  const marks = new Set(SEQ1.map((c, i) => rowByCell.get(c)?.verdictCell ? cell(rowByCell.get(c)!.verdictCell!) : '')
    .filter(Boolean))
  check("엑셀에 ○·×·/ 세 글리프가 모두 실린다", marks.has('○') && marks.has('×') && marks.has('/'), [...marks].join(' '))
}

console.log('[4] 미배선 19칸 — 엑셀은 비운다(모르는 것을 지어내지 않는다). PDF와의 차이를 센다')
{
  const dirty = FORM4_UNWIRED.filter(u => cell(u.verdictCell) !== '')
  check(`미배선 ${FORM4_UNWIRED.length}칸 전부 공란`, dirty.length === 0,
    dirty.slice(0, 6).map(u => `${u.verdictCell}='${cell(u.verdictCell)}'`).join(', '))
  const pdfHas = [
    ...SEQ1.map((c, i) => unwiredByCell.has(c) && (rows1[i]?.mark ?? '') !== '' ? `${c}='${rows1[i].mark}'` : null),
    ...SEQ2.map((c, i) => unwiredByCell.has(c) && (rows2[i]?.mark ?? '') !== '' ? `${c}='${rows2[i].mark}'` : null),
  ].filter(Boolean) as string[]
  console.log(`     ↳ 알려진 D-7 잔여: PDF는 찍고 엑셀은 비우는 칸 ${pdfHas.length}개 — ${pdfHas.slice(0, 6).join(', ')}${pdfHas.length > 6 ? ' …' : ''}`)
}

console.log('[5] 부모 행(소화기구·피난기구) — 엑셀 서식에 판정 칸 자체가 없다')
{
  const parents = ['C6', 'Y6']
  const noCell = parents.every(c => rowByCell.get(c)?.verdictCell === null)
  check('부모 2행의 verdictCell이 null(서식 실측)', noCell)
  const lost = parents.map(c => ({ c, mark: rows1[SEQ1.indexOf(c)]?.mark ?? '' })).filter(x => x.mark !== '')
  check('이 픽스처에서 부모 행에 남는 PDF 마크 0(하위가 설치돼 아래로 내려갔다)',
    lost.length === 0, lost.map(x => `${x.c}='${x.mark}'`).join(', '))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
