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

/* ══════════════════════ [13] 1.13 공사·정비 — 5열 중 3열만 ══════════════════════
 *  🚨 1.12.1보다 어긋남이 크다. 열 수만 5:5이고 **뜻은 3열만 겹친다** —
 *    `작업책임자`에 ERP `company`(시공업체)를 넣는 것, `확인일자`에 `date`를 넣는 것이
 *    이 시트의 두 유혹이다. 픽스처가 둘 다 담아 시험하고, **두 칸이 비어 있는지**를 묻는다.
 *  ⚠ 버린 축(`facility`·`company`)을 **세는지**도 함께 단언한다 — 이 시트는 PDF가 인쇄하는
 *    사실을 엑셀이 못 싣는 첫 사례라, 안 세면 사용자가 엑셀을 손으로 고치러 간다. */
console.log('\n[13] 1.13 공사·정비 — 3열만')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, CONSTRUCTION_SHEET, CONSTRUCTION_ROWS } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, constructionRowOverflow, constructionUnmapped } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const rows = Array.from({ length: CONSTRUCTION_ROWS + 3 }, (_, i) => ({
    date: `2026-05-0${(i % 9) + 1}`, facility: `설비${i}`, content: `내용${i}`,
    company: `업체${i}`, note: `비고${i}`,            // ← facility·company는 양식에 칸이 없다
  }))
  const fx = {
    buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: { constructionLog: rows },
  } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const gg = await readSheetGrid(await JSZip.loadAsync(out.bytes), CONSTRUCTION_SHEET)
    const at = (r: string) => gg.cells.find(x => x.ref === r)?.text ?? ''
    /* 🚨 손으로 14행이라 짐작했다가 파생에 틀렸다 — A14「관련서류 보관방법」이 표를 끊는다.
     *   행 수를 적어 두지 않고 라벨에서 유도하기 때문에 **양식이 스스로 답했다**. */
    check('반복행 예산이 파생된다(11행 — A14 라벨에서 끊긴다)', CONSTRUCTION_ROWS === 11,
      `${CONSTRUCTION_ROWS}행`)
    check('첫 행 3열 착지', at('A3') === '내용0' && at('O3') === '2026-05-01' && at('AP3') === '비고0',
      `A3=${at('A3')} O3=${at('O3')} AP3=${at('AP3')}`)
    check('마지막 행(13)도 착지', at('A13') === rows[10].content, at('A13'))
    /* 🚨 음성 — 표를 넘어 「관련서류 보관방법」 블록을 침범하지 않았다 */
    check('표 밖(A14) 라벨이 온전하다', at('A14') === labelAt(CONSTRUCTION_SHEET, 'A14'), at('A14'))
    /* 🚨 음성 둘 — 업체를 사람 칸에, 일자를 확인칸에 몰래 넣지 않았는가 */
    check('작업책임자 칸은 비어 있다(시공업체를 넣지 않았다)',
      at('X3') === '' && at('X13') === '', `X3=${JSON.stringify(at('X3'))}`)
    check('확인일자 칸은 비어 있다(작업일자를 넣지 않았다)',
      at('AG3') === '' && at('AG13') === '', `AG3=${JSON.stringify(at('AG3'))}`)
    /* 🚨 머리글은 manifest에서 읽는다 — 법정 자구를 검사에 베끼지 않는다 */
    check('머리글 두 칸이 살아 있다',
      at('X2') === labelAt(CONSTRUCTION_SHEET, 'X2') && at('AG2') === labelAt(CONSTRUCTION_SHEET, 'AG2'),
      `${at('X2')}·${at('AG2')}`)
    check('넘친 행을 센다', constructionRowOverflow(fx) === 3, `${constructionRowOverflow(fx)}건`)
    /* 버린 축은 **담긴 14행 기준**으로 센다(넘친 3건을 두 번 세지 않는다) */
    const um = constructionUnmapped(fx)
    check('갈 칸 없는 두 축을 센다(넘침과 따로)', um.facility === 11 && um.company === 11,
      `설비 ${um.facility} · 업체 ${um.company}`)
  }
}

/* ══════════════════════ [14] 3.3 피난인원현황 — 1.2.1의 쌍둥이 ══════════════════════
 *  ⭐ 이 절의 **핵심 단언은 개수가 아니라 「두 시트가 같은가」**다. 같은 구역이 1.2.1과 3.3에
 *    다르게 인쇄되면 D-7 갈라짐이고, 그건 「값이 들어갔다」를 아무리 세어도 안 잡힌다.
 *    그래서 **두 시트를 되읽어 칸 대 칸으로 맞댄다**(1.2.1 예산 8행까지).
 *  ⚠ 9번째 구역부터는 3.3에만 실린다 — 갈라짐이 아니라 양식의 용량 차이(8행 vs 19행)다.
 *    그 사실도 양성으로 단언한다(안 그러면 「덜 채워도 초록」이 된다). */
console.log('\n[14] 3.3 피난인원현황 — 1.2.1과 같은 값인가')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, EVAC3_SHEET, EVAC3_ROWS, EVAC3_COLS, ZONE_SHEET, ZONE_ROWS, ZONE_FIRST_ROW, EVAC3_FIRST_ROW } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, evac3RowOverflow } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  /* 1.2.1(8행)·3.3(19행) 둘 다 넘기는 21개 구역 */
  const zones = Array.from({ length: EVAC3_ROWS + 2 }, (_, i) => ({
    zone: `${i + 1}층`, name: i === 0 ? '제1종근린생활시설' : `용도${i}`, area: `${100 + i}`,
    weekday: `${i}/0`, holiday: `0/${i}`,          // ← 양식 3.3에 축이 없는 인원 두 칸
    managerCo: `업체${i}`, contact: `담당${i}`,
  }))
  const fx = { buildingName: 'X', facilities: [], brigade: [], zones, hazards: [], forms: {} } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const z2 = await JSZip.loadAsync(out.bytes)
    const g33 = await readSheetGrid(z2, EVAC3_SHEET)
    const g121 = await readSheetGrid(z2, ZONE_SHEET)
    const at = (g: typeof g33, r: string) => g.cells.find(x => x.ref === r)?.text ?? ''

    check('반복행 예산이 파생된다(19행 — A26 주석에서 끊긴다)', EVAC3_ROWS === 19, `${EVAC3_ROWS}행`)
    check('1.2.1은 8행뿐이다(예산이 다르다는 전제)', ZONE_ROWS === 8, `${ZONE_ROWS}행`)

    /* 🎯 핵심 — 두 시트가 **같은 값**을 찍는가(1.2.1이 담는 8행 전부, 5열 전부 = 40칸) */
    const ZCOL: Record<string, string> = { floor: 'D', usage: 'H', area: 'O', company: 'AL', contact: 'AR' }
    const diff: string[] = []
    let cmp = 0
    for (let i = 0; i < ZONE_ROWS; i++) {
      for (const [col, key] of EVAC3_COLS) {
        const a = at(g121, `${ZCOL[key]}${ZONE_FIRST_ROW + i}`)
        const b = at(g33, `${col}${EVAC3_FIRST_ROW + i}`)
        if (a !== b) diff.push(`${i}행 ${key}: '${a}' ≠ '${b}'`)
        cmp++
      }
    }
    check('대조가 실제로 돌았다(0건이면 공허)', cmp === 40, `${cmp}칸`)
    check('1.2.1 ↔ 3.3 전 칸 일치 (D-7 항등)', diff.length === 0, diff.slice(0, 4).join(' / '))
    /* 값이 비어 있어도 위 단언은 초록이다 — 실제로 채워졌는지를 따로 묻는다 */
    /* `근생`은 `purposeShort`가 「제1종근린생활시설」을 줄인 표기다 — 1.1 주용도와 같은 어휘.
     * 원값이 아니라 **변환된 값**이 들어갔는지까지 묻는다(두 시트가 같은 변환을 탔다는 증거). */
    check('빈 채로 일치한 게 아니다', at(g33, 'E7') === '1층' && at(g33, 'I7') === '근생'
      && at(g33, 'AO7') === '업체0', `E7=${at(g33, 'E7')} I7=${at(g33, 'I7')}`)

    /* ⭐ 용량 차이 — 9번째 구역은 3.3에만 있다(1.2.1은 8행에서 잘린다) */
    check('9번째 구역은 3.3에만 실린다', at(g33, 'E15') === '9층', `E15=${at(g33, 'E15')}`)
    check('마지막 행(25)도 착지', at(g33, 'E25') === '19층', at(g33, 'E25'))

    /* 🚨 음성 — 축이 다른 칸을 몰래 채우지 않았는가 */
    check('인원 3칸은 비어 있다(평일/휴일을 근무/거주로 둔갑시키지 않았다)',
      at(g33, 'AA7') === '' && at(g33, 'AE7') === '' && at(g33, 'AJ7') === '',
      `AA7=${JSON.stringify(at(g33, 'AA7'))} AE7=${JSON.stringify(at(g33, 'AE7'))}`)
    check('「동」 칸은 비어 있다(1.2.1 0열과 같은 사유)',
      at(g33, 'A7') === '' && at(g33, 'A25') === '', `A7=${JSON.stringify(at(g33, 'A7'))}`)
    check('인원 머리글은 살아 있다', at(g33, 'AA5') === labelAt(EVAC3_SHEET, 'AA5')
      && at(g33, 'A6') === labelAt(EVAC3_SHEET, 'A6'), `${at(g33, 'AA5')}·${at(g33, 'A6')}`)
    check('표 밖(A26) 주석이 온전하다', at(g33, 'A26') === labelAt(EVAC3_SHEET, 'A26'))

    check('넘친 구역을 센다(1.2.1과 따로)', evac3RowOverflow(fx) === 2, `${evac3RowOverflow(fx)}개`)
  }
}

/* ══════════════════════ [15] 1.9 자위소방대 현황 — 2.1·2.2의 요약본 ══════════════════════
 *  ⭐ 셋이 같은 `d.brigade`를 읽는다. 그래서 묻는 것은 **「같은 사람이 같게 뽑히는가」**다:
 *    대장·부대장은 2.2와 **같은 술어**, 편성인원은 2.1과 **같은 수**여야 한다.
 *  🚨 그리고 **알려진 불일치를 일부러 못 박는다** — 1.9는 구분이 넷이라 비상연락 대원을 제
 *    줄에 놓지만, 2.2는 구분이 둘뿐이라 같은 사람을 현장대응팀 줄에 인쇄한다. 숨기면 다음
 *    사람이 「통일한다」며 어느 한쪽을 조용히 되돌린다 — 보이게 두고 고정한다. */
console.log('\n[15] 1.9 자위소방대 현황 — 2.1·2.2와 같은 사람인가')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, BRIG9_SHEET, BRIG9_EMER_ROWS, BRIG9_FIELD_ROWS, BRIG9_FIELD_FIRST_ROW,
    BRIG1_SHEET, BRIG_SHEET, BRIG_FIRST_ROW } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const brigade = [
    { team: '자위소방대장', name: '김대장', duty: '총괄', phone: '01011112222' },
    { team: '부대장', name: '이부장', duty: '보좌', phone: '01033334444' },
    { team: '비상연락반', name: '박연락', duty: '신고', phone: '01055556666' },   // ← 꼬리가 '반'
    { team: '초기소화팀', name: '최소화', duty: '초기소화', phone: '01077778888' },
    { team: '피난유도', name: '정유도', duty: '피난유도', phone: '01099990000' },
  ]
  const fx = { buildingName: '가온빌딩', facilities: [], brigade, zones: [], hazards: [], forms: {} } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const z2 = await JSZip.loadAsync(out.bytes)
    const g9 = await readSheetGrid(z2, BRIG9_SHEET)
    const g21 = await readSheetGrid(z2, BRIG1_SHEET)
    const g22 = await readSheetGrid(z2, BRIG_SHEET)
    const at = (g: typeof g9, r: string) => g.cells.find(x => x.ref === r)?.text ?? ''

    check('비상연락 행을 라벨에서 찾았다(손으로 안 적었다)',
      BRIG9_EMER_ROWS.join(',') === '11,12', BRIG9_EMER_ROWS.join(','))
    check('현장대응 블록 행 수가 파생된다(6행)', BRIG9_FIELD_ROWS === 6, `${BRIG9_FIELD_ROWS}행`)

    /* 🎯 2.2와 **같은 사람**이 대장·부대장으로 뽑혔는가 */
    check('대장·부대장이 2.2와 같다', at(g9, 'T9') === at(g22, 'X5') && at(g9, 'T10') === at(g22, 'X6')
      && at(g9, 'T9') === '김대장', `1.9=${at(g9, 'T9')}/${at(g9, 'T10')} 2.2=${at(g22, 'X5')}/${at(g22, 'X6')}`)
    check('연락처도 같은 표기(formatTel 공유)', at(g9, 'AV9') === at(g22, 'AZ5') && at(g9, 'AV9').includes('-'),
      at(g9, 'AV9'))
    check('소속은 대원이 있을 때만(2.2와 같은 규약)',
      at(g9, 'K9') === '가온빌딩' && at(g9, `K${BRIG9_FIELD_FIRST_ROW + 5}`) === '', `K9=${at(g9, 'K9')}`)

    /* 🎯 2.1과 **같은 수** */
    check('편성인원이 2.1과 같다', at(g9, 'U3') === at(g21, 'V13') && at(g9, 'U3').startsWith('5'),
      `1.9=${at(g9, 'U3')} 2.1=${at(g21, 'V13')}`)
    check('운영 상자가 켜졌다', at(g9, 'K2').includes('■'), at(g9, 'K2'))

    /* ⭐ 꼬리가 '반'이어도 어간으로 맞는다 — 제 줄(11)에 놓였다 */
    check('비상연락반이 「비상연락」 줄에 놓인다', at(g9, 'T11') === '박연락', at(g9, 'T11'))
    check('나머지는 현장대응 줄로', at(g9, 'T13') === '최소화' && at(g9, 'T14') === '정유도',
      `T13=${at(g9, 'T13')} T14=${at(g9, 'T14')}`)
    check('팀 상자 셋이 켜졌다(어간 매칭)', at(g9, 'AA4').includes('■')
      && at(g9, 'AO4').includes('■') && at(g9, 'K5').includes('■'),
      `${at(g9, 'AA4')}·${at(g9, 'AO4')}·${at(g9, 'K5')}`)
    check('지휘통제 상자는 대장·부대장이 켠다', at(g9, 'K4').includes('■'), at(g9, 'K4'))
    check('없는 팀 상자는 꺼져 있다(응급구조·방호안전)',
      !at(g9, 'AA5').includes('■') && !at(g9, 'AO5').includes('■'), `${at(g9, 'AA5')}·${at(g9, 'AO5')}`)

    /* 🚨 **알려진 불일치를 고정한다** — 같은 박연락이 2.2에서는 현장대응팀 첫 줄에 있다.
     *   2.2의 지휘통제 여분 줄(F7·F8)은 구분 라벨이 **공백**이라 양식이 「여기가 비상연락
     *   자리」라고 말해 주지 않는다. 추측으로 옮기지 않고, 어긋남을 보이게 둔다. */
    check('⚠ 알려진 불일치: 같은 대원이 2.2에선 현장대응 줄에 있다',
      at(g22, `X${BRIG_FIRST_ROW}`) === '박연락' && at(g9, 'T13') !== '박연락',
      `2.2 X${BRIG_FIRST_ROW}=${at(g22, `X${BRIG_FIRST_ROW}`)}`)

    /* 🚨 음성 — 근거 없는 칸은 비어 있다 */
    check('「해당없음」 상자는 꺼져 있다(면제 여부를 ERP는 모른다)',
      !at(g9, 'Y2').includes('■'), at(g9, 'Y2'))
    check('근무형태 두 상자는 꺼져 있다(ERP에 축이 없다)',
      !at(g9, 'AK3').includes('■') && !at(g9, 'AR3').includes('■'), `${at(g9, 'AK3')}·${at(g9, 'AR3')}`)
    check('팀별 인원 칸은 비어 있다(2.1과 같은 결정)',
      at(g9, 'U4') === labelAt(BRIG9_SHEET, 'U4') && at(g9, 'AJ4') === labelAt(BRIG9_SHEET, 'AJ4'),
      `U4=${JSON.stringify(at(g9, 'U4'))}`)
    check('사무실 칸은 비어 있다(ERP 연락처는 하나뿐)',
      at(g9, 'AN9') === '' && at(g9, 'AN11') === '', `AN9=${JSON.stringify(at(g9, 'AN9'))}`)
    check('개별임무 법정 문구가 온전하다', at(g9, 'AA9') === labelAt(BRIG9_SHEET, 'AA9'), at(g9, 'AA9'))
    check('피난약자 블록은 안 건드렸다', at(g9, 'A21') === labelAt(BRIG9_SHEET, 'A21'), at(g9, 'A21'))
  }
}

/* ══════════════════════ [16] 2.14 앞쪽 — 각괄호 상자 + 세 시트 항등 ══════════════════════
 *  ⭐ 이 시트는 1.1 · 1.7.1 · 2.2의 사실을 **다시 인쇄한다**. 그래서 묻는 것은 또 항등이다 —
 *    등급·관리자 성명·연락처·선임일자·대장이 원본 시트와 **글자까지** 같은가.
 *  🚨 상자가 `□`가 아니라 `[  ]`고 표시가 `√`다. `boxLabelCell`을 쓰면 throw 하므로
 *    「그냥 되겠지」가 통하지 않는다 — 폭이 유지되는지(`[√ ]`)까지 단언한다. */
console.log('\n[16] 2.14 앞쪽 — 각괄호 상자 √ · 1.1·1.7.1·2.2와 항등')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, REC14_SHEET, REC14_GRADE_CELLS, FP_SHEET, BRIG_SHEET } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, bracketBoxCell } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const fx = {
    buildingName: '가온빌딩', address: '서울시 중구 1', grade: '2급',
    managerName: '홍관리', managerPhone: '010-2222-3333', managerSelectedAt: '2025-04-07',
    facilities: [], hazards: [], zones: [], forms: {},
    brigade: [{ team: '자위소방대장', name: '김대장', duty: '총괄', phone: '01011112222' }],
  } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const z2 = await JSZip.loadAsync(out.bytes)
    const g14 = await readSheetGrid(z2, REC14_SHEET)
    const g11 = await readSheetGrid(z2, FP_SHEET.F1_1)
    const g171 = await readSheetGrid(z2, FP_SHEET.F1_7_1)
    const g22 = await readSheetGrid(z2, BRIG_SHEET)
    const at = (g: typeof g14, r: string) => g.cells.find(x => x.ref === r)?.text ?? ''

    /* 🎯 각괄호 상자 — 맞는 급만 √, 폭은 유지 */
    check('2급 칸에만 √가 찍힌다', at(g14, 'AL11').includes('√')
      && !at(g14, 'R11').includes('√') && !at(g14, 'AB11').includes('√') && !at(g14, 'AV11').includes('√'),
      REC14_GRADE_CELLS.map(([c]) => at(g14, c)).join(' '))
    check('각괄호 폭이 유지된다(뒤 자구가 안 밀린다)',
      at(g14, 'AL11').length === labelAt(REC14_SHEET, 'AL11').length,
      `'${at(g14, 'AL11')}' (${at(g14, 'AL11').length}자)`)
    check('미체크 칸은 원본 그대로', at(g14, 'R11') === labelAt(REC14_SHEET, 'R11'), at(g14, 'R11'))
    /* 🚨 `□` 어휘를 섞지 않았다 — 이 양식은 `√`를 쓴다고 스스로 적어 두었다 */
    check('■를 쓰지 않았다(이 양식의 표시는 √)',
      !REC14_GRADE_CELLS.some(([c]) => at(g14, c).includes('■')))
    /* 각괄호가 없는 칸에 쓰면 반드시 터진다 — 「조용히 통과」가 불가능함을 증명 */
    let threw = false
    try { bracketBoxCell(REC14_SHEET, 'J12', true) } catch { threw = true }
    check('각괄호 없는 칸이면 throw', threw)

    /* 🎯 항등 — 같은 사실이 원본 시트와 글자까지 같은가 */
    check('등급이 1.1과 같은 사실', at(g11, 'T9').includes('2'), at(g11, 'T9'))
    check('관리자 성명이 1.1·1.7.1과 같다',
      at(g14, 'J13') === at(g11, 'AW6') && at(g14, 'J13') === at(g171, 'V4') && at(g14, 'J13') === '홍관리',
      `2.14=${at(g14, 'J13')} 1.1=${at(g11, 'AW6')} 1.7.1=${at(g171, 'V4')}`)
    check('선임일자가 1.7.1과 같은 표기(planDate 공유)',
      at(g14, 'R13') === at(g171, 'AE4') && at(g14, 'R13') === '2025. 4. 7.', at(g14, 'R13'))
    check('관리자 연락처가 1.1과 같다', at(g14, 'AS13') === at(g11, 'AW7'), at(g14, 'AS13'))
    check('대장 성명이 2.2와 같다', at(g14, 'R18') === at(g22, 'X5') && at(g14, 'R18') === '김대장',
      `2.14=${at(g14, 'R18')} 2.2=${at(g22, 'X5')}`)
    check('대장 연락처도 같은 표기', at(g14, 'R20') === at(g22, 'AZ5'), at(g14, 'R20'))
    check('자위소방대 총원이 들어간다', at(g14, 'J18') === '1', at(g14, 'J18'))
    check('자격구분은 「주」만 √', at(g14, 'AG13').includes('√') && !at(g14, 'AK13').includes('√'),
      `${at(g14, 'AG13')}·${at(g14, 'AK13')}`)

    /* 🚨 음성 — 축이 다르거나 근거 없는 칸은 비어 있다 */
    check('근무인원 4칸은 비어 있다(1.1은 상시/거주/최대 축이다)',
      at(g14, 'R10') === '' && at(g14, 'AB10') === '' && at(g14, 'AL10') === '' && at(g14, 'AV10') === '',
      `R10=${JSON.stringify(at(g14, 'R10'))}`)
    check('보조자 3행은 비어 있다', at(g14, 'J14') === '' && at(g14, 'J16') === '')
    /* ⚠ `.trim()`으로 묻는다 — 이 칸들은 템플릿이 **공백 한 칸을 라벨로** 이고 있다.
     *   손대지 않았다는 뜻이므로 빈 칸이 맞다(원본과 같은지도 함께 확인한다). */
    check('팀별 인원 칸은 비어 있다(2.1·1.9와 같은 결정)',
      ['AD18', 'AO18', 'AY18', 'AD20', 'AO20'].every(c => at(g14, c).trim() === ''),
      ['AD18', 'AO18', 'AY18', 'AD20', 'AO20'].map(c => `${c}=${JSON.stringify(at(g14, c))}`).join(' '))
    check('표본 문장은 안 건드렸다(자유 문장까지 예외를 넓히지 않았다)',
      at(g14, 'J28') === labelAt(REC14_SHEET, 'J28'), at(g14, 'J28').slice(0, 12))
  }
}

/* ══════════════════════ [17] 2.14 뒷쪽 — 참석확인 명단 50명 ══════════════════════
 *  🎯 이 시트의 **핵심 단언은 음성**이다: `확인` 칸이 **전건 비어 있는가**. 명단을 미리 찍는 것은
 *    받아쓰기 대행이지만, 확인 칸에 무엇이든 찍으면 그 순간 **참석을 단언하게 된다.**
 *    ERP는 누가 참석했는지 모른다 — 앞쪽 참석/미참석 인원을 비운 것과 같은 축이다.
 *  ⭐ 두 단(1~25 / 26~50)의 **이어짐**도 묻는다. 26번째가 오른쪽 단 첫 줄에 안 가면
 *    명단이 조용히 25명에서 끊긴다(가장 눈에 안 띄는 부류의 결함). */
console.log('\n[17] 2.14 뒷쪽 — 참석확인 명단 · 확인 칸은 비어야')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, ATT14_SHEET, ATT14_ROWS, ATT14_CAPACITY, ATT14_FIRST_ROW } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, attendanceOverflow } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const brigade = Array.from({ length: ATT14_CAPACITY + 2 }, (_, i) => ({
    team: i === 0 ? '자위소방대장' : `팀${i}`, name: `대원${i}`,
    duty: `임무${i}`, phone: `0101111${String(i).padStart(4, '0')}`,
  }))
  const fx = { buildingName: 'X', facilities: [], brigade, zones: [], hazards: [], forms: {} } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const ga = await readSheetGrid(await JSZip.loadAsync(out.bytes), ATT14_SHEET)
    const at = (r: string) => ga.cells.find(x => x.ref === r)?.text ?? ''

    check('한 단 행 수가 연번 구간에서 파생된다(25행)', ATT14_ROWS === 25, `${ATT14_ROWS}행`)
    check('정원이 50명', ATT14_CAPACITY === 50, `${ATT14_CAPACITY}명`)

    /* 왼쪽 단 — 1번과 25번 */
    check('1번이 왼쪽 단 첫 줄', at(`F${ATT14_FIRST_ROW}`) === '자위소방대장'
      && at(`O${ATT14_FIRST_ROW}`) === '대원0', `${at(`F${ATT14_FIRST_ROW}`)}/${at(`O${ATT14_FIRST_ROW}`)}`)
    check('25번이 왼쪽 단 마지막', at(`O${ATT14_FIRST_ROW + 24}`) === '대원24', at(`O${ATT14_FIRST_ROW + 24}`))
    /* ⭐ 두 단이 이어진다 — 26번이 오른쪽 단 첫 줄 */
    check('26번이 오른쪽 단 첫 줄(단이 이어진다)', at(`AS${ATT14_FIRST_ROW}`) === '대원25',
      at(`AS${ATT14_FIRST_ROW}`))
    check('50번이 오른쪽 단 마지막', at(`AS${ATT14_FIRST_ROW + 24}`) === '대원49',
      at(`AS${ATT14_FIRST_ROW + 24}`))

    /* 🎯 핵심 음성 — 확인 칸 50개가 **전건** 비어 있다 */
    const conf = Array.from({ length: ATT14_ROWS }, (_, i) =>
      [`W${ATT14_FIRST_ROW + i}`, `BA${ATT14_FIRST_ROW + i}`]).flat()
    check('확인 칸을 실제로 50개 훑었다(0건이면 공허)', conf.length === 50, `${conf.length}칸`)
    check('확인 칸이 전건 비어 있다(참석을 단언하지 않는다)',
      conf.every(c => at(c).trim() === ''),
      conf.filter(c => at(c).trim() !== '').slice(0, 4).map(c => `${c}='${at(c)}'`).join(' '))

    /* 🚨 음성 — 연번·머리글은 양식 그대로 */
    check('연번은 양식이 인쇄한 그대로', at(`A${ATT14_FIRST_ROW}`) === labelAt(ATT14_SHEET, `A${ATT14_FIRST_ROW}`)
      && at(`AE${ATT14_FIRST_ROW}`) === labelAt(ATT14_SHEET, `AE${ATT14_FIRST_ROW}`),
      `${at(`A${ATT14_FIRST_ROW}`)}·${at(`AE${ATT14_FIRST_ROW}`)}`)
    check('머리글 네 칸이 살아 있다',
      ['F2', 'O2', 'W2', 'BA2'].every(c => at(c) === labelAt(ATT14_SHEET, c)),
      ['F2', 'O2', 'W2', 'BA2'].map(c => at(c)).join('·'))
    /* ⚠ 직책은 team이지 duty가 아니다 */
    check('직책 칸에 개별임무를 넣지 않았다', !at(`F${ATT14_FIRST_ROW}`).startsWith('임무'),
      at(`F${ATT14_FIRST_ROW}`))

    check('넘친 대원을 센다', attendanceOverflow(fx) === 2, `${attendanceOverflow(fx)}명`)
  }
}

/* ══════════════════════ [18] 3.5 피난약자 — ①류(PDF는 인쇄, 엑셀만 공란이었다) ══════════════════════
 *  🎯 핵심은 **구역 쪼개기가 물러날 줄 아는가**다. 양식은 `구역`을 동·층 두 칸으로 그리는데
 *    ERP는 한 칸(`구역(동·층)`)이다. 조각만 넣으면 `3동 4층 로비`의 `로비`가 조용히 사라진다 —
 *    **전부 아니면 전무**여야 하고, 물러난 건수는 세어져야 한다.
 *  ⭐ 유형 자구가 **양식 라벨에 실제로 들어 있는지**도 묻는다(목록을 세 번째로 베낀 게 아니라는 증거). */
console.log('\n[18] 3.5 피난약자 — 구역 쪼개기는 전부 아니면 전무')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, VUL_SHEET, VUL_WORK_CELLS, VUL_USE_CELLS, VUL_PLAN_ROWS, VUL_PLAN_FIRST_ROW } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, splitAreaDongFloor, vulnerableAreaUnsplit, vulnerablePlanOverflow } =
    await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  /* 🎯 순수 함수부터 — 받는 꼴과 물러나는 꼴 */
  check("'3층' → 층만", JSON.stringify(splitAreaDongFloor('3층')) === '{"dong":"","floor":"3층"}')
  check("'1동 3층' → 둘 다", JSON.stringify(splitAreaDongFloor('1동 3층')) === '{"dong":"1동","floor":"3층"}')
  check("'B1층' → 층", splitAreaDongFloor('B1층')?.floor === 'B1층')
  check("'로비' → 물러난다(null)", splitAreaDongFloor('로비') === null)
  check("'3동 4층 로비' → 물러난다(조각만 넣지 않는다)", splitAreaDongFloor('3동 4층 로비') === null)
  /* ⚠ `1층~3층`은 **한 토큰**이라 층 칸에 그대로 들어간다 — 범위 표기는 층 칸이 맞다.
   *   물러나는 건 「층으로 읽을 토큰이 둘」인 경우다(`1층 3층`). */
  check("'1층~3층' → 층 칸에 그대로(범위도 층이다)", splitAreaDongFloor('1층~3층')?.floor === '1층~3층')
  check("'1층 3층' → 물러난다(층이 둘)", splitAreaDongFloor('1층 3층') === null)
  check('빈 값은 빈 두 칸', JSON.stringify(splitAreaDongFloor('')) === '{"dong":"","floor":""}')

  const plans = [
    { area: '1동 3층', count: '2', type: '노인', helper: '김보조', equip: '휠체어', method: '부축 이동' },
    { area: '로비', count: '1', type: '장애인', helper: '이보조', equip: '들것', method: '2인 이동' },
    ...Array.from({ length: VUL_PLAN_ROWS }, (_, i) => ({
      area: `${i + 2}층`, count: '1', type: '기타', helper: `보조${i}`, equip: '', method: '',
    })),
  ]
  const fx = {
    buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: {
      vulnerable: {
        none: false,
        counts: { 노인: { work: '3', use: '0' }, 장애인: { work: '', use: '5' } },
        plans,
      },
    },
  } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const gv = await readSheetGrid(await JSZip.loadAsync(out.bytes), VUL_SHEET)
    const at = (r: string) => gv.cells.find(x => x.ref === r)?.text ?? ''
    const R0 = VUL_PLAN_FIRST_ROW

    check('피난계획 행 수가 파생된다(14행)', VUL_PLAN_ROWS === 14, `${VUL_PLAN_ROWS}행`)
    /* ⭐ 유형 자구가 양식 라벨에 실제로 있다 — 목록을 베낀 게 아니다 */
    check('유형 12개가 전부 양식 라벨과 맞는다',
      [...VUL_WORK_CELLS.map(([t, b]) => [t, b] as const), ...VUL_USE_CELLS]
        .every(([t, b]) => labelAt(VUL_SHEET, b).includes(t)),
      [...VUL_WORK_CELLS, ...VUL_USE_CELLS].length + '칸')

    /* 근무·거주자 — 노인만 3명 */
    check('노인 상자 켜지고 인원 3명', at('H3').includes('■') && at('Q3').includes('3'),
      `${at('H3')} / ${at('Q3')}`)
    check('근무 0인 유형은 꺼짐(장애인)', !at('Y4').includes('■'), at('Y4'))
    /* 시설이용자 — 장애인만 5명(인원 칸은 양식에 없다) */
    check('시설이용 장애인 상자 켜짐', at('AU5').includes('■'), at('AU5'))
    check('시설이용 노인은 꺼짐(use=0)', !at('H5').includes('■'), at('H5'))
    /* 단위 자구가 살아 있다 */
    check('인원 칸의 「명」이 남는다', at('Q3').trim().endsWith('명') && at('Q4') === labelAt(VUL_SHEET, 'Q4'),
      `Q3='${at('Q3')}' Q4='${at('Q4')}'`)

    /* 🎯 구역 — 쪼개진 행과 물러난 행 */
    check('쪼개진 행: 동·층이 각 칸에', at(`H${R0}`) === '1동' && at(`M${R0}`) === '3층',
      `${at(`H${R0}`)}/${at(`M${R0}`)}`)
    check('물러난 행: 동·층 **둘 다** 비었다(조각만 넣지 않았다)',
      at(`H${R0 + 1}`) === '' && at(`M${R0 + 1}`) === '',
      `H=${JSON.stringify(at(`H${R0 + 1}`))} M=${JSON.stringify(at(`M${R0 + 1}`))}`)
    check('물러나도 나머지 열은 채운다', at(`R${R0 + 1}`) === '1' && at(`U${R0 + 1}`) === '장애인'
      && at(`AS${R0 + 1}`) === '2인 이동', `${at(`U${R0 + 1}`)}/${at(`AS${R0 + 1}`)}`)
    check('못 쪼갠 건수를 센다', vulnerableAreaUnsplit(fx) === 1, `${vulnerableAreaUnsplit(fx)}건`)
    check('넘친 계획을 센다', vulnerablePlanOverflow(fx) === 2, `${vulnerablePlanOverflow(fx)}건`)
    check('마지막 행도 착지', at(`AD${R0 + VUL_PLAN_ROWS - 1}`) === '보조11', at(`AD${R0 + VUL_PLAN_ROWS - 1}`))

    /* 🚨 음성 — 「해당없음」이면 상자가 하나도 안 켜진다 */
    const fxNone = { ...(fx as object), forms: { vulnerable: { none: true, counts: { 노인: { work: '3', use: '2' } }, plans } } } as never
    const t2 = toInjectTargets(buildFirePlanValues(fxNone), vc.anchors)
    const o2 = await injectWorkbook(bytes, t2.targets)
    const g2 = await readSheetGrid(await JSZip.loadAsync(o2.bytes), VUL_SHEET)
    const at2 = (r: string) => g2.cells.find(x => x.ref === r)?.text ?? ''
    check('해당없음이면 상자 12개가 전부 꺼진다',
      [...VUL_WORK_CELLS.map(([, b]) => b), ...VUL_USE_CELLS.map(([, b]) => b)].every(b => !at2(b).includes('■')),
      at2('H3'))
    check('해당없음이면 인원·계획도 비운다', at2('Q3') === labelAt(VUL_SHEET, 'Q3') && at2(`U${R0}`) === '',
      `Q3='${at2('Q3')}' U${R0}='${at2(`U${R0}`)}'`)
    check('해당없음이어도 법정 비고는 온전하다', at2('A22') === labelAt(VUL_SHEET, 'A22'))

    /* ══ [19] 1.9 피난약자 블록 — 3.5의 축약본이 같은 값을 찍는가 ══
     *  🎯 같은 워크북 안에서 3.5는 인쇄하는데 1.9만 비어 있으면 **그게 D-7 갈라짐**이다.
     *    두 시트를 맞대어 유형·보조자·층이 같은지 묻는다(1.9가 담는 3행 전부). */
    console.log('\n[19] 1.9 피난약자 블록 — 3.5와 같은 값인가')
    const { VUL9_SHEET, VUL9_BOX_CELLS, VUL9_ROWS, VUL9_FIRST_ROW } =
      await import('../src/lib/fire-plan-anchors.ts')
    const g9v = await readSheetGrid(await JSZip.loadAsync(out.bytes), VUL9_SHEET)
    const a9 = (r: string) => g9v.cells.find(x => x.ref === r)?.text ?? ''

    check('1.9 표 행 수가 파생된다(3행)', VUL9_ROWS === 3, `${VUL9_ROWS}행`)
    check('상자는 5종뿐이다(3.5의 「기타」가 없다)', VUL9_BOX_CELLS.length === 5
      && !VUL9_BOX_CELLS.some(([t]) => t === '기타'), `${VUL9_BOX_CELLS.length}종`)
    check('상자 자구가 전부 양식 라벨과 맞는다',
      VUL9_BOX_CELLS.every(([t, c]) => labelAt(VUL9_SHEET, c).includes(t)))

    /* 🎯 항등 — 3.5가 담은 같은 행과 글자까지 같은가 */
    const vdiff: string[] = []
    let vcmp = 0
    for (let i = 0; i < VUL9_ROWS; i++) {
      for (const [c9, c35] of [['N', 'U'], ['AT', 'AD']] as const) {
        const x = a9(`${c9}${VUL9_FIRST_ROW + i}`), y = at(`${c35}${R0 + i}`)
        if (x !== y) vdiff.push(`${i}행 ${c9}: '${x}' ≠ '${y}'`)
        vcmp++
      }
    }
    check('대조가 실제로 돌았다(0건이면 공허)', vcmp === 6, `${vcmp}칸`)
    check('1.9 ↔ 3.5 유형·보조자 전건 일치 (D-7 항등)', vdiff.length === 0, vdiff.join(' / '))
    check('빈 채로 일치한 게 아니다', a9(`N${VUL9_FIRST_ROW}`) === '노인'
      && a9(`AT${VUL9_FIRST_ROW}`) === '김보조', `${a9(`N${VUL9_FIRST_ROW}`)}/${a9(`AT${VUL9_FIRST_ROW}`)}`)

    /* 활동 구역은 단위칸 — 3.5가 쪼갠 층 조각 + 법정 자구 */
    check('활동 구역에 층 조각이 들어가고 자구가 남는다',
      a9(`H${VUL9_FIRST_ROW}`).startsWith('3') && a9(`H${VUL9_FIRST_ROW}`).trim().endsWith('층'),
      `'${a9(`H${VUL9_FIRST_ROW}`)}'`)
    check('못 쪼갠 행은 자구만 남는다(조각을 넣지 않는다)',
      a9(`H${VUL9_FIRST_ROW + 1}`) === labelAt(VUL9_SHEET, `H${VUL9_FIRST_ROW + 1}`),
      `'${a9(`H${VUL9_FIRST_ROW + 1}`)}'`)
    check('상자도 3.5와 같은 판정(노인 켜짐·장애인 꺼짐)',
      a9('H20').includes('■') && !a9('AY20').includes('■'), `${a9('H20')}·${a9('AY20')}`)

    /* 🚨 음성 — ERP에 축이 없는 칸은 비어 있다 */
    check('성명·연락처 세 칸은 비어 있다(plans는 인원 수만 담는다)',
      [`A${VUL9_FIRST_ROW}`, `W${VUL9_FIRST_ROW}`, `BA${VUL9_FIRST_ROW}`].every(c => a9(c).trim() === ''),
      [`A${VUL9_FIRST_ROW}`, `W${VUL9_FIRST_ROW}`, `BA${VUL9_FIRST_ROW}`].map(c => `${c}=${JSON.stringify(a9(c))}`).join(' '))
    check('피난계획 표준문구가 온전하다',
      a9(`AG${VUL9_FIRST_ROW}`) === labelAt(VUL9_SHEET, `AG${VUL9_FIRST_ROW}`),
      a9(`AG${VUL9_FIRST_ROW}`).slice(0, 10))
  }
}

/* ══════════════════════ [20] 3.4 피난유도 — 법정 예시문칸이 실제로 덮이는가 ══════════════════════
 *  🎯 아홉째 갈래(`isSampleTextAnchor`)는 **내용 고정**으로 백지 불변식을 면제받는다.
 *    그 면제가 정당하려면 **값이 있을 때 실제로 덮여야** 한다 — 안 그러면 「선언만 해 두고
 *    영영 공란」이 조용히 통과한다. 그 짝을 여기서 묻는다(값 있음 → 덮임 / 값 없음 → 예시 유지).
 *  ⭐ 집결지는 **한 장 안에서 두 칸**이다(AT10·T13) — 둘을 맞댄다. */
console.log('\n[20] 3.4 피난유도 — 예시문은 덮이고, 비면 남는가')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, EVAC34_SHEET, EVAC34_ROUTE_ROW, FIRE_PLAN_SAMPLE_CELLS } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, evacRouteOverflow } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const base = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [], forms: {} }
  const filled = {
    ...base,
    evacFalseAlarm: '오동작 시 방송으로 알리고 대기',
    assembly: '후문 공터',
    evacRoutes: [
      { floor: '2층', route: '계단 A를 통해 지상으로', guide: '박유도', equip: '완강기' },
      { floor: '3층', route: '계단 B', guide: '최유도', equip: '' },
    ],
  } as never
  const R = EVAC34_ROUTE_ROW

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const run = async (fx: never) => {
      const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
      const out = await injectWorkbook(bytes, targets)
      const g = await readSheetGrid(await JSZip.loadAsync(out.bytes), EVAC34_SHEET)
      return (r: string) => g.cells.find(x => x.ref === r)?.text ?? ''
    }
    const at = await run(filled)
    const atEmpty = await run(base as never)

    /* ⚠ 선언표는 시트가 섞여 있다 — 이 절은 3.4 격자만 읽으므로 **시트로 걸러야** 한다.
     *   안 거르면 3.6 칸을 3.4에서 찾아 빈 문자열이 나오고 단언이 거짓으로 빨개진다. */
    const S34 = FIRE_PLAN_SAMPLE_CELLS.filter(([sh]) => sh === EVAC34_SHEET)
    check('3.4 예시문칸 4개를 선언했다', S34.length === 4, `${S34.length}칸 / 전체 ${FIRE_PLAN_SAMPLE_CELLS.length}칸`)

    /* 🎯 ① 값이 있으면 **덮인다** — 면제가 「영영 공란」의 은신처가 아님을 증명 */
    check('비화재보가 덮인다', at('G4') === '오동작 시 방송으로 알리고 대기', at('G4'))
    check('피난경로 문장이 덮인다', at('A11') === '계단 A를 통해 지상으로', at('A11'))
    check('집결지 두 칸이 덮인다', at('AT10') === '후문 공터' && at('T13') === '후문 공터',
      `AT10=${at('AT10')} T13=${at('T13')}`)
    /* ⭐ 한 장 안에서 두 칸이 같은 값 */
    check('집결지 두 칸이 서로 같다(한 장 안 갈라짐 방지)', at('AT10') === at('T13'))

    /* 🎯 ② 값이 없으면 **예시가 남는다** — 빈 서식이 뜻을 잃지 않는다 */
    /* ⚠ `want.trim()`이 아니라 `want` 그대로 비교한다 — `placeholderCell`은 값이 없으면
     *   manifest 원문을 **꼬리 공백까지** 되쓴다(T13이 `'1층 주차장 '`). 깎아서 비교하면
     *   원문이 바뀌어도 초록이 되므로 핀이 구실을 잃는다. */
    check('값이 없으면 예시가 그대로 남는다(꼬리 공백까지)',
      S34.every(([, c, want]) => atEmpty(c) === want),
      S34.map(([, c]) => `${c}=${JSON.stringify(atEmpty(c))}`).join(' '))

    /* 경로 3열 */
    check('경로 3열이 착지', at(`E${R}`) === '2층' && at(`W${R}`) === '박유도' && at(`AI${R}`) === '완강기',
      `${at(`E${R}`)}/${at(`W${R}`)}/${at(`AI${R}`)}`)
    check('둘째 경로는 넘쳐서 세어진다(양식이 한 줄만 그렸다)', evacRouteOverflow(filled) === 1,
      `${evacRouteOverflow(filled)}건`)

    /* 🚨 음성 — 축이 없는 칸은 비어 있다 */
    check('「화재 시」 네 칸은 비어 있다(evacNote는 자유 문장 한 칸이다)',
      ['G7', 'L7', 'Q7', 'AC7'].every(c => at(c).trim() === ''),
      ['G7', 'L7', 'Q7', 'AC7'].map(c => `${c}=${JSON.stringify(at(c))}`).join(' '))
    check('동별·확인사항은 비어 있다', at(`A${R}`).trim() === '' && at('T14').trim() === '',
      `A${R}=${JSON.stringify(at(`A${R}`))} T14=${JSON.stringify(at('T14'))}`)
    check('「피난경로 개수」는 양식 그대로(route는 문장이지 개수가 아니다)',
      at(`J${R}`) === labelAt(EVAC34_SHEET, `J${R}`).trim(), at(`J${R}`))
  }
}

/* ══════════════════════ [21] 3.6 유형별 피난방법 — 예시문 네 줄이 열렸다 ══════════════════════
 *  ⭐ 유형 이름을 **양식 A열 라벨에서 읽는다** — 목록을 네 번째로 베끼지 않았다는 증거로
 *    ERP 열쇠와 양식 라벨이 같은 문자열임을 단언한다.
 *  🚨 양식은 **4종**뿐이다. ERP의 `영유아`·`기타`가 조용히 사라지지 않는지 센다. */
console.log('\n[21] 3.6 유형별 피난방법 — 4종만, 나머지는 세어진다')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, VUL36_SHEET, VUL36_ROWS, VUL36_TYPES } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, vulnerableMethodsUnmapped } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const methods = {
    노인: '보조자 2인이 부축', 장애인: '휠체어로 이동',
    영유아: '안아서 이동', 기타: '보조자 사전 지정',   // ← 양식에 줄이 없는 두 유형
  }
  const fx = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: { vulnerableMethods: methods } } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const g36 = await readSheetGrid(await JSZip.loadAsync(out.bytes), VUL36_SHEET)
    const at = (r: string) => g36.cells.find(x => x.ref === r)?.text ?? ''

    check('양식 유형이 4종으로 파생된다', VUL36_TYPES.join('·') === '노인·어린이·임산부·장애인',
      VUL36_TYPES.join('·'))
    /* ⭐ 목록을 베끼지 않았다 — 유형 이름이 곧 양식 라벨이다 */
    check('유형 이름이 양식 A열 라벨과 같다',
      VUL36_ROWS.every(([a], i) => labelAt(VUL36_SHEET, a).trim() === VUL36_TYPES[i]))

    check('값이 있는 유형은 덮인다(노인·장애인)',
      at('K3') === '보조자 2인이 부축' && at('K6') === '휠체어로 이동', `${at('K3')} / ${at('K6')}`)
    /* 🚨 값이 없는 유형은 **법정 예시가 남는다** — 빈 서식이 뜻을 잃지 않는다 */
    check('값이 없는 유형은 예시가 남는다(어린이·임산부)',
      at('K4') === labelAt(VUL36_SHEET, 'K4') && at('K5') === labelAt(VUL36_SHEET, 'K5'),
      at('K4').slice(0, 14))
    /* 🚨 양식 원문의 오자까지 그대로 남는다 — 우리가 양식을 고쳐 쓰지 않는다 */
    check('양식 원문의 오자도 손대지 않는다(「천전히」)', at('K4').includes('천전히'))

    check('갈 줄 없는 유형을 센다(영유아·기타)',
      vulnerableMethodsUnmapped(fx).sort().join('·') === '기타·영유아',
      vulnerableMethodsUnmapped(fx).join('·'))
    /* 🚨 음성 — 유의사항은 ERP에 축이 없다 */
    check('유의사항은 안 건드린다', at('AZ3') === labelAt(VUL36_SHEET, 'AZ3') && at('AZ6').trim() === '',
      `AZ3=${at('AZ3')} AZ6=${JSON.stringify(at('AZ6'))}`)
  }
}

/* ══════════════════════ [23] 2.3 조직도 — 대장을 그리는 네 번째 시트 ══════════════════════
 *  ⭐ 같은 대장이 이제 **네 시트**에 인쇄된다(2.2 · 1.9 · 2.14 · 2.3). 넷을 한꺼번에 맞댄다 —
 *    한 시트라도 다른 사람을 찍으면 D-7 갈라짐이다. */
console.log('\n[23] 2.3 조직도 — 네 시트가 같은 대장인가')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, ORG23_SHEET, BRIG_SHEET, BRIG9_SHEET, REC14_SHEET } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const brigade = [
    { team: '자위소방대장', name: '김대장', duty: '총괄', phone: '01011112222' },
    { team: '부대장', name: '이부장', duty: '보좌', phone: '01033334444' },
    { team: '초기소화팀', name: '최소화', duty: '초기소화', phone: '01077778888' },
    { team: '피난유도', name: '정유도', duty: '피난유도', phone: '01099990000' },
  ]
  const fx = { buildingName: '가온빌딩', facilities: [], brigade, zones: [], hazards: [], forms: {} } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const z2 = await JSZip.loadAsync(out.bytes)
    const g23 = await readSheetGrid(z2, ORG23_SHEET)
    const g22 = await readSheetGrid(z2, BRIG_SHEET)
    const g9 = await readSheetGrid(z2, BRIG9_SHEET)
    const g14 = await readSheetGrid(z2, REC14_SHEET)
    const at = (g: typeof g23, r: string) => g.cells.find(x => x.ref === r)?.text ?? ''

    /* 🎯 네 시트의 대장이 같은 사람이다 */
    const leads = [at(g23, 'AE5'), at(g22, 'X5'), at(g9, 'T9'), at(g14, 'R18')]
    check('네 시트의 대장이 같다(2.3·2.2·1.9·2.14)',
      leads.every(x => x === '김대장'), leads.join(' / '))
    check('부대장도 같다(2.3·2.2·1.9)',
      at(g23, 'AE9') === '이부장' && at(g22, 'X6') === '이부장' && at(g9, 'T10') === '이부장',
      `${at(g23, 'AE9')}/${at(g22, 'X6')}/${at(g9, 'T10')}`)
    check('소속은 건물명(2.2와 같은 규약)', at(g23, 'V5') === '가온빌딩' && at(g23, 'V9') === '가온빌딩')

    /* 현장대응팀 — 첫 행에만, 대장·부대장을 뺀 수 */
    check('현장대응팀 소속·인원이 첫 행에', at(g23, 'C14') === '가온빌딩' && at(g23, 'AG14') === '2',
      `${at(g23, 'C14')}/${at(g23, 'AG14')}`)
    check('남는 두 행은 비어 있다', ['C15', 'AG15', 'C16', 'AG16'].every(c => at(g23, c).trim() === ''))

    /* 🚨 음성 — 초기대응체계 조·인원 칸은 비어 있다(조 편성 축이 ERP에 없다) */
    check('초기대응체계 칸은 비어 있다', ['AU7', 'BA7', 'AU9', 'BA9'].every(c => at(g23, c).trim() === ''),
      ['AU7', 'BA7'].map(c => JSON.stringify(at(g23, c))).join(' '))
    check('머리글·법정 자구가 온전하다', at(g23, 'V4') === labelAt(ORG23_SHEET, 'V4')
      && at(g23, 'C13') === labelAt(ORG23_SHEET, 'C13'), `${at(g23, 'V4')}·${at(g23, 'C13')}`)

    /* 편성표가 비면 전부 빈다 — 빈 소속에 건물명만 찍히지 않는다(2.2 org 규약) */
    const t2 = toInjectTargets(buildFirePlanValues(
      { ...(fx as object), brigade: [] } as never), vc.anchors)
    const o2 = await injectWorkbook(bytes, t2.targets)
    const g0 = await readSheetGrid(await JSZip.loadAsync(o2.bytes), ORG23_SHEET)
    check('편성표가 비면 여섯 칸 전부 빈다',
      ['V5', 'AE5', 'V9', 'AE9', 'C14', 'AG14'].every(c =>
        (g0.cells.find(x => x.ref === c)?.text ?? '').trim() === ''))
  }
}

/* ══════════════════════ [24] 1.9.3 입주사 — ④ 첫 입력 축 신설 ══════════════════════
 *  🚨 종전 기각(「축이 없다」)의 답은 유추가 아니라 **제 축 신설**이었다(`forms.tenants`).
 *  ⚠ `관리구역` 열은 양식이 「없음」을 `-`로 인쇄해 둔 자리다(3~12행) — 값이 없으면 `-`가
 *    남아야 하고, 지우면 양식의 「없음」 표기가 사라진다. */
console.log('\n[24] 1.9.3 입주사 — 5열 착지·대시 자리표시')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, TENANT_SHEET, TENANT_ROWS, TENANT_FIRST_ROW } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, tenantRowOverflow } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const tenants = Array.from({ length: TENANT_ROWS + 1 }, (_, i) => ({
    name: `업체${i}`, usage: `용도${i}`, zone: i === 1 ? '' : `${i + 1}층`,   // ← 2행은 구역 미입력
    rep: `대표${i}`, phone: `0101234${String(i).padStart(4, '0')}`,
  }))
  const fx = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: { tenants } } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const gt = await readSheetGrid(await JSZip.loadAsync(out.bytes), TENANT_SHEET)
    const at = (r: string) => gt.cells.find(x => x.ref === r)?.text ?? ''
    const R0 = TENANT_FIRST_ROW

    check('행 수가 연번에서 파생된다(15행)', TENANT_ROWS === 15, `${TENANT_ROWS}행`)
    check('첫 행 5열 착지', at(`G${R0}`) === '업체0' && at(`U${R0}`) === '용도0'
      && at(`AD${R0}`) === '1층' && at(`AO${R0}`) === '대표0', `${at(`G${R0}`)}/${at(`AD${R0}`)}`)
    check('연락처는 formatTel 표기', at(`AY${R0}`) === '010-1234-0000', at(`AY${R0}`))
    check('마지막 행(17)도 착지', at(`G${R0 + 14}`) === '업체14', at(`G${R0 + 14}`))

    /* 🎯 대시 자리표시 — 구역 미입력 행(2행)은 `-`가 남는다 */
    check('구역 미입력이면 양식의 -가 남는다', at(`AD${R0 + 1}`) === '-', JSON.stringify(at(`AD${R0 + 1}`)))
    check('값이 있으면 -를 덮는다', at(`AD${R0 + 2}`) === '3층', at(`AD${R0 + 2}`))

    check('연번은 양식 그대로', at(`A${R0}`) === labelAt(TENANT_SHEET, `A${R0}`)
      && at(`A${R0 + 14}`) === '15', `${at(`A${R0}`)}·${at(`A${R0 + 14}`)}`)
    check('넘친 입주사를 센다', tenantRowOverflow(fx) === 1, `${tenantRowOverflow(fx)}곳`)

    /* 빈 픽스처 — 표가 온전히 빈 서식으로 남는가 */
    const t0 = toInjectTargets(buildFirePlanValues(
      { ...(fx as object), forms: {} } as never), vc.anchors)
    const o0 = await injectWorkbook(bytes, t0.targets)
    const g0 = await readSheetGrid(await JSZip.loadAsync(o0.bytes), TENANT_SHEET)
    const a0 = (r: string) => g0.cells.find(x => x.ref === r)?.text ?? ''
    check('입주사가 없으면 업체명 칸은 빈다', a0(`G${R0}`) === '' && a0(`G${R0 + 14}`) === '')
    check('입주사가 없어도 -는 남는다(빈 서식의 「없음」 표기)', a0(`AD${R0}`) === '-', JSON.stringify(a0(`AD${R0}`)))
  }
}

/* ══════════════════════ [25] 2.13 초기대응절차 — 3.4와 같은 원천 ══════════════════════
 *  ⭐ 비화재보는 3.4 G4와, 화재 시는 `evacNote`와 **같은 값**이어야 한다. 3.4의 「화재 시」는
 *    네 칸 표라 비웠지만 여긴 한 칸이라 채운다 — 같은 값, 다른 그릇임을 되읽어 확인한다. */
console.log('\n[25] 2.13 초기대응절차 — 3.4와 같은 원천')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, RESP13_SHEET, EVAC34_SHEET } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const fx = { buildingName: '가온빌딩', facilities: [], brigade: [], zones: [], hazards: [], forms: {},
    evacFalseAlarm: '오동작 시 방송 후 대기', evacNote: '유도자 지시로 최단 경로 피난' } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const z2 = await JSZip.loadAsync(out.bytes)
    const g13 = await readSheetGrid(z2, RESP13_SHEET)
    const g34 = await readSheetGrid(z2, EVAC34_SHEET)
    const at = (g: typeof g13, r: string) => g.cells.find(x => x.ref === r)?.text ?? ''

    check('대상명이 접두라벨로 붙는다', at(g13, 'A2') === '■ 대상명 : 가온빌딩', at(g13, 'A2'))
    /* 🎯 비화재보 — 3.4 G4와 같은 값 */
    check('비화재보가 3.4와 같다(D-7 항등)', at(g13, 'I24') === at(g34, 'G4')
      && at(g13, 'I24') === '오동작 시 방송 후 대기', `2.13=${at(g13, 'I24')} 3.4=${at(g34, 'G4')}`)
    /* ⭐ 화재 시 — 3.4에선 못 실은 evacNote가 여기선 실린다 */
    check('화재 시에 evacNote가 실린다(3.4은 그릇이 없어 못 실었다)',
      at(g13, 'I25') === '유도자 지시로 최단 경로 피난', at(g13, 'I25'))
    /* 🚨 음성 — 편성·장비 표는 안 건드렸다 */
    check('편성 표(5~16행)는 비어 있다', ['Q5', 'AB5', 'Q15', 'AB15'].every(c => at(g13, c).trim() === ''))
    check('장비 표(19~21행)는 비어 있다', ['A19', 'L19', 'W21'].every(c => at(g13, c).trim() === ''))
    check('근무형태 상자는 꺼져 있다', !at(g13, 'F5').includes('■') && !at(g13, 'F16').includes('■'),
      `${at(g13, 'F5')}·${at(g13, 'F16')}`)
    check('머리글이 온전하다', at(g13, 'A24') === labelAt(RESP13_SHEET, 'A24')
      && at(g13, 'A18') === labelAt(RESP13_SHEET, 'A18'), `${at(g13, 'A24')}·${at(g13, 'A18')}`)
  }
}

/* ══════════════════════ [26] 3.7 피난기구 — 사각지대였던 ①류 · 예시 블록은 쌍으로 남긴다 ══════════════════════
 *  🚨 PDF는 evacEquip을 인쇄 중인데 [8] 마커 5종에 이 시트가 빠져 **사각지대**였다(마커 추가).
 *  ⭐ 블록 1(완강기)은 일부러 안 덮는다 — 사용방법(A5)이 완강기 전용 설명이라 명칭만 갈면
 *    **거짓 쌍**이 된다. evacEquip[0]은 블록 2부터 들어간다. */
console.log('\n[26] 3.7 피난기구 — 블록 2부터, 완강기 예시는 쌍으로')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, EQUIP37_SHEET, EQUIP37_ROWS } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, equipRowOverflow } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const evacEquip = [
    { name: '소화기', location: '각 층 복도', qty: '6' },
    { name: '유도등', location: '비상구 상부', qty: '12' },
    { name: '피난사다리', location: '3층 창고', qty: '1' },
    { name: '구조대', location: '옥상', qty: '1' },        // ← 4번째는 넘친다
  ]
  const fx = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: { evacEquip } } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const ge = await readSheetGrid(await JSZip.loadAsync(out.bytes), EQUIP37_SHEET)
    const at = (r: string) => ge.cells.find(x => x.ref === r)?.text ?? ''

    check('배선 블록은 3개(7·11·15행)', EQUIP37_ROWS.join(',') === '7,11,15', EQUIP37_ROWS.join(','))
    check('evacEquip[0]이 블록 2에 착지', at('S7') === '소화기' && at('AH7') === '각 층 복도' && at('BB7') === '6',
      `${at('S7')}/${at('AH7')}/${at('BB7')}`)
    check('블록 3·4도 착지', at('S11') === '유도등' && at('S15') === '피난사다리',
      `${at('S11')}/${at('S15')}`)
    check('넘친 장비를 센다', equipRowOverflow(fx) === 1, `${equipRowOverflow(fx)}건`)

    /* 🎯 완강기 예시 4칸이 **그대로** — 쌍(사용방법 A5)과 함께 남는다 */
    check('완강기 예시가 온전하다(명칭·장소·수량·층)',
      at('S3') === '완강기' && at('AH3') === '베란다' && at('BB3') === '각 1개' && at('L3') === '3~5층',
      `${at('S3')}/${at('AH3')}/${at('BB3')}/${at('L3')}`)
    check('사용방법 설명도 온전하다(쌍이 안 깨졌다)', at('A5') === labelAt(EQUIP37_SHEET, 'A5'),
      at('A5').slice(0, 14))
    /* 🚨 음성 — 동별·층별은 축이 없다 */
    check('동별·층별 칸은 비어 있다', ['E7', 'L7', 'E11', 'L11', 'E15', 'L15'].every(c => at(c).trim() === ''))
    check('자료삽입 자리는 안 건드렸다', at('S8') === labelAt(EQUIP37_SHEET, 'S8'))
  }
}

/* ══════════════════════ [27] 1.6.1 기타시설 — 사각지대 ①류 둘째 ══════════════════════
 *  ⭐ 차단기구 □유□무는 **켜기만** — boolean은 미입력과 「무」를 못 가른다.
 *  ⭐ 가스 예시 행은 덮이고, 비면 남는다(LPG·각층·…). */
console.log('\n[27] 1.6.1 기타시설 — 전기·가스·위험물')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, ETC61_SHEET } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const etcFacility = {
    electric: { kw: '350', kva: '500', location: '지하 1층 전기실', qty: '2',
      generator: true, generatorNote: '', note: '월 1회 점검', genKw: '80', genLocation: '옥상', genQty: '1' },
    gas: { kind: 'LNG', location: '주방', usage: '취사', regulator: true,
      shutoff: true, shutoffLocation: '주방 입구', regulatorLocation: '외벽' },
    hazmat: { none: true, note: '경유 소량(발전기용)' },
  }
  const fx = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: { etcFacility } } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const run = async (f: never) => {
      const { targets } = toInjectTargets(buildFirePlanValues(f), vc.anchors)
      const out = await injectWorkbook(bytes, targets)
      const g = await readSheetGrid(await JSZip.loadAsync(out.bytes), ETC61_SHEET)
      return (r: string) => g.cells.find(x => x.ref === r)?.text ?? ''
    }
    const at = await run(fx)
    const at0 = await run({ ...(fx as object), forms: {} } as never)

    /* 전기 — 단위 자구가 남는다 */
    check('수전·변압·발전 용량에 단위가 남는다', at('R4') === '350kW' && at('R5') === '500kVA'
      && at('R6').includes('80') && at('R6').trim().endsWith('kW'), `${at('R4')}/${at('R5')}/${at('R6')}`)
    check('위치·수량·비고 착지', at('AI5') === '지하 1층 전기실' && at('AZ5') === '2대'
      && at('R7') === '월 1회 점검', `${at('AI5')}/${at('AZ5')}`)
    /* 가스 — 예시 행이 덮인다 */
    check('가스 예시 행이 값으로 덮인다', at('J9') === 'LNG' && at('R9') === '주방' && at('AA9') === '취사'
      && at('AI9') === '외벽' && at('AZ9') === '주방 입구', `${at('J9')}/${at('R9')}/${at('AI9')}`)
    check('차단기구 유가 켜진다', at('AR9').startsWith('■'), at('AR9'))
    /* 위험물 */
    check('해당없음 상자가 켜지고 비고가 실린다', at('J18').includes('■') && at('R19') === '경유 소량(발전기용)',
      `${at('J18')}/${at('R19')}`)

    /* 🎯 빈 픽스처 — 예시가 남고, 상자는 어느 쪽도 안 켜진다 */
    check('비면 가스 예시가 그대로 남는다', at0('J9') === 'LPG' && at0('R9') === '각층'
      && at0('AI9') === '/', `${at0('J9')}/${at0('R9')}/${at0('AI9')}`)
    check('비면 차단기구 상자 둘 다 꺼짐(무를 지어내지 않는다)',
      !at0('AR9').includes('■') && at0('AR9') === labelAt(ETC61_SHEET, 'AR9'), at0('AR9'))
    check('비면 단위 자구만 남는다', at0('R4') === 'kW' && at0('AZ5') === '대', `${at0('R4')}/${at0('AZ5')}`)
    /* 🚨 음성 — 축 없는 칸은 안 건드린다 */
    check('가스 둘째·셋째 행은 비어 있다', ['J10', 'R10', 'J11'].every(c => at(c).trim() === ''))
    check('둘째 행 유무 상자는 원본 그대로', at('AR10') === labelAt(ETC61_SHEET, 'AR10'))
    check('위험물 세부·흡연장은 안 건드린다', ['J15', 'R15', 'AI20'].every(c => at(c).trim() === '')
      && at('R20') === labelAt(ETC61_SHEET, 'R20'), at('R20'))
    check('가스 해당없음(J12)은 축이 없어 꺼진 채', !at('J12').includes('■'))
  }
}

/* ══════════════════════ [28] 위험물 세부 — 1.6.1 ↔ 2.12 한 축 ══════════════════════
 *  🎯 같은 위험물이 두 시트에 인쇄된다 — 공통 3열(품명·보유량·위치)을 칸 대 칸으로 맞댄다.
 *  ⭐ valve는 select('유'/'무'/'')다 — 차단기구 boolean의 교훈. 미입력이면 빈 칸. */
console.log('\n[28] 위험물 세부 — 1.6.1 ↔ 2.12 항등')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, ETC61_SHEET, HAZ12_SHEET, HAZ61_ROWS, HAZ12_ROWS } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, hazmatItemOverflow } = await import('../src/lib/fire-plan-xlsx-values.ts')

  const items = [
    { kind: '옥내저장', location: '지하 1층', category: '제4류', name: '경유', amount: '400ℓ', multiple: '0.4', valve: '유', method: '수동 밸브' },
    { kind: '', location: '옥상', category: '', name: '윤활유', amount: '60ℓ', multiple: '', valve: '무', method: '' },
    { kind: '', location: '', category: '', name: '등유', amount: '', multiple: '', valve: '', method: '' },
    { kind: '', location: '', category: '', name: '넘침', amount: '', multiple: '', valve: '', method: '' },
  ]
  const base = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [] }
  const etcOf = (none: boolean) => ({ electric: { kw: '', kva: '', location: '', qty: '', generator: false, generatorNote: '', note: '' }, gas: { kind: '', location: '', usage: '', regulator: false, shutoff: false, shutoffLocation: '' }, hazmat: { none, note: '', items } })
  const fx = { ...base, forms: { etcFacility: etcOf(false) } } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const run = async (f: never) => {
      const { targets } = toInjectTargets(buildFirePlanValues(f), vc.anchors)
      const out = await injectWorkbook(bytes, targets)
      const z2 = await JSZip.loadAsync(out.bytes)
      const g61 = await readSheetGrid(z2, ETC61_SHEET)
      const g12 = await readSheetGrid(z2, HAZ12_SHEET)
      return {
        a61: (r: string) => g61.cells.find(x => x.ref === r)?.text ?? '',
        a12: (r: string) => g12.cells.find(x => x.ref === r)?.text ?? '',
      }
    }
    const { a61, a12 } = await run(fx)

    /* 🎯 공통 3열 항등 — 두 시트가 담는 3행 전부 */
    const diff: string[] = []
    let cmp = 0
    for (let i = 0; i < 3; i++) {
      for (const [c61, c12] of [['AI', 'O'], ['AR', 'X'], ['R', 'AG']] as const) {
        const x = a61(`${c61}${HAZ61_ROWS[i]}`), y = a12(`${c12}${HAZ12_ROWS[i]}`)
        if (x !== y) diff.push(`${i}행 ${c61}↔${c12}: '${x}' ≠ '${y}'`)
        cmp++
      }
    }
    check('대조가 실제로 돌았다(9칸)', cmp === 9, `${cmp}칸`)
    check('1.6.1 ↔ 2.12 공통 3열 전건 일치 (D-7 항등)', diff.length === 0, diff.slice(0, 3).join(' / '))
    check('빈 채로 일치한 게 아니다', a61('AI15') === '경유' && a12('O11') === '경유'
      && a61('AA15') === '제4류' && a12('AQ11') === '유',
      `${a61('AI15')}/${a12('O11')}/${a12('AQ11')}`)
    check('2.12 대상명이 붙는다', a12('A2') === '■ 대상명 : X', a12('A2'))
    /* ⭐ valve 미입력은 빈 칸 — 무를 지어내지 않는다 */
    check('밸브 미입력이면 빈 칸(3행)', a12('AQ13').trim() === '', JSON.stringify(a12('AQ13')))
    check('넘친 위험물을 센다', hazmatItemOverflow(fx) === 1, `${hazmatItemOverflow(fx)}건`)

    /* 🚨 해당없음이면 목록이 양쪽 다 빈다 — 모순 금지 */
    const { a61: n61, a12: n12 } = await run({ ...base, forms: { etcFacility: etcOf(true) } } as never)
    check('해당없음이면 두 시트 목록이 다 빈다',
      n61('AI15').trim() === '' && n12('O11').trim() === '' && n61('J18').includes('■'),
      `${JSON.stringify(n61('AI15'))}/${JSON.stringify(n12('O11'))}`)
    /* 🚨 음성 — 2.12 비상반출물품·방화구획 조치는 안 건드린다 */
    check('비상반출물품·방화구획 칸은 비어 있다', ['O15', 'Z15', 'Z5'].every(c => a12(c).trim() === ''))
  }
}

/* ══════════════════════ [29] 2.12 비상반출물품 — ④ 셋째 축 ══════════════════════
 *  ⭐ locked는 select 3값 — 미입력('')이면 칸이 빈다(무를 지어내지 않는다). */
console.log('\n[29] 2.12 비상반출물품')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, HAZ12_SHEET, VAL12_ROWS } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, valuableRowOverflow } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const valuables = [
    { name: '계약서류', place: '사무실 금고', locked: '유', after: '차량 트렁크' },
    { name: '도장·통장', place: '서랍', locked: '', after: '' },      // ← 시건 미입력
    { name: '서버 백업디스크', place: '전산실', locked: '무', after: '관리사무소' },
    { name: '넘침', place: '', locked: '', after: '' },
  ]
  const fx = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: { valuables } } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const gv = await readSheetGrid(await JSZip.loadAsync(out.bytes), HAZ12_SHEET)
    const at = (r: string) => gv.cells.find(x => x.ref === r)?.text ?? ''

    check('1행 4열 착지', at('O15') === '계약서류' && at('Z15') === '사무실 금고'
      && at('AM15') === '유' && at('AW15') === '차량 트렁크', `${at('O15')}/${at('AM15')}`)
    check('시건 미입력이면 빈 칸(무를 지어내지 않는다)', at('AM16').trim() === '', JSON.stringify(at('AM16')))
    check('3행도 착지(무는 무로)', at('O17') === '서버 백업디스크' && at('AM17') === '무',
      `${at('O17')}/${at('AM17')}`)
    check('넘친 물품을 센다', valuableRowOverflow(fx) === 1, `${valuableRowOverflow(fx)}건`)
    check('머리글이 온전하다', at('O14') === labelAt(HAZ12_SHEET, 'O14')
      && at('AM14') === labelAt(HAZ12_SHEET, 'AM14'), `${at('O14')}·${at('AM14')}`)
    /* 위험물 표(11~13행)와 서로 안 침범한다 — 같은 시트의 두 표 */
    check('위험물 표는 안 건드렸다(같은 시트 두 표 분리)', ['O11', 'X11', 'AG11'].every(c => at(c).trim() === ''))
  }
}

/* ══════════════════════ [30] 3.2 피난시설 세부 — 사각 ①류 셋째 ══════════════════════
 *  ⭐ 예시 행(3행)은 **행째** 남는다 — 층별·개수 축이 없어 부분 덮임이 거짓 쌍이 된다.
 *  ⚠ 상태는 양식에 열이 없어 세어진다 · 시설구분 상자는 추측 금지로 안 켠다. */
console.log('\n[30] 3.2 피난시설 세부 — 예시 행은 행째, 상자는 안 켠다')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, EVDET32_SHEET, EVDET32_ROWS, EVDET32_FIRST_ROW } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, evacDetailOverflow, evacDetailStatusUnmapped } =
    await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const evacDetail = [
    { facility: '옥내 계단', location: '중앙 코어', status: '양호' },
    { facility: '방화문', location: '각 층 계단실', status: '' },
    ...Array.from({ length: EVDET32_ROWS - 1 }, (_, i) => ({ facility: `시설${i}`, location: `${i}층`, status: '' })),
  ]
  const fx = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: { evacDetail } } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const gv = await readSheetGrid(await JSZip.loadAsync(out.bytes), EVDET32_SHEET)
    const at = (r: string) => gv.cells.find(x => x.ref === r)?.text ?? ''
    const R0 = EVDET32_FIRST_ROW

    check('데이터 행 수가 파생된다(12행)', EVDET32_ROWS === 12, `${EVDET32_ROWS}행`)
    check('1행이 4행(예시 다음)에 착지', at(`AF${R0}`) === '옥내 계단' && at(`AQ${R0}`) === '중앙 코어',
      `${at(`AF${R0}`)}/${at(`AQ${R0}`)}`)
    check('마지막 행(15)도 착지', at(`AF${R0 + 11}`) === `시설9`, at(`AF${R0 + 11}`))
    /* 🎯 예시 행이 행째 남는다 */
    check('예시 행(3행)이 온전하다', at('M3') === '3층~5층' && at('AF3') === '완강기'
      && at('AQ3') === '각 세대 베란다' && at('BA3') === '각 1개',
      `${at('M3')}/${at('AF3')}/${at('BA3')}`)
    /* 🚨 음성 — 시설구분 상자는 어느 행도 안 켠다(추측 금지) */
    check('시설구분 상자는 전부 미체크', Array.from({ length: EVDET32_ROWS }, (_, i) =>
      at(`T${R0 + i}`)).every(x => !x.includes('■')), at(`T${R0}`).slice(0, 12))
    check('동별·층별·개수는 비어 있다', [`E${R0}`, `M${R0}`, `BA${R0}`].every(c => at(c).trim() === ''))
    check('넘친 행을 센다', evacDetailOverflow(fx) === 1, `${evacDetailOverflow(fx)}건`)
    check('갈 곳 없는 상태를 센다', evacDetailStatusUnmapped(fx) === 1, `${evacDetailStatusUnmapped(fx)}건`)
    check('머리글이 온전하다', at('AF2') === labelAt(EVDET32_SHEET, 'AF2'), at('AF2'))
  }
}

/* ══════════════════════ [31] 개정이력 — 사각 ①류 넷째 · D-1의 답은 실측이었다 ══════════════════════
 *  ⭐ 검토·승인 칸도 배선한다 — 2.14 확인 칸(서명 자리·데이터 없음)과 달리 DB에 값이 있고
 *    PDF도 인쇄한다. 표기는 PDF와 **같은 값**(d.revisions — 조립기가 한 번 만든다). */
console.log('\n[31] 개정이력 — 11행 5열')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, REV_SHEET, REV_ROWS, REV_FIRST_ROW } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, revisionRowOverflow } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const revisions = Array.from({ length: REV_ROWS + 1 }, (_, i) => ({
    date: `2026-0${(i % 9) + 1}-10`, note: `개정 ${i}`, author: `작성${i}`,
    reviewer: i === 0 ? '김검토' : '', approver: i === 0 ? '이승인' : '',
  }))
  const fx = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: {}, revisions } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const gr = await readSheetGrid(await JSZip.loadAsync(out.bytes), REV_SHEET)
    const at = (r: string) => gr.cells.find(x => x.ref === r)?.text ?? ''
    const R0 = REV_FIRST_ROW

    check('행 수가 연번에서 파생된다(11행)', REV_ROWS === 11, `${REV_ROWS}행`)
    check('1행 5열 착지(검토·승인 포함)', at(`F${R0}`) === '2026-01-10' && at(`N${R0}`) === '개정 0'
      && at(`AL${R0}`) === '작성0' && at(`AT${R0}`) === '김검토' && at(`BA${R0}`) === '이승인',
      `${at(`F${R0}`)}/${at(`AT${R0}`)}/${at(`BA${R0}`)}`)
    check('검토·승인 미입력이면 빈 칸', at(`AT${R0 + 1}`).trim() === '' && at(`BA${R0 + 1}`).trim() === '')
    check('마지막 행(12)도 착지', at(`N${R0 + 10}`) === '개정 10', at(`N${R0 + 10}`))
    check('순번은 양식 그대로', at(`A${R0}`) === labelAt(REV_SHEET, `A${R0}`) && at(`A${R0 + 10}`) === '11')
    check('넘친 이력을 센다', revisionRowOverflow(fx) === 1, `${revisionRowOverflow(fx)}건`)
  }
}

/* ══════════════════════ [32] 2.4 개별임무카드 — 성명 칸만 채운다 ══════════════════════
 *  임무 문구는 양식이 전부 인쇄해 두었고 사람 이름만 비어 있었다. 팀 판정은 2.1·1.9와
 *  같은 술어(`teamStem`) — 「비상연락팀」도 「지휘반」식 어미도 어간으로 접힌다.
 *  ⚠ 초기대응체계 블록(58행)은 앵커도 값도 없다 — ERP에 그 축이 없다(2.14 확인 칸과 같은 판정). */
console.log('\n[32] 2.4 개별임무카드 — 성명 5칸')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, CARD24_SHEET, CARD24_CELLS } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  /* 🚨 어간 목록이 양식의 사본이 되지 않게 — 각 어간이 블록 머리 라벨에 실제로 있는가 */
  check('어간 5개가 블록 머리 라벨에 실제로 들어 있다',
    CARD24_CELLS.every(([, stem, labelCell]) => labelAt(CARD24_SHEET, labelCell).includes(stem)),
    CARD24_CELLS.map(([, s]) => s).join('·'))

  const brigade = [
    { team: '비상연락팀', name: '김연락' },
    { team: '초기소화팀', name: '박소화' }, { team: '초기소화반', name: '이진압' },
    { team: '피난유도팀', name: '최유도' },
    { team: '응급구조팀', name: '정구조' },
    { team: '자위소방대장', name: '총대장' }, // 어느 카드에도 안 실린다
  ]
  const fx = { buildingName: 'X', facilities: [], brigade, zones: [], hazards: [], forms: {} } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const { targets } = toInjectTargets(buildFirePlanValues(fx), vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const gr = await readSheetGrid(await JSZip.loadAsync(out.bytes), CARD24_SHEET)
    const at = (r: string) => gr.cells.find(x => x.ref === r)?.text ?? ''

    check('팀별 성명이 제 카드에 착지한다', at('W9') === '김연락' && at('W31') === '최유도'
      && at('W42') === '정구조', `${at('W9')}/${at('W31')}/${at('W42')}`)
    check('같은 어간(팀·반 어미)은 쉼표로 잇는다', at('W20') === '박소화, 이진압', at('W20'))
    check('대원 없는 팀(방호안전)은 빈 칸', at('W53').trim() === '', at('W53'))
    check('대장·부대장은 어느 카드에도 안 실린다',
      ['W9', 'W20', 'W31', 'W42', 'W53'].every(c => !at(c).includes('총대장')))
    /* 🚨 음성 — 초기대응체계 블록은 배선하지 않는다(축이 없다) */
    check('초기대응체계 성명 칸(W64)은 앵커가 없다',
      !FIRE_PLAN_ANCHORS.some(a => a.sheet === CARD24_SHEET && a.cell === 'W64') && at('W64').trim() === '')
    check('임무 문구는 양식 그대로다', at('A10') === labelAt(CARD24_SHEET, 'A10'), at('A10'))
  }
}

/* ══════════════════════ [33] 2.10 피난유도팀 — 기존 축 재사용 ══════════════════════
 *  「일괄 표준문구」가 아니었다 — 절차 두 칸은 2.13·3.4와 같은 원천(evacFalseAlarm·evacNote),
 *  비상방송설비 상자는 1.4 J15와 같은 집합. 핵심 단언은 개수가 아니라 **시트 간 항등**이다.
 *  ⚠ 안 켜는 것(모르면 안 켠다): 경보방식 3상자·주지구경종·시각경보기(1.4 입도 불일치)·
 *    피난안전구역·옥상·기타·확인사항·장비 표. */
console.log('\n[33] 2.10 피난유도팀 — 7슬롯 + 4상자')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, EVAC210_SHEET, EVAC210_ROUTE_CELLS, FP_SHEET } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, evac210RouteOverflow } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const fx = {
    buildingName: 'X', facilities: ['비상방송설비'], brigade: [], zones: [], hazards: [],
    forms: {}, evacRoutes: [
      { route: '동편 계단 → 1층 정문', floor: '전층' },
      { route: '서편 계단 → 지하 주차장 출구', floor: '전층' },
    ],
    assembly: '정문 앞 광장', evacFalseAlarm: '방송 확인 후 대기', evacNote: '유도자 지시로 피난',
    evacMethod: '낮은 자세로 최단 경로 이동',
  } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const vals = buildFirePlanValues(fx)
    const { targets } = toInjectTargets(vals, vc.anchors)
    const out = await injectWorkbook(bytes, targets)
    const zip2 = await JSZip.loadAsync(out.bytes)
    const gr = await readSheetGrid(zip2, EVAC210_SHEET)
    const at = (r: string) => gr.cells.find(x => x.ref === r)?.text ?? ''

    check('절차 두 칸이 착지한다', at('J23') === '방송 확인 후 대기' && at('J24') === '유도자 지시로 피난',
      `${at('J23')}/${at('J24')}`)
    /* 🎯 시트 간 항등 — 같은 원천을 나눠 쓰므로 값이 다를 방법이 없어야 한다 */
    check('2.13과 항등(비화재보·화재 시)', vals.get('resp13_false_alarm') === vals.get('evac210_false_alarm')
      && vals.get('resp13_fire') === vals.get('evac210_procedure'))
    check('방법·집결지가 착지한다', at('R13') === '낮은 자세로 최단 경로 이동' && at('R14') === '정문 앞 광장',
      `${at('R13')}/${at('R14')}`)
    check('경로 2건 — 상자 두 개 켜지고 서술이 실린다',
      at('R7').startsWith('■') && at('R8').startsWith('■')
      && at('AF7') === '동편 계단 → 1층 정문' && at('AF8') === '서편 계단 → 지하 주차장 출구',
      `${at('R7').slice(0, 6)}/${at('AF8')}`)
    check('셋째 경로 줄은 상자도 서술도 빈 채로', at('R9') === labelAt(EVAC210_SHEET, 'R9') && at('AF9').trim() === '')
    /* 1.4와 같은 집합 — 비상방송설비 J15가 켜져 있으면 2.10 AU6도 켜져 있다 */
    const g14 = await readSheetGrid(zip2, FP_SHEET.F1_4)
    const at14 = (r: string) => g14.cells.find(x => x.ref === r)?.text ?? ''
    check('1.4와 항등(비상방송설비)', at('AU6').startsWith('■') && at14('J15').startsWith('■'),
      `2.10=${at('AU6').slice(0, 2)} 1.4=${at14('J15').slice(0, 2)}`)
    /* 🚨 음성 — 모르는 것은 안 켠다·앵커도 없다 */
    const noAnchor = (cell: string) => !FIRE_PLAN_ANCHORS.some(a => a.sheet === EVAC210_SHEET && a.cell === cell)
    check('경보방식·주지구경종·시각경보기는 앵커가 없고 미체크',
      ['R4', 'AF4', 'AF5', 'R6', 'AF6'].every(c => noAnchor(c) && at(c) === labelAt(EVAC210_SHEET, c)))
    check('피난안전구역·옥상·기타·확인사항·장비 표는 앵커가 없다',
      ['R10', 'R11', 'R12', 'AF10', 'R15', 'A18', 'M19', 'AW20'].every(noAnchor))
    check('넘친 경로를 센다(3줄 예산)', evac210RouteOverflow({ evacRoutes: [1, 2, 3, 4] } as never) === 1
      && evac210RouteOverflow(fx) === 0)
    check('경로 상자 라벨 자구가 온전하다', EVAC210_ROUTE_CELLS.every(([box], i) =>
      labelAt(EVAC210_SHEET, box).includes(`제${i + 1}피난로`)))
  }
}

/* ══════════════════════ [34] 2.9 초기소화팀 — 예시문칸 3 + 취약장소 3행 ══════════════════════
 *  AC6·AC7(초기소화방법)·AC9(가스 조치)는 PDF 「초기대응 개요」의 teamTextOr 폴백 문구와
 *  같은 자구가 인쇄돼 있다 — 값(brigadeTeams)이 있으면 덮고, 없으면 예시가 남는데 그게 곧
 *  PDF의 폴백이라 두 산출물이 같은 것을 인쇄한다. 취약장소는 1.2.2와 같은 축(hazards). */
console.log('\n[34] 2.9 초기소화팀 — 예시문칸 3 + 취약장소 6칸')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, EXT29_SHEET, HAZ29_ROWS } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, haz29Overflow } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const hazards = [
    { place: '보일러실', location: '지하 1층', factors: [] },
    { place: '옥상 창고', location: '옥탑', factors: [] }, // 1.2.2 고정 3개소 밖 — 여긴 실린다
  ]
  const base = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards, forms: {} }

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    /* ① 값이 있으면 덮는다 — 층수·1.6.1 축도 함께 실어 상자 6개의 켜짐을 본다 */
    const withTeams = { ...base, floorsAbove: 30, floorsBelow: 1, forms: {
      brigadeTeams: { extinguish: '옥내소화전 우선 사용', protect: '중간밸브 잠금 후 환기' },
      etcFacility: { electric: { kw: '350' }, gas: { kind: 'LPG' }, hazmat: { none: false, items: [{ name: '유류' }] } },
    } } as never
    const out1 = await injectWorkbook(bytes, toInjectTargets(buildFirePlanValues(withTeams), vc.anchors).targets)
    const g1 = await readSheetGrid(await JSZip.loadAsync(out1.bytes), EXT29_SHEET)
    const at1 = (r: string) => g1.cells.find(x => x.ref === r)?.text ?? ''
    check('입력이 있으면 예시를 덮는다(지상·지하·가스)',
      at1('AC6') === '옥내소화전 우선 사용' && at1('AC7') === '옥내소화전 우선 사용'
      && at1('AC9') === '중간밸브 잠금 후 환기', `${at1('AC6')}/${at1('AC9')}`)
    check('취약장소가 목록 순서대로 실린다(고정 3개소 밖 장소 포함)',
      at1('O13') === '보일러실' && at1('V13') === '지하 1층'
      && at1('O14') === '옥상 창고' && at1('V14') === '옥탑', `${at1('O14')}/${at1('V14')}`)
    check('셋째 행은 빈 채로', at1('O15').trim() === '' && at1('V15').trim() === '')

    /* ② 값이 없으면 예시가 남고, 그 예시가 곧 PDF 폴백 문구다(BRIGADE_TEAMS.preset) */
    const out2 = await injectWorkbook(bytes, toInjectTargets(buildFirePlanValues(base as never), vc.anchors).targets)
    const g2 = await readSheetGrid(await JSZip.loadAsync(out2.bytes), EXT29_SHEET)
    const at2 = (r: string) => g2.cells.find(x => x.ref === r)?.text ?? ''
    check('입력이 없으면 예시가 남는다', at2('AC6') === labelAt(EXT29_SHEET, 'AC6')
      && at2('AC9') === labelAt(EXT29_SHEET, 'AC9'))
    /* ⭐ 「남은 예시 = PDF 초기대응 개요 폴백」 항등은 blanks [8]에 있다 — 템플릿이
     *   server-only라 이 검사(비 react-server)에선 렌더할 수 없다. */

    /* ⭐ 층별·시설별 상자 6 — 파생 검증 완료(2026-09-18 둘째). ①에서 전부 켜지고
     *   ②(층수 null·etcFacility 없음)에선 전부 미체크여야 한다(모르면 안 켠다). */
    check('층별·시설별 상자 6이 전부 켜진다(고층 30층 경계 포함)',
      ['O5', 'O6', 'O7', 'O8', 'O9', 'O10'].every(c => at1(c).includes('■')),
      ['O5', 'O6', 'O7', 'O8', 'O9', 'O10'].map(c => at1(c).slice(0, 2)).join(''))
    check('층수 null·시설 미입력이면 상자 6 전부 미체크',
      ['O5', 'O6', 'O7', 'O8', 'O9', 'O10'].every(c => at2(c) === labelAt(EXT29_SHEET, c)))

    /* 🚨 음성 — 축 없는 칸·검증 전 파생은 앵커를 두지 않는다 */
    const noAnchor = (cell: string) => !FIRE_PLAN_ANCHORS.some(a => a.sheet === EXT29_SHEET && a.cell === cell)
    check('고층·전기·기타 방법과 위험물 조치는 앵커가 없다', ['AC5', 'AC8', 'AC10', 'AC11'].every(noAnchor))
    check('기타 상자·절차·장비 표는 앵커가 없다',
      ['O11', 'L23', 'L24', 'O18', 'AC13'].every(noAnchor))
    check('넘친 취약장소를 센다(3행 예산)', haz29Overflow({ hazards: [1, 2, 3, 4] } as never) === 1
      && haz29Overflow(base as never) === 0)
    check('취약장소 표 행이 파생 상수와 같다(13~15행)', HAZ29_ROWS.length === 3 && HAZ29_ROWS[0] === 13)
  }
}

/* ══════════════════════ [35] 2.6·2.8 설비 파생 상자 + 팀별 대상명 ══════════════════════
 *  비상방송설비·자동화재속보설비는 설비가 자동으로 수행하는 전파(건물 내 방송·소방서 자동
 *  통보)라 설비 존재 = 그 방법의 가용 — 1.4·2.10과 같은 집합(d.facilities)으로 켠다.
 *  운영 방식 상자(유선·SMS 등)와 비상상황 종류 상자는 ERP가 모르므로 안 켠다. */
console.log('\n[35] 2.6·2.8 설비 파생 상자 4 + 대상명 4')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, CONTACT26_SHEET, ALERT28_SHEET, EXT29_SHEET, EVAC210_SHEET, RESCUE211_SHEET } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const render = async (facilities: string[]) => {
      const fx = { buildingName: '가온빌딩', facilities, brigade: [], zones: [], hazards: [], forms: {} } as never
      const out = await injectWorkbook(bytes, toInjectTargets(buildFirePlanValues(fx), vc.anchors).targets)
      const zip3 = await JSZip.loadAsync(out.bytes)
      const g26 = await readSheetGrid(zip3, CONTACT26_SHEET)
      const g28 = await readSheetGrid(zip3, ALERT28_SHEET)
      return { at26: (r: string) => g26.cells.find(x => x.ref === r)?.text ?? '',
        at28: (r: string) => g28.cells.find(x => x.ref === r)?.text ?? '', zip3 }
    }
    const on = await render(['비상방송설비', '자동화재속보설비'])
    check('설비가 있으면 네 상자가 켜진다(2.6 Q10·Q13 + 2.8 K6·K8)',
      on.at26('Q10').includes('■') && on.at26('Q13').includes('■')
      && on.at28('K6').includes('■') && on.at28('K8').includes('■'),
      `${on.at26('Q10').slice(0, 2)}/${on.at28('K8').slice(0, 2)}`)
    check('대상명이 접두라벨 뒤에 붙는다(2.6·2.11)',
      on.at26('A2').includes('가온빌딩') && (await (async () => {
        const g11 = await readSheetGrid(on.zip3, RESCUE211_SHEET)
        const g29 = await readSheetGrid(on.zip3, EXT29_SHEET)
        const g10 = await readSheetGrid(on.zip3, EVAC210_SHEET)
        return [g11, g29, g10].every(g => (g.cells.find(x => x.ref === 'A2')?.text ?? '').includes('가온빌딩'))
      })()), on.at26('A2'))
    /* 🚨 음성 — 설비가 없으면 하나도 안 켠다(반쪽 켜짐도 잡는다) */
    const off = await render([])
    check('설비가 없으면 네 상자 전부 미체크',
      off.at26('Q10') === labelAt(CONTACT26_SHEET, 'Q10') && off.at26('Q13') === labelAt(CONTACT26_SHEET, 'Q13')
      && off.at28('K6') === labelAt(ALERT28_SHEET, 'K6') && off.at28('K8') === labelAt(ALERT28_SHEET, 'K8'))
    /* 🚨 음성 — 운영 방식·비상상황 종류·수기작성 표엔 앵커가 없다 */
    const noAnchor = (sheet: string, cells: string[]) =>
      cells.every(c => !FIRE_PLAN_ANCHORS.some(a => a.sheet === sheet && a.cell === c))
    check('운영 방식 상자(유선·SMS·모바일·App·기타)는 앵커가 없다',
      noAnchor(CONTACT26_SHEET, ['Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q12', 'Q15']))
    check('비상상황 종류·SMS·안내문구·비상연락망은 앵커가 없다',
      noAnchor(ALERT28_SHEET, ['K3', 'S3', 'AB3', 'AK3', 'AW3', 'K4', 'K10', 'K5', 'K7', 'K9'])
      && noAnchor(CONTACT26_SHEET, ['A19', 'L19', 'X19', 'J24', 'J25']))
  }
}

/* ══════════════════════ [36] 1.14.1 화재예방·홍보 계획 — ④ 넷째 축 promoPlan ══════════════════════
 *  방법 10종 × 12월 격자(1.11.1과 같은 무늬). 방법 목록은 화면과 한 벌(promo-plan-methods) —
 *  라벨 사본은 anchors 적재 대조가 검증한다(어긋나면 이 검사 전체가 모듈 로드에서 죽는다). */
console.log('\n[36] 1.14.1 월 격자 120상자')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, PROMO_SHEET, PROMO_ROWS, PROMO_MONTH_COLS } =
    await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  check('방법 10종이 6~15행에 순서대로 적재됐다(자구 대조는 적재 시 throw)',
    PROMO_ROWS.length === 10 && PROMO_ROWS[0].row === 6 && PROMO_ROWS[9].row === 15
    && PROMO_ROWS[9].key === 'etc')

  const fx = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: { promoPlan: { poster: [3, 7], etc: [12] } } } as never
  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const out = await injectWorkbook(bytes, toInjectTargets(buildFirePlanValues(fx), vc.anchors).targets)
    const gr = await readSheetGrid(await JSZip.loadAsync(out.bytes), PROMO_SHEET)
    const at = (r: string) => gr.cells.find(x => x.ref === r)?.text ?? ''
    const poster = PROMO_ROWS.find(r => r.key === 'poster')!
    const etc = PROMO_ROWS.find(r => r.key === 'etc')!

    check('입력한 월만 켜진다(포스터 3·7월)',
      at(`${PROMO_MONTH_COLS[2]}${poster.row}`).includes('■') && at(`${PROMO_MONTH_COLS[6]}${poster.row}`).includes('■')
      && !at(`${PROMO_MONTH_COLS[0]}${poster.row}`).includes('■') && !at(`${PROMO_MONTH_COLS[11]}${poster.row}`).includes('■'))
    check('기타 행도 제 월에 켜진다(12월)', at(`${PROMO_MONTH_COLS[11]}${etc.row}`).includes('■'))
    /* 🚨 음성 — 미입력 방법은 전 월 ☐(임의 월을 지어내지 않는다 — 1.11.1 M-7과 같은 계약) */
    const video = PROMO_ROWS.find(r => r.key === 'video')!
    check('미입력 방법은 전 월 미체크', PROMO_MONTH_COLS.every(col =>
      at(`${col}${video.row}`) === labelAt(PROMO_SHEET, `${col}${video.row}`)))
    /* 🚨 음성 — 보관방법·안내 상자는 축이 없어 앵커를 두지 않는다 */
    const noAnchor = (cell: string) => !FIRE_PLAN_ANCHORS.some(a => a.sheet === PROMO_SHEET && a.cell === cell)
    check('보관방법 상자 4 + ※ 안내는 앵커가 없다', ['R16', 'AO16', 'R17', 'AO17', 'AE3'].every(noAnchor))
  }
}

/* ══════════════════════ [37] 1.15 화재발생개요 — 최신 「화재」 1건 ══════════════════════
 *  1.10.4와 같은 원천(forms.fireHistory)의 화재 건 중 최신 1건. 비화재보는 걸러진다.
 *  발화열원·발화요인(Z13·Z14)은 세분 축이 없어 비운다 — cause는 발화개요(Z15) 전문. */
console.log('\n[37] 1.15 화재발생개요 4칸')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, FIRE115_SHEET } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues, fire115Overflow } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const fireHistory = [
    { kind: '화재', at: '2025-03-01', place: '지하 기계실', cause: '노후 배선 단락', action: '차단기 교체' },
    { kind: '비화재보', at: '2026-05-05', place: '2층 복도', cause: '조리 연기', action: '환기' },
    { kind: '화재', at: '2026-01-15', place: '옥상 창고', cause: '담뱃불 추정', action: '소화기 진압' },
  ]
  const fx = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: { fireHistory } } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const out = await injectWorkbook(bytes, toInjectTargets(buildFirePlanValues(fx), vc.anchors).targets)
    const gr = await readSheetGrid(await JSZip.loadAsync(out.bytes), FIRE115_SHEET)
    const at = (r: string) => gr.cells.find(x => x.ref === r)?.text ?? ''

    check('최신 「화재」 건이 착지한다(비화재보가 더 최근이어도 걸러진다)',
      at('R11') === '2026-01-15' && at('R12') === '옥상 창고' && at('Z15') === '담뱃불 추정',
      `${at('R11')}/${at('R12')}/${at('Z15')}`)
    check('가스안전공사 번호가 실린다', at('Z6') === '1544-4500', at('Z6'))
    check('넘친 화재를 센다(단일 사건 서식)', fire115Overflow(fx) === 1
      && fire115Overflow({ forms: { fireHistory: [] } } as never) === 0)
    /* 🚨 음성 — 화재 이력이 없으면 개요는 빈 채로(지어내지 않는다) */
    const out0 = await injectWorkbook(bytes, toInjectTargets(
      buildFirePlanValues({ buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [], forms: {} } as never),
      vc.anchors).targets)
    const g0 = await readSheetGrid(await JSZip.loadAsync(out0.bytes), FIRE115_SHEET)
    const at0 = (r: string) => g0.cells.find(x => x.ref === r)?.text ?? ''
    check('화재 이력이 없으면 개요는 빈 채로', at0('R11').trim() === '' && at0('R12').trim() === ''
      && at0('Z15').trim() === '')
    /* 🚨 음성 — 세분 축 없는 칸·축 없는 칸은 앵커를 두지 않는다 */
    const noAnchor = (cell: string) => !FIRE_PLAN_ANCHORS.some(a => a.sheet === FIRE115_SHEET && a.cell === cell)
    check('발화열원·발화요인·승강기 연락처·예방대책·피해상황은 앵커가 없다',
      ['Z13', 'Z14', 'Z8', 'J18', 'AI16', 'AZ16', 'Z16', 'AR16'].every(noAnchor))
    check('개요 라벨 자구가 온전하다', labelAt(FIRE115_SHEET, 'J11').includes('일') && at('J13') === labelAt(FIRE115_SHEET, 'J13'))
  }
}

/* ══════════════════════ [38] 1.11.4 뒷쪽 — 소방교육 결과 (사각 ①류 다섯째) ══════════════════════
 *  training.records(1.11 입력·PDF recordRows 인쇄)의 「교육」 건 중 최신 1건. */
console.log('\n[38] 1.11.4 뒷쪽 소방교육 결과 4칸')
{
  const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
  const { toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
  const { FIRE_PLAN_ANCHORS, REC1114_SHEET } = await import('../src/lib/fire-plan-anchors.ts')
  const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')
  const { labelAt } = await import('../src/lib/fire-plan-xlsx-manifest.ts')

  const records = [
    { at: '2025-11-05', kind: '교육', attendees: '18', content: '옛 교육 내용', evaluation: '옛 성과' },
    { at: '2026-06-10', kind: '훈련', attendees: '30', content: '훈련은 안 실린다', evaluation: '' },
    { at: '2026-04-02', kind: '교육', attendees: '25', content: '심폐소생술 실습', evaluation: '전원 실습 완료' },
  ]
  const fx = { buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [],
    forms: { training: { records, eduMonths: [], drillMonths: [] } } } as never

  const vc = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
  if (vc.ok) {
    const out = await injectWorkbook(bytes, toInjectTargets(buildFirePlanValues(fx), vc.anchors).targets)
    const gr = await readSheetGrid(await JSZip.loadAsync(out.bytes), REC1114_SHEET)
    const at = (r: string) => gr.cells.find(x => x.ref === r)?.text ?? ''

    check('최신 「교육」 건이 착지한다(더 최근 훈련은 걸러진다)',
      at('I3') === '2026-04-02' && at('AI5').startsWith('25') && at('I6') === '심폐소생술 실습'
      && at('I7') === '전원 실습 완료', `${at('I3')}/${at('AI5')}/${at('I7')}`)
    /* 🚨 음성 — 기록이 없으면 예시가 남고 일시·참석은 빈 채로 */
    const out0 = await injectWorkbook(bytes, toInjectTargets(
      buildFirePlanValues({ buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [], forms: {} } as never),
      vc.anchors).targets)
    const g0 = await readSheetGrid(await JSZip.loadAsync(out0.bytes), REC1114_SHEET)
    const at0 = (r: string) => g0.cells.find(x => x.ref === r)?.text ?? ''
    check('기록 없으면 일시 빈 칸·내용은 법정 예시 그대로',
      at0('I3').trim() === '' && at0('I6') === labelAt(REC1114_SHEET, 'I6') && at0('I7') === labelAt(REC1114_SHEET, 'I7'))
    const noAnchor = (cell: string) => !FIRE_PLAN_ANCHORS.some(a => a.sheet === REC1114_SHEET && a.cell === cell)
    check('강사·대상·미참석·문제점·개선·사진은 앵커가 없다',
      ['I5', 'V5', 'AV5', 'I8', 'I9', 'A11', 'A13', 'AB11', 'AB13'].every(noAnchor))
  }
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
