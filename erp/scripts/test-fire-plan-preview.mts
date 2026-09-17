/** xlsx 리더·템플릿 캐시 검사 — `src/lib/xlsx-read-sheet.ts`, `src/lib/fire-plan-template-cache.ts`.
 *
 *  이 리더는 서식 미리보기의 **바닥**이다. 여기가 틀리면 미리보기가 실제 엑셀과 다른 그림을
 *  그리는데, 그건 기능이 아니라 **거짓말**이다. 그래서 「그럴듯한가」가 아니라 **두 독립 축**으로
 *  증명한다:
 *
 *   [1] SheetJS 교차검증 — 독립한 다른 파서가 같은 답을 내는가(병합·행높이·열폭·글자)
 *   [2] 라이터 왕복 항등 — `buildXlsx`로 쓴 것을 되읽으면 그대로인가(테두리·채움·정렬 포함)
 *
 *  ⚠ [1]만으로는 부족하다. SheetJS는 **테두리·정렬을 모른다** — 그 축은 [2]만 붙든다.
 *    반대로 [2]만이면 「내 라이터와 내 리더가 같이 틀린」 경우를 못 본다. 둘이 상보적이다.
 *
 *  실행: npx tsx scripts/test-fire-plan-preview.mts
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { readSheetGrid, parseRef, colIndex } from '../src/lib/xlsx-read-sheet.ts'
import { buildXlsx, type BuildSheet, type CellStyle } from '../src/lib/xlsx-build.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const XLSX_PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

const bytes = new Uint8Array(readFileSync(XLSX_PATH))
const zip = await JSZip.loadAsync(bytes)
const wb = XLSX.read(bytes, { cellStyles: true })

/* ══════════════════════ [0] 눈멂 가드 ══════════════════════
 *  분모부터 세운다. 0장을 훑고 「전건 일치」라 말하면 항진명제다. */
console.log('\n[0] 눈멂 가드 — 분모')
const SHEETS = FIRE_PLAN_MANIFEST.sheets.map(s => s.name)
check('시트 목록이 있다', SHEETS.length === 50, `${SHEETS.length}장`)
check('SheetJS도 같은 시트 수를 본다', wb.SheetNames.length === SHEETS.length,
  `${wb.SheetNames.length}장`)

/* ══════════════════════ [1] 리더 ↔ SheetJS 교차검증 ══════════════════════ */
console.log('\n[1] 리더 ↔ SheetJS — 독립한 두 파서가 같은 답을 내는가')
let cmpCells = 0, cmpMerges = 0, cmpRows = 0, cmpCols = 0
const bad: string[] = []
for (const name of SHEETS) {
  const g = await readSheetGrid(zip, name)
  const ws = wb.Sheets[name]
  if (!ws) { bad.push(`${name}: SheetJS에 시트 없음`); continue }

  // 병합 — 집합으로 비교(순서는 계약이 아니다)
  const mine = new Set(g.merges)
  const theirs = new Set((ws['!merges'] ?? []).map(m =>
    `${XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })}:${XLSX.utils.encode_cell({ r: m.e.r, c: m.e.c })}`))
  if (mine.size !== theirs.size || [...mine].some(x => !theirs.has(x))) {
    bad.push(`${name}: 병합 ${mine.size} vs ${theirs.size}`)
  }
  cmpMerges += mine.size

  // 행 높이
  for (let r = 0; r < g.rows; r++) {
    const theirH = (ws['!rows'] ?? [])[r]?.hpt
    if (theirH === undefined) continue
    if (Math.abs(theirH - g.rowHeights[r]) > 0.05) bad.push(`${name}: 행${r + 1} 높이 ${g.rowHeights[r]} vs ${theirH}`)
    cmpRows++
  }
  // 열 폭
  for (let c = 0; c < g.cols; c++) {
    const theirW = (ws['!cols'] ?? [])[c]?.width
    if (theirW === undefined) continue
    if (Math.abs(theirW - g.colWidths[c]) > 0.02) bad.push(`${name}: 열${c + 1} 폭 ${g.colWidths[c]} vs ${theirW}`)
    cmpCols++
  }
  // 글자
  for (const cell of g.cells) {
    const their = ws[cell.ref]
    const theirText = their?.v === undefined || their?.v === null ? '' : String(their.v)
    if (theirText !== cell.text) bad.push(`${name}!${cell.ref}: '${cell.text}' vs '${theirText}'`)
    cmpCells++
  }
}
check('비교가 실제로 돌았다(0건이면 공허)', cmpCells > 0 && cmpMerges > 0 && cmpRows > 0 && cmpCols > 0,
  `셀 ${cmpCells} · 병합 ${cmpMerges} · 행 ${cmpRows} · 열 ${cmpCols}`)
check('두 파서의 답이 전건 일치', bad.length === 0, bad.slice(0, 6).join(' / '))

/* ══════════════════════ [2] 라이터 ↔ 리더 왕복 항등 ══════════════════════
 *  ⭐ SheetJS가 **모르는 축**(테두리·채움·정렬)은 여기서만 증명된다. */
console.log('\n[2] 라이터 ↔ 리더 왕복 항등 — buildXlsx로 쓴 것을 되읽으면 그대로인가')
const S = (o: Partial<CellStyle>): CellStyle =>
  ({ left: 'none', right: 'none', top: 'none', bottom: 'none', fill: null, align: 'center', ...o })
const fixture: BuildSheet = {
  name: '왕복시험',
  colWidths: [8.5, 12.25, 3],
  rowHeights: [18.5, 33, 0],
  merges: ['A1:B1', 'A3:C3'],
  cells: [
    { row: 0, col: 0, text: '가나다 <&> "따옴표"', style: S({ left: 'thin', right: 'medium', top: 'thick', bottom: 'double', align: 'left' }) },
    // B1 — A1:B1에 **덮이는** 칸. 이게 없으면 covered 단언이 돌 양성 표본이 아예 없다
    { row: 0, col: 1, text: '', style: S({ top: 'thick' }) },
    { row: 0, col: 2, text: '', style: S({ fill: '#4C4C4C' }) },
    { row: 1, col: 0, text: '줄1\n줄2', style: S({ align: 'right', bottom: 'dashed' }) },
    { row: 1, col: 1, text: '☐ 상자', style: S({ fill: '#E0E5FA', left: 'thin', right: 'thin' }) },
    { row: 2, col: 0, text: '병합 셋', style: S({ top: 'thin' }) },
  ],
}
const built = await buildXlsx([fixture])
const rtZip = await JSZip.loadAsync(built.bytes)
const rt = await readSheetGrid(rtZip, '왕복시험')

check('병합이 그대로', rt.merges.join(',') === fixture.merges.join(','), rt.merges.join(','))
check('열 폭이 그대로', rt.colWidths.slice(0, 3).join(',') === '8.5,12.25,3', rt.colWidths.slice(0, 3).join(','))
check('행 높이가 그대로(미지정은 0)', rt.rowHeights.slice(0, 3).join(',') === '18.5,33,0', rt.rowHeights.slice(0, 3).join(','))
let rtBad: string[] = []
for (const want of fixture.cells) {
  const got = rt.cells.find(c => c.row === want.row && c.col === want.col)
  if (!got) { rtBad.push(`${want.row},${want.col} 없음`); continue }
  if (got.text !== want.text) rtBad.push(`${got.ref} 글자 '${got.text}' ≠ '${want.text}'`)
  for (const k of ['left', 'right', 'top', 'bottom', 'fill', 'align'] as const) {
    if (got.style[k] !== want.style[k]) rtBad.push(`${got.ref}.${k} ${String(got.style[k])} ≠ ${String(want.style[k])}`)
  }
}
check('셀 글자·테두리·채움·정렬이 그대로', rtBad.length === 0, rtBad.slice(0, 6).join(' / '))
check('병합 좌상단만 span을 갖는다', rt.cells.find(c => c.ref === 'A1')?.span?.cols === 2
  && rt.cells.find(c => c.ref === 'C1')?.span === null)
// 🚨 **양성·음성 짝으로** 묻는다. 처음엔 좌상단 A3의 `covered===false`만 물었는데, 그건
//    `covered`를 아예 안 세워도 통과한다(변이 M6이 그렇게 뚫었다). 덮인 칸이 실제로 서는지가 양성이다.
check('병합에 덮인 칸은 covered=true (양성)', rt.cells.find(c => c.ref === 'B1')?.covered === true,
  `B1.covered=${rt.cells.find(c => c.ref === 'B1')?.covered}`)
check('병합 좌상단은 covered=false (음성)', rt.cells.find(c => c.ref === 'A1')?.covered === false)
check('병합 밖 칸은 covered=false (음성)', rt.cells.find(c => c.ref === 'C1')?.covered === false)

/* ══════════════════════ [3] 템플릿 캐시 — 공유 바이트가 오염되지 않는가 ══════════════════════
 *  🚨 이게 캐시 도입의 **유일한 진짜 위험**이다. `injectWorkbook`이 원본을 안 건드린다고
 *    주석에 적혀 있지만(`xlsx-inject.ts:210`), **주석은 증거가 아니다**. 해시로 묻는다. */
console.log('\n[3] 공유 템플릿 바이트가 주입 뒤에도 그대로인가')
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const before = sha(bytes)
const injected = await injectWorkbook(bytes, [
  { sheet: SHEETS[2], cell: 'L4', value: '__오염시험__' },
])
check('주입이 실제로 돌았다', injected.missed.length === 0 && injected.bytes.byteLength > 0,
  `미착지 ${injected.missed.length}`)
check('원본 바이트 불변(캐시 공유 안전)', sha(bytes) === before)
check('산출물은 원본과 다르다(주입이 헛돌지 않았다)', sha(injected.bytes) !== before)

/* ══════════════════════ [4] 좌표 유틸 ══════════════════════ */
console.log('\n[4] 좌표 유틸')
check("colIndex('A')=0", colIndex('A') === 0)
check("colIndex('Z')=25", colIndex('Z') === 25)
check("colIndex('AA')=26", colIndex('AA') === 26)
check("colIndex('BH')=59 (60열 격자의 마지막)", colIndex('BH') === 59)
check("parseRef('AB12')", JSON.stringify(parseRef('AB12')) === JSON.stringify({ row: 11, col: 27 }))
let threw = false
try { parseRef('12AB') } catch { threw = true }
check('망가진 참조는 throw(조용한 0 반환 금지)', threw)

/* ══════════════════════ [5] 실제 서식에서 테두리를 정말로 읽는가 ══════════════════════
 *  🚨 [1]은 SheetJS가 모르는 축을 못 본다. 「테두리를 전부 none으로 읽어도」 [1]은 초록이다.
 *    그러니 실제 자산에서 테두리·채움이 **실제로 잡히는지**를 따로 센다. */
console.log('\n[5] 실제 자산에서 테두리·채움이 잡히는가')
const g11 = await readSheetGrid(zip, '1.1 건축물 일반현황')
const bordered = g11.cells.filter(c =>
  c.style.left !== 'none' || c.style.right !== 'none' || c.style.top !== 'none' || c.style.bottom !== 'none')
const filled = g11.cells.filter(c => c.style.fill)
const aligns = new Set(g11.cells.map(c => c.style.align))
check('1.1에 테두리 있는 칸이 있다', bordered.length > 0, `${bordered.length}칸 / 전체 ${g11.cells.length}`)
check('1.1에 채움 있는 칸이 있다', filled.length > 0, `${filled.length}칸`)
check('정렬이 한 값으로 뭉개지지 않았다', aligns.size > 1, [...aligns].join(','))
check('1.1 격자가 60열이다', g11.cols === 60, `${g11.cols}열`)

/* ══════════════════════ [6] 값 착지 — 리더로 **되읽어** 확인한다 ══════════════════════
 *  앵커를 세우고 값을 채워도 「착지」는 별개 사실이다. 라우트와 같은 경로로 워크북을 만들고
 *  이 리더로 되읽는다 — 리더를 만든 보람이 여기 있다(종전엔 엑셀을 내려받아 눈으로 봐야 했다).
 *
 *  표본은 **1.10.4 화재·비화재보 이력**이다(2026-09-16 배선, 소방계획서_50 §7 우선순위 ①).
 *  🚨 빈 행이 **빈 채로 남는가**를 함께 묻는다 — PDF는 표 모양을 만들려고 빈 행을 `pad`하지만
 *    엑셀은 그러면 안 된다(없는 사실을 지어내는 것이다). 양성만 보면 그 차이를 못 잡는다. */
console.log('\n[6] 값 착지 — 되읽어 확인 (1.10.4 화재·비화재보 이력)')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, FIREHIST_SHEET, FIREHIST_ROWS } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')
  type Gen = Parameters<typeof buildFirePlanValues>[0]

  const fx = {
    buildingName: '가상건물', facilities: [], brigade: [], zones: [],
    forms: {
      fireHistory: [
        { kind: '화재', at: '2025-03-01', place: '지하1층 전기실', cause: '누전', action: '차단기 교체' },
        { kind: '비화재보', at: '2025-07-14', place: '3층 복도', cause: '오동작', action: '감지기 교체' },
      ],
    },
  } as unknown as Gen

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  check('앵커 검증 통과', vc.ok, vc.ok ? `${vc.anchors.length}개` : vc.failures.slice(0, 3).join(' / '))
  if (vc.ok) {
    const { targets, unmapped } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    check('미매핑 0칸(값 맵이 앵커를 전부 덮는다)', unmapped.length === 0, `${unmapped.length}칸`)
    const out = await injectWorkbook(bytes, targets)
    check('미착지 0칸', out.missed.length === 0, `${out.missed.length}칸`)
    const gg = await readSheetGrid(await JSZip.loadAsync(out.bytes), FIREHIST_SHEET)
    const at = (ref: string) => gg.cells.find(c => c.ref === ref)?.text ?? '(없음)'
    check('반복행 예산이 파생된다(손으로 적은 15가 아니다)', FIREHIST_ROWS === 15, `${FIREHIST_ROWS}행`)
    // 양성 — 두 행이 다섯 칸 모두 제자리에
    check('1행 착지', at('A3') === '화재' && at('I3') === '2025-03-01' && at('Q3') === '지하1층 전기실'
      && at('Z3') === '누전' && at('AM3') === '차단기 교체',
      `A3=${at('A3')} I3=${at('I3')} Q3=${at('Q3')}`)
    check('2행 착지', at('A4') === '비화재보' && at('AM4') === '감지기 교체', `A4=${at('A4')}`)
    // 🚨 음성 — 데이터가 없는 행은 **빈 채로** 남아야 한다
    check('3행은 빈칸 유지(없는 사실을 지어내지 않는다)',
      at('A5') === '' && at('I5') === '' && at('AM5') === '', `A5=${JSON.stringify(at('A5'))}`)
    // 🚨 음성 — 머리글은 그대로여야 한다(값이 라벨을 덮으면 법정 자구가 사라진다).
    //   ⚠ 기대 문구를 **여기 베껴 적지 않는다**. 처음엔 `'구분 (화재/비화재보)'`라 적었다가
    //     빨개졌다 — 실제 원문은 `구분\n(화재/비화재보)`로 개행이 들어 있고, 내가 본 건
    //     프로브가 `\s+`를 공백으로 **정규화한 출력**이었다. manifest에게 묻는다(사본 금지).
    const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')
    check('머리글이 살아 있다', at('A2') === labelAt(FIREHIST_SHEET, 'A2'),
      JSON.stringify(at('A2')))
  }
}

/* ══════════════════════ [7] 1.2.2 화재취약장소 — 고정 3개소 매칭 ══════════════════════
 *  🚨 이 표는 반복 행이 **아니다**. 양식이 보일러실·주방·전기실을 인쇄해 두었고 우리는
 *    위치 칸과 상자만 채운다. 그래서 물어야 할 것이 셋이다 —
 *    ① 맞물린 장소가 채워지는가(양성) ② **안 고른 요소는 미체크로 남는가**(음성)
 *    ③ **장소 이름(법정 자구)이 보존되는가**. ①만 보면 「전부 체크하는 구현」이 통과한다. */
console.log('\n[7] 1.2.2 화재취약장소 — 고정 3개소 매칭')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, HAZARD_SHEET } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, hazardUnmatched } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const fx = {
    buildingName: 'X', facilities: [], brigade: [], zones: [],
    hazards: [
      { place: '보일러실', location: '지하1층', factors: ['기계적 요인', '가스누출(폭발)'] },
      { place: '전기실', location: '1층 EPS', factors: ['전기적 요인'] },
      // 🚨 양식에 자리가 없는 장소 — 버리되 **세어서** 고지에 실려야 한다
      { place: '창고', location: '옥탑', factors: ['부주의'] },
    ],
    forms: {},
  } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const gg = await readSheetGrid(await JSZip.loadAsync(out.bytes), HAZARD_SHEET)
    const at = (r: string) => gg.cells.find(x => x.ref === r)?.text ?? ''
    // 양성 — 맞물린 두 곳
    check('보일러실 위치 착지', at('N4') === '지하1층', at('N4'))
    check('전기실 위치 착지', at('N12') === '1층 EPS', at('N12'))
    check('보일러실 기계·가스 체크', at('AB5').startsWith('■') && at('AB7').startsWith('■'),
      `AB5=${at('AB5')} AB7=${at('AB7')}`)
    // 🚨 음성 — 안 고른 요소는 **미체크로 남아야** 한다(전부 켜는 구현을 잡는다)
    check('보일러실 전기는 미체크', !at('AB4').startsWith('■'), at('AB4'))
    check('주방은 통째로 빈칸·미체크(입력 없음)',
      at('N8') === '' && !at('AB8').startsWith('■') && !at('AO9').startsWith('■'),
      `N8=${JSON.stringify(at('N8'))} AB8=${at('AB8')}`)
    // 🚨 법정 자구 — 장소 이름을 덮어쓰면 서식이 훼손된다. manifest에 묻는다(베끼지 않는다).
    check('장소 이름이 보존된다', at('A4') === labelAt(HAZARD_SHEET, 'A4'), JSON.stringify(at('A4')))
    // 자리 없는 장소는 **이름으로** 잡힌다(조용한 절단 금지)
    check('자리 없는 장소를 이름으로 센다', hazardUnmatched(fx).join(',') === '창고',
      hazardUnmatched(fx).join(','))
  }
}

/* ══════════════════════ [8] 1.10.3 다중이용업소 — 해당/해당없음 두 갈래 ══════════════════════
 *  🚨 **음성이 핵심이다.** 다중이용업소가 아닌 대상물에 사업장명·영업시간이 인쇄되면 없는 사실을
 *    지어내는 것이다. 그리고 시간 자리표시(`00시~00시`)는 값이 없을 때 **남아야** 한다 —
 *    지우면 그 칸이 무엇을 적는 자리인지 알 수 없게 된다. */
console.log('\n[8] 1.10.3 다중이용업소 — 해당 / 해당없음')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, MU_SHEET } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const base = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [] }
  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  const render = async (mu: unknown) => {
    const { targets } = toInjectTargets(
      buildFirePlanValues({ ...base, forms: { multiUse: mu } } as never),
      (vc as { anchors: Parameters<typeof toInjectTargets>[1] }).anchors)
    const out = await injectWorkbook(bytes, targets)
    const gg = await readSheetGrid(await JSZip.loadAsync(out.bytes), MU_SHEET)
    return (r: string) => gg.cells.find(x => x.ref === r)?.text ?? ''
  }
  if (vc.ok) {
    // ── 해당 O ──
    const on = await render({
      applicable: true, bizName: '행복노래연습장', categories: { 노래연습장: '2' },
      location: '지하1층', owner: '홍길동', phone: '031-000-0000', capacity: '50',
      hoursDetail: { wkDay: '09:00~18:00', wkNight: '', holDay: '', holNight: '22:00~02:00' },
      userTypes: ['청소년'],
    })
    check('사업장명 착지', on('N3') === '행복노래연습장', on('N3'))
    // 업종은 `업종(개소)` — PDF `muCats`와 **같은 조립**이다
    check('업종이 개소와 함께 조립된다', on('AS3') === '노래연습장(2)', on('AS3'))
    check('수용인원은 단위칸(명)', on('AS8') === `50${labelAt(MU_SHEET, 'AS8')}`, on('AS8'))
    check('평일·평일주간 상자가 켜지고 시간이 들어간다',
      on('N6').startsWith('■') && on('V6').startsWith('■') && on('AD6') === '09:00~18:00',
      `N6=${on('N6')} AD6=${on('AD6')}`)
    // 🚨 자리표시 — 값이 없는 야간은 상자가 꺼지고 **`00시~00시`가 남아야** 한다
    check('값 없는 시간칸은 자리표시를 남긴다',
      !on('V7').startsWith('■') && on('AD7') === labelAt(MU_SHEET, 'AD7'),
      `V7=${on('V7')} AD7=${JSON.stringify(on('AD7'))}`)
    check('휴일 야간만 켜진다(주간은 꺼짐)',
      on('AS7').startsWith('■') && on('BA7') === '22:00~02:00' && !on('AS6').startsWith('■'),
      `AS7=${on('AS7')} AS6=${on('AS6')}`)
    check('이용자 — 고른 것만 체크(양성·음성)',
      on('N9').startsWith('■') && !on('N8').startsWith('■'), `N9=${on('N9')} N8=${on('N8')}`)

    // ── 해당 X — 🚨 없는 사실을 지어내지 않는다 ──
    const off = await render({
      applicable: false, categories: {}, bizName: '', location: '', owner: '', phone: '',
      hours: '', users: '', capacity: '',
    })
    check('해당없음이면 값칸이 전부 빈다',
      off('N3') === '' && off('N4') === '' && off('N5') === '' && off('AS3') === '',
      `N3=${JSON.stringify(off('N3'))}`)
    check('해당없음이면 상자가 전부 꺼진다',
      !off('N6').startsWith('■') && !off('AK6').startsWith('■') && !off('N9').startsWith('■'))
    check('해당없음이어도 자리표시·단위는 남는다',
      off('AD6') === labelAt(MU_SHEET, 'AD6') && off('AS8') === labelAt(MU_SHEET, 'AS8'),
      `AD6=${JSON.stringify(off('AD6'))} AS8=${JSON.stringify(off('AS8'))}`)
  }
}

/* ══════════════════════ [9] 1.11.1 연간계획 — 교육/훈련 블록이 안 섞이는가 ══════════════════════
 *  🚨 **교차 오염이 이 시트의 유일한 진짜 위험이다.** 교육 3행은 `eduMonths`, 훈련 3행은
 *    `drillMonths`를 쓰는데, 한쪽 배열을 양쪽에 찍는 구현도 **월이 같으면 초록**이 된다.
 *    그래서 픽스처가 두 배열을 **일부러 다르게** 준다(교육 3·9월 / 훈련 5월). */
console.log('\n[9] 1.11.1 연간계획 — 교육 / 훈련')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, TRAIN_SHEET, TRAIN_MONTH_COLS } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')

  const fx = {
    buildingName: 'X', facilities: [], zones: [], hazards: [],
    brigade: [{ team: '자위소방대장', name: 'A' }, { team: '부대장', name: 'B' }],
    ops: { headcountWorker: '12', headcountResident: '40' },
    forms: { training: { eduMonths: [3, 9], drillMonths: [5] } },
  } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const gg = await readSheetGrid(await JSZip.loadAsync(out.bytes), TRAIN_SHEET)
    const at = (r: string) => gg.cells.find(x => x.ref === r)?.text ?? ''
    const onMonths = (row: number) =>
      TRAIN_MONTH_COLS.map((c, i) => (at(`${c}${row}`).includes('■') ? i + 1 : 0)).filter(Boolean).join(',')

    // 양성 — 교육 3행이 전부 교육 월
    for (const r of [9, 10, 11]) check(`교육 r${r} = 3,9월`, onMonths(r) === '3,9', onMonths(r))
    // 🚨 음성 — 훈련 3행에 교육 월이 섞이면 안 된다(한 배열을 양쪽에 찍는 구현을 잡는다)
    for (const r of [15, 16, 17]) check(`훈련 r${r} = 5월만`, onMonths(r) === '5', onMonths(r))
    // 대상자 — 상자와 인원이 짝지어 켜진다
    check('근무자 상자+인원', at('I4').startsWith('■') && at('AA4') === '12명', `${at('I4')} / ${at('AA4')}`)
    // 🚨 거주자 칸만 자구가 값을 **감싼다** — `unitCell`을 쓰면 `40약  명`이 된다
    check('거주자는 감싼단위칸(약 N 명)', at('BB4') === '약 40 명', JSON.stringify(at('BB4')))
    check('자위소방대 인원 = 편성표 행 수', at('I5').startsWith('■') && at('AA5').startsWith('2'),
      `${at('I5')} / ${at('AA5')}`)
  }
}

/* ══════════════════════ [10] 3.1 피난시설 — 1.1·1.5와 **같은 사실**을 찍는가 ══════════════════════
 *  🚨 이 시트의 값은 전부 다른 시트에도 있다(계단=1.1, 승강기=1.1, 기타시설=1.5).
 *    **두 시트가 같은 사실을 다르게 찍으면 그게 D-7 갈라짐**이다 — 그래서 원천이 아니라
 *    **결과를 맞대어** 본다. 그리고 근거 없는 상자는 **안 켜져야** 한다(음성).
 *  🚨 픽스처는 켜짐과 꺼짐을 **둘 다** 담는다 — 전부 켜면 「늘 켜는 구현」이, 전부 비우면
 *    「늘 끄는 구현」이 초록으로 통과한다. */
console.log('\n[10] 3.1 피난시설 — 1.1·1.5와 같은 사실')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, EVAC1_SHEET, EVAC1_ELEVATOR_CELL, FP_SHEET } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')

  const fx = {
    buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    stairCounts: { direct: '2', special: '', escape: '', outdoor: '1' },
    elevators: { passenger: '2', emergency: '', evac: '1' },
    forms: { evacFire: { etc: ['대피공간', '옥상광장'] } },
  } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const zz = await JSZip.loadAsync(out.bytes)
    const g31 = await readSheetGrid(zz, EVAC1_SHEET)
    const g11 = await readSheetGrid(zz, FP_SHEET.F1_1)
    const a31 = (r: string) => g31.cells.find(x => x.ref === r)?.text ?? ''
    const a11 = (r: string) => g11.cells.find(x => x.ref === r)?.text ?? ''

    check('3.1 계단: 직통·옥외만 켜진다',
      a31('Q8').includes('■') && a31('AM9').includes('■')
      && !a31('AM8').includes('■') && !a31('Q9').includes('■'),
      `Q8=${a31('Q8')} AM8=${a31('AM8')}`)
    // 🚨 **1.1과 같은 사실인가** — 두 시트가 갈라지면 여기서 잡힌다
    check('3.1 계단 == 1.1 계단(직통)', a31('Q8').includes('■') === a11('AJ15').includes('■'),
      `3.1 Q8=${a31('Q8')} / 1.1 AJ15=${a11('AJ15')}`)
    const ev = a31(EVAC1_ELEVATOR_CELL)
    const marks = [...ev.matchAll(/[■□☐]/g)].map(m => m[0])
    check('3.1 승강기 한 칸에 상자 셋(승용■ 비상용☐ 피난용■)',
      marks.length === 3 && marks[0] === '■' && marks[1] !== '■' && marks[2] === '■', ev)
    check('3.1 승강기 == 1.1 승강기(비상용 꺼짐)',
      (marks[1] === '■') === a11('AB12').includes('■'), `3.1=${marks[1]} / 1.1 AB12=${a11('AB12')}`)
    check('3.1 기타시설: 대피공간만(옥상광장은 양식에 칸이 없다)',
      a31('Q10').includes('■') && !a31('AM10').includes('■') && !a31('AM11').includes('■'),
      `Q10=${a31('Q10')} AM10=${a31('AM10')}`)
    // 🚨 음성 — 근거 없는 상자는 **안 켜진다**
    check('근거 없는 상자는 안 켜진다(피난기구·인명구조기구·유도등)',
      !a31('Q13').includes('■') && !a31('Q16').includes('■') && !a31('Q19').includes('■'),
      `Q13=${a31('Q13')} Q16=${a31('Q16')} Q19=${a31('Q19')}`)
  }
}

/* ══════════════════════ [11] 2.1 자위소방대 일반현황 ══════════════════════
 *  🚨 **팀 어간 매칭이 이 시트의 핵심 위험이다.** 편성표 대원의 팀 문자열이 화면 두 곳에서
 *    다르다(`비상연락` vs `비상연락반`). 픽스처가 **두 표기를 섞어** 준다 — 한쪽만 받는
 *    구현이면 절반이 꺼진다.
 *  🚨 그리고 **구간 판정**은 경계가 위험하다. 근무인원 50명은 「50명 미만」이 아니라
 *    「50~100」이다(하한 이상·상한 미만). 미입력(0)은 **어느 구간도 켜지 않는다**. */
console.log('\n[11] 2.1 자위소방대 일반현황')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, BRIG1_SHEET } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  const render = async (over: Record<string, unknown>) => {
    const { targets } = toInjectTargets(buildFirePlanValues({
      buildingName: '가상건물', address: '경기 어딘가 1', facilities: [], zones: [], hazards: [],
      grade: '2급', brigade: [], forms: {}, ...over,
    } as never), (vc as { anchors: Parameters<typeof toInjectTargets>[1] }).anchors)
    const out = await injectWorkbook(bytes, targets)
    const gg = await readSheetGrid(await JSZip.loadAsync(out.bytes), BRIG1_SHEET)
    return (r: string) => gg.cells.find(x => x.ref === r)?.text ?? ''
  }
  if (vc.ok) {
    const at = await render({
      ops: { headcountWorker: '50' },                 // 경계값 — 「50~100」이어야 한다
      forms: { brigadeGeneral: { type: 'Type-Ⅲ' } },
      brigade: [
        { team: '자위소방대장', name: 'A' },
        { team: '비상연락', name: 'B' },              // 목록 ①의 표기
        { team: '초기소화반', name: 'C' },            // 목록 ②의 표기(꼬리가 다르다)
      ],
    })
    check('명칭·주소 착지', at('M5') === '가상건물' && at('M6') === '경기 어딘가 1', `${at('M5')} / ${at('M6')}`)
    check('등급 2급만 켜진다(양성·음성)',
      at('AK7').includes('■') && !at('M7').includes('■') && !at('Y7').includes('■'),
      `AK7=${at('AK7')} M7=${at('M7')}`)
    // 🚨 경계 — 50은 「50명 미만」이 아니다
    check('근무인원 50명 → 「50~100」 구간',
      at('AA8').includes('■') && !at('M8').includes('■'), `M8=${at('M8')} AA8=${at('AA8')}`)
    check('Type-Ⅲ만 켜진다', at('M12').includes('■') && !at('M11').includes('■'),
      `M11=${at('M11')} M12=${at('M12')}`)
    check('총원 = 편성표 행 수', at('V13').startsWith('3'), at('V13'))
    // ⭐ 어간 매칭 — 두 표기를 다 받는가
    check('팀 상자: 비상연락(꼬리 없음) 켜짐', at('AB15').includes('■'), at('AB15'))
    check('팀 상자: 초기소화반(꼬리 다름) 켜짐', at('AB16').includes('■'), at('AB16'))
    check('팀 상자: 없는 팀은 꺼짐(피난유도)', !at('AB17').includes('■'), at('AB17'))
    check('임무 블록도 같은 판정', at('M23').includes('■') && at('M24').includes('■')
      && !at('M25').includes('■'), `M23=${at('M23')} M25=${at('M25')}`)

    // 🚨 음성 — 미입력이면 어느 구간도 켜지 않는다(0명은 「50명 미만」이 아니다)
    const off = await render({ ops: {}, brigade: [] })
    check('근무인원 미입력 → 구간 전부 꺼짐',
      !off('M8').includes('■') && !off('AA8').includes('■') && !off('AN8').includes('■')
      && !off('AX8').includes('■'), `M8=${off('M8')}`)
    check('편성표가 비면 팀 상자도 전부 꺼짐',
      !off('AB15').includes('■') && !off('AB16').includes('■'), `AB15=${off('AB15')}`)
  }
}

/* ══════════════════════ [12] 1.12.1 화기취급작업 — 4열만 배선 ══════════════════════
 *  🚨 **안 채운 칸이 비어 있는지**가 이 시트의 핵심 음성이다. 양식의 `연락처`는 ERP에 축이
 *    없고 ERP의 `measure`(안전조치)는 양식에 칸이 없다 — 그걸 연락처 칸에 넣으면
 *    **머리글이 거짓말을 한다**. 픽스처가 `measure`를 담아 그 유혹을 실제로 시험한다. */
console.log('\n[12] 1.12.1 화기취급작업 — 4열만')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, FIREWORK_SHEET, FIREWORK_ROWS } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, fireworkRowOverflow } = await import('../src/lib/fire-plan-xlsx-values.ts')

  const rows = Array.from({ length: FIREWORK_ROWS + 2 }, (_, i) => ({
    date: `2026-03-0${(i % 9) + 1}`, place: `장소${i}`, work: `작업${i}`,
    supervisor: `책임자${i}`, measure: `안전조치${i}`,   // ← 양식에 칸이 없는 열
  }))
  const fx = {
    buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: { fireworkLog: rows },
  } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const gg = await readSheetGrid(await JSZip.loadAsync(out.bytes), FIREWORK_SHEET)
    const at = (r: string) => gg.cells.find(x => x.ref === r)?.text ?? ''
    check('반복행 예산이 파생된다(13행)', FIREWORK_ROWS === 13, `${FIREWORK_ROWS}행`)
    check('1행 4열 착지', at('A5') === '2026-03-01' && at('T5') === '장소0'
      && at('AE5') === '작업0' && at('AO5') === '책임자0', `A5=${at('A5')} AO5=${at('AO5')}`)
    check('마지막 행(17)도 착지', at('A17') === rows[12].date, at('A17'))
    // 🚨 음성 — 연락처 칸은 **비어야** 한다(안전조치를 몰래 넣지 않았는가)
    check('연락처 칸은 비어 있다(안전조치를 넣지 않았다)',
      at('AY5') === '' && at('AY17') === '', `AY5=${JSON.stringify(at('AY5'))}`)
    // 🚨 음성 — 머리글은 살아 있다
    check('머리글이 살아 있다', at('AY4').includes('연락처'), at('AY4'))
    // 넘친 2건은 **세어서** 고지로 나간다
    check('넘친 행을 센다(잘렸다는 사실을 드러낸다)', fireworkRowOverflow(fx) === 2,
      `${fireworkRowOverflow(fx)}건`)
  }
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
