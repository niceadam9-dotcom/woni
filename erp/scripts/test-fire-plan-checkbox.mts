/** 소방계획서 엑셀 — 클릭 가능한 양식 컨트롤 체크박스 검사.
 *
 *  두 층을 **따로** 묻는다.
 *   [A] 순수 계층 — manifest만 보고 「어느 칸에 다는가」. 제외 규칙이 밀리면 여기가 먼저 붉어진다.
 *   [B] 적용 계층 — 실제 템플릿에 달았을 때 파트·순서·글자가 어떻게 되는가.
 *
 *  ⚠ 이 검사는 **Excel이 받아들이는가**를 묻지 못한다(노드에는 Excel이 없다).
 *    그 축은 `_verify-checkbox-excel.ps1`이 실제 Excel COM으로 따로 본다 — 여기서 초록이라고
 *    「엑셀에서 열린다」고 말하면 안 된다. 순서 위반은 **LibreOffice는 통과하고 Excel만** 문다.
 *
 *  🚨 2026-09-14 확대(1.4 40칸 → 전 워크북 582칸)로 **새로 생긴 위험**이 있고, 그 축들이
 *    [B-5]다: 시트가 28장이면 VML 파트도 28개고 ctrlProp은 582개다. 번호가 한 번이라도
 *    겹치면 **파트가 서로 덮어써** 엉뚱한 시트의 체크 상태가 나타난다. 한 시트만 볼 때는
 *    존재하지 않던 결함이라, 확대와 **함께** 단언을 만들었다.
 *
 *  실행: npx tsx scripts/test-fire-plan-checkbox.mts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { applyFirePlanCheckboxes, firePlanCheckboxCells, CHECKBOX_SHEETS } from '../src/lib/fire-plan-checkbox-controls.ts'
import { FIRE_PLAN_MANIFEST, labelAt, sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { classifyAlign } from '../src/lib/fire-plan-align.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const XLSX_PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')
const S14 = '1.4 소방시설 현황'
/** 확대 기대치 — 실측으로 못 박는다(추정 금지). 규칙이 느슨해지면 이 수부터 움직인다. */
const TOTAL = 582
const SHEETS_WITH = 28

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

const bytes = new Uint8Array(readFileSync(XLSX_PATH))
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const cellText = (xml: string, ref: string): string | null => {
  const m = new RegExp(`<c r="${ref}"((?:[^>/]|/(?!>))*)>([\\s\\S]*?)</c>`).exec(xml)
  if (!m) return null
  return unesc([...m[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))
}
const colNum = (t: string) => [...t].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1

/* ━━━━━━━━━━━━━━━━━━ [A] 순수 계층 — 어느 칸에 다는가 ━━━━━━━━━━━━━━━━━━ */
console.log('\n[A] 대상 선정 (manifest만으로)')
const cells14 = firePlanCheckboxCells(S14)
const refs14 = new Set(cells14.map(c => c.cell))

check('1.4 대상 40칸', cells14.length === 40, `${cells14.length}칸`)
check('J3(소화기구)이 대상이다 — 양성', refs14.has('J3'))
const j3 = cells14.find(c => c.cell === 'J3')!
check('J3 좌표 col=9 row0=2', j3?.col === 9 && j3?.row0 === 2, `col=${j3?.col} row0=${j3?.row0}`)

// 🚨 이 셋이 음성 축이다. 하나라도 대상에 들어오면 산문·다중상자에 컨트롤이 박힌다.
check('AJ2(※ 안내문장)는 대상이 아니다 — 산문이지 체크박스가 아니다', !refs14.has('AJ2'),
  JSON.stringify(labelAt(S14, 'AJ2')))
check('R16(상자 5개)은 대상이 아니다', !refs14.has('R16'))
check('R17(상자 3개)은 대상이 아니다', !refs14.has('R17'))

// 대상 칸은 전부 「상자 1개·맨 앞·한 줄」이어야 한다 — 규칙과 결과를 따로 물어 서로를 물게 한다
const badRule = cells14.filter(c => {
  const t = labelAt(S14, c.cell)
  return (t.match(/[□☐]/g) ?? []).length !== 1 || !/^[□☐]/.test(t.trim()) || t.includes('\n')
})
check('대상 40칸 전부가 규칙을 만족', badRule.length === 0, badRule.map(c => c.cell).join(' '))

// 법정 불릿은 상자가 아니다 — 전 시트에서 한 칸도 대상에 들면 안 된다
let bulletHit = 0, totalEligible = 0
const perSheetEligible = new Map<string, number>()
for (const s of FIRE_PLAN_MANIFEST.sheets) {
  const bullets = new Set(Object.keys(s.bulletCells ?? {}))
  const picked = firePlanCheckboxCells(s.name)
  totalEligible += picked.length
  if (picked.length) perSheetEligible.set(s.name, picked.length)
  for (const c of picked) if (bullets.has(c.cell)) bulletHit++
}
check('법정 불릿(bulletCells)이 대상에 섞이지 않는다 — 전 시트', bulletHit === 0, `${bulletHit}칸`)
// 전 워크북 적격 수를 못 박는다: 제외 규칙이 느슨해지면 이 수가 올라가며 먼저 붉어진다
check(`전 워크북 적격 ${TOTAL}칸(규칙 드리프트 감시)`, totalEligible === TOTAL, `${totalEligible}칸`)

console.log('\n[A-2] 확대 전제 — 「왼쪽 끝에 앉힌다」가 규칙으로 보장되는가')
// 🚨 컨트롤은 칸의 **왼쪽 끝**에 선다. 그 가정은 우연이 아니라 생성기 규칙 ②(체크 글리프 선두 → 좌)의
//    결과다. 두 술어(적격 판정 · 정렬 판정)를 여기서 **결합**해 둔다 — 한쪽이 바뀌면 즉시 붉어진다.
//    이 단언이 없으면 정렬 규칙만 조용히 바뀌어 582개 컨트롤이 전부 상자에서 떨어져 나간다.
let notLeft = 0
const notLeftEx: string[] = []
for (const [sheet] of perSheetEligible) {
  for (const c of firePlanCheckboxCells(sheet)) {
    if (classifyAlign(labelAt(sheet, c.cell)) !== 'left') {
      notLeft++
      if (notLeftEx.length < 4) notLeftEx.push(`${sheet}!${c.cell}`)
    }
  }
}
check('적격 칸은 전부 classifyAlign=left (적격 ⇒ 좌정렬)', notLeft === 0, notLeftEx.join(' '))
// 음성 짝 — 이 결합이 **아무나 통과시키는 항진명제**가 아님을 보인다(가운데 정렬 칸이 실재한다)
check('음성 짝: 가운데 정렬 라벨이 실재한다(단언이 공허하지 않다)',
  classifyAlign('소화기구') === 'center')

/* ━━━━━━━━━━━━━━━━━━ [B] 적용 계층 — 실제 파일 ━━━━━━━━━━━━━━━━━━ */
console.log('\n[B] 적용 — 템플릿(전부 미체크) · 전 워크북')
const off = await applyFirePlanCheckboxes(bytes)
check(`${TOTAL}개 적용·미적용 0`, off.applied === TOTAL && off.skipped.length === 0,
  `applied=${off.applied} skipped=${off.skipped.length} ${off.skipped.slice(0, 4).join(' ')}`)

const zOff = await JSZip.loadAsync(off.bytes)
const names = Object.keys(zOff.files)
check(`vmlDrawing 파트 ${SHEETS_WITH}개(컨트롤 실린 시트 수와 같다)`,
  names.filter(n => /^xl\/drawings\/vmlDrawing\d+\.vml$/.test(n)).length === SHEETS_WITH,
  `${names.filter(n => /^xl\/drawings\/vmlDrawing\d+\.vml$/.test(n)).length}개`)
check(`ctrlProps 파트 ${TOTAL}개`,
  names.filter(n => /^xl\/ctrlProps\/ctrlProp\d+\.xml$/.test(n)).length === TOTAL,
  `${names.filter(n => /^xl\/ctrlProps\/ctrlProp\d+\.xml$/.test(n)).length}개`)
check('시트 rels 생성(1.4)', names.includes('xl/worksheets/_rels/sheet8.xml.rels'))

const ctOff = await zOff.file('[Content_Types].xml')!.async('string')
check('Content_Types: vml Default', /Extension="vml"/.test(ctOff))
check(`Content_Types: ctrlProp Override ${TOTAL}건`,
  (ctOff.match(/controlproperties\+xml/g) ?? []).length === TOTAL,
  `${(ctOff.match(/controlproperties\+xml/g) ?? []).length}건`)

const sh8 = await zOff.file('xl/worksheets/sheet8.xml')!.async('string')
// 🚨 **루트 태그만** 본다. 시트 전체에 대고 물으면 `<controls>` 블록이 제 안에 인라인으로 들고 있는
//    `xmlns:mc`에 걸려, 루트에서 빠져도 초록이 된다(변이 실험에서 실제로 뚫렸다).
const sh8Root = /<worksheet[^>]*>/.exec(sh8)![0]
check('루트 태그에 xdr namespace', /xmlns:xdr=/.test(sh8Root))
check('루트 태그에 x14 namespace', /xmlns:x14=/.test(sh8Root))
check('루트 태그에 mc namespace', /xmlns:mc=/.test(sh8Root))
check('legacyDrawing·controls 존재', sh8.includes('<legacyDrawing') && sh8.includes('<controls>'))
// 🚨 순서 축. pageSetup 뒤여야 한다 — 어기면 Excel만 복구 대화상자를 띄운다
check('CT_Worksheet 순서: pageSetup < legacyDrawing < controls',
  sh8.indexOf('<pageSetup') < sh8.indexOf('<legacyDrawing')
  && sh8.indexOf('<legacyDrawing') < sh8.indexOf('<controls>'))
check('1.4 control 요소 40개(시트별 수는 확대해도 그대로)', (sh8.match(/<control shapeId=/g) ?? []).length === 40)
// 사진 단계가 `<drawing>`을 끼울 자리(legacyDrawing 앞)가 실제로 있는지 — 배선 전제를 단언한다
check('사진 단계가 <drawing>을 끼울 앵커(<legacyDrawing)가 있다', sh8.includes('<legacyDrawing'))

// 🚨 눈으로 먼저 잡은 결함의 단언 — 「피난기구」(J16:Q17)는 **두 행에 걸친 병합**이다.
//    컨트롤을 첫 행에만 걸면 글자는 병합 전체의 가운데, 컨트롤은 첫 행의 가운데에 서서 떠 보인다.
//    수치 검사(칸 좌상단 ≤1pt)는 이걸 **통과시켰다** — 렌더가 잡았다. 그래서 여기 못 박는다.
const vmlOf = async (z: JSZip, sheetPart: string): Promise<string> => {
  const rels = await z.file(sheetPart.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels'))!.async('string')
  const xml = await z.file(sheetPart)!.async('string')
  const rid = /<legacyDrawing r:id="([^"]+)"/.exec(xml)![1]
  const target = new RegExp(`<Relationship Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)![1]
  return z.file('xl/' + target.replace(/^\.\.\//, ''))!.async('string')
}
const vmlOff = await vmlOf(zOff, 'xl/worksheets/sheet8.xml')
const anchorOf = (vml: string, shapeIdx: number) =>
  [...vml.matchAll(/<x:Anchor>([^<]*)<\/x:Anchor>/g)][shapeIdx]?.[1]?.split(',').map(s => Number(s.trim()))
// 🔁 아래 모서리 표기가 바뀌었다(2026-09-14): 「다음 행의 꼭대기(to=17, off=0)」 → 「마지막 덮는
//    행 + 그 행 높이(to=16, off=행높이)」. **같은 자리**를 가리키지만 끝 행 번호가 하나 작다.
//    계약 자체(「병합 끝 행까지 덮는다」)는 그대로이므로 단언을 지우지 않고 **새 표기로 옮긴다**.
const j16At = cells14.findIndex(c => c.cell === 'J16')
check('J16이 대상에 있다(전제)', j16At >= 0)
const a16 = anchorOf(vmlOff, j16At)!
check('J16 앵커가 병합 끝 행(17)을 덮는다 — to행=16 + 그 행 높이 오프셋',
  a16[6] === 16 && a16[7] > 0, `to행=${a16[6]} off=${a16[7]}`)
const a3 = anchorOf(vmlOff, cells14.findIndex(c => c.cell === 'J3'))!
check('J3(한 행 병합)은 자기 행 하나만 — 음성 짝', a3[6] === 2 && a3[7] > 0, `to행=${a3[6]} off=${a3[7]}`)
check('controls 블록의 끝 행·오프셋도 VML과 같다',
  new RegExp(`<xdr:row>16</xdr:row><xdr:rowOff>${a16[7] * 9525}</xdr:rowOff></to>`).test(sh8))
// 🔁 폭 결합을 **되살린다**. 종전엔 `<to><xdr:col>11</xdr:col>` 리터럴이 이 축을 우연히 물고
//    있었는데, 위 단언을 새 표기로 옮기며 그 결합이 사라졌다(변이 「컨트롤 폭 2열 → 0열」이
//    초록으로 뚫렸다 — 변이가 내 검사의 회귀를 잡은 것이다). 이번엔 **폭 자체**를 묻는다.
check('J16 controls 블록의 끝 열이 시작+2 (폭 2열)',
  new RegExp(`<to><xdr:col>${a16[0] + 2}</xdr:col><xdr:colOff>0</xdr:colOff>`).test(sh8), `from열=${a16[0]}`)

console.log('\n[B-2] 글자 — 상자만 사라지고 법정 문구는 남는가 (전 워크북)')
// 워크북 시트명 → sheetN.xml
const wb = await zOff.file('xl/workbook.xml')!.async('string')
const wbRels = await zOff.file('xl/_rels/workbook.xml.rels')!.async('string')
const relTarget = new Map<string, string>()
for (const m of wbRels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relTarget.set(m[1], m[2])
const sheetPart = new Map<string, string>()
for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const t = relTarget.get(m[2])
  if (t) sheetPart.set(unesc(m[1]), 'xl/' + t.replace(/^\/?xl\//, ''))
}

let glyphLeft = 0, wordingBroken = 0, checkedCells = 0
const brokenEx: string[] = []
for (const [sheet] of perSheetEligible) {
  const xml = await zOff.file(sheetPart.get(sheet)!)!.async('string')
  for (const c of firePlanCheckboxCells(sheet)) {
    const now = cellText(xml, c.cell) ?? ''
    if (/[□☐■☑▣]/.test(now)) glyphLeft++
    // 전각 공백을 원래 상자 글자로 되돌리면 manifest 라벨과 **글자 단위로** 같아야 한다
    const restored = now.replace('　', sheetManifest(sheet).boxes[c.cell])
    if (restored !== labelAt(sheet, c.cell)) {
      wordingBroken++
      if (brokenEx.length < 4) brokenEx.push(`${sheet}!${c.cell}`)
    }
    checkedCells++
  }
}
check(`전 워크북 ${TOTAL}칸을 대조했다(공허 통과 방지)`, checkedCells === TOTAL, `${checkedCells}칸`)
check(`${TOTAL}칸 모두 상자 글자가 사라졌다`, glyphLeft === 0, `${glyphLeft}칸 잔존`)
check(`${TOTAL}칸 모두 법정 문구가 글자 단위로 보존`, wordingBroken === 0, `${wordingBroken}칸 훼손 ${brokenEx.join(' ')}`)

// 음성 축: 대상이 아닌 칸은 **건드리지 않았다**. 확대 뒤에도 부적격 칸은 `□` 글자 그대로다
//  — 이것이 지금의 「미적용 범위」이고, 퇴행이 아니라 **의도된 잔여**다(다중상자·산문·여러 줄 76칸).
check('AJ2(안내문장) 원문 그대로', cellText(sh8, 'AJ2') === labelAt(S14, 'AJ2'))
check('R16(상자 5개) 원문 그대로', cellText(sh8, 'R16') === labelAt(S14, 'R16'))
let residual = 0
for (const s of FIRE_PLAN_MANIFEST.sheets) {
  const part = sheetPart.get(s.name)
  if (!part) continue
  const eligible = new Set(firePlanCheckboxCells(s.name).map(c => c.cell))
  const xml = await zOff.file(part)!.async('string')
  for (const cell of Object.keys(s.boxes)) {
    if (eligible.has(cell)) continue
    if (/[□☐]/.test(cellText(xml, cell) ?? '')) residual++
  }
}
check('부적격 76칸은 상자 글자가 그대로 남아 있다(의도된 미적용 · 종전 「1.4 밖은 전부 남는다」의 승계 계약)',
  residual === 658 - TOTAL, `${residual}칸 (기대 ${658 - TOTAL})`)

// 미체크 파일에는 checked 표시가 한 건도 없어야 한다
check('미체크: VML에 x:Checked 0건 (1.4)', !vmlOff.includes('<x:Checked>'))
let ctrlOn = 0
for (let i = 1; i <= TOTAL; i++) if ((await zOff.file(`xl/ctrlProps/ctrlProp${i}.xml`)!.async('string')).includes('checked="Checked"')) ctrlOn++
check(`미체크: ctrlProp ${TOTAL}개 전부 checked 0건`, ctrlOn === 0, `${ctrlOn}건`)

console.log('\n[B-3] 체크 상태가 주입된 글을 따라가는가 (양성 짝)')
// 주입이 `■`를 적은 칸만 켜져야 한다. 켜짐·꺼짐을 **한 파일 안에서** 함께 본다.
const ON = ['J3', 'J5', 'AJ7', 'J19']
const injected = await injectWorkbook(bytes, ON.map(cell => ({
  sheet: S14, cell, value: labelAt(S14, cell).replace(/[□☐]/, '■'),
})))
check('주입 미착지 0', injected.missed.length === 0, injected.missed.join(' '))
const on = await applyFirePlanCheckboxes(injected.bytes)
check(`주입본도 ${TOTAL}개 적용`, on.applied === TOTAL && on.skipped.length === 0, `applied=${on.applied}`)

const zOn = await JSZip.loadAsync(on.bytes)
const vmlOn = await vmlOf(zOn, 'xl/worksheets/sheet8.xml')
check('1.4 VML x:Checked 정확히 4건', (vmlOn.match(/<x:Checked>1<\/x:Checked>/g) ?? []).length === 4,
  `${(vmlOn.match(/<x:Checked>1<\/x:Checked>/g) ?? []).length}건`)
let onCount = 0
for (let i = 1; i <= TOTAL; i++) if ((await zOn.file(`xl/ctrlProps/ctrlProp${i}.xml`)!.async('string')).includes('checked="Checked"')) onCount++
check(`워크북 전체 ctrlProp checked 정확히 4건(다른 시트로 안 샌다)`, onCount === 4, `${onCount}건`)

// 켜진 칸도 글자는 비고 문구는 남아야 한다(체크 표시가 글자로 남으면 이중 표시가 된다)
const sh8On = await zOn.file('xl/worksheets/sheet8.xml')!.async('string')
let onGlyph = 0
for (const ref of ON) if (/[■☑▣□☐]/.test(cellText(sh8On, ref) ?? '')) onGlyph++
check('켜진 4칸도 상자 글자가 사라졌다 — 컨트롤과 이중 표시 금지', onGlyph === 0, `${onGlyph}칸`)

// 🚨 가장 중요한 단언: 켜짐이 **그 칸의** 컨트롤과 짝이 맞는가. 수만 세면 엉뚱한 칸이 켜져도 초록이다.
//    확대 뒤엔 1.4의 ctrlProp 번호가 **1부터가 아니다**(앞 시트들이 먼저 쓴다) — 그래서 순번을
//    가정하지 않고 시트의 `<control r:id>` → rels → ctrlProp 경로를 **실제로 따라간다**.
const propsOfSheet = async (z: JSZip, part: string): Promise<string[]> => {
  const xml = await z.file(part)!.async('string')
  const rels = await z.file(part.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels'))!.async('string')
  return [...xml.matchAll(/<control shapeId="\d+" r:id="([^"]+)"/g)].map(m => {
    const t = new RegExp(`<Relationship Id="${m[1]}"[^>]*Target="([^"]+)"`).exec(rels)
    return 'xl/' + (t?.[1] ?? '').replace(/^\.\.\//, '')
  })
}
const props14 = await propsOfSheet(zOn, 'xl/worksheets/sheet8.xml')
check('1.4의 control → ctrlProp 경로가 40개 다 풀린다', props14.length === 40 && props14.every(p => zOn.file(p)),
  `${props14.length}개`)
const onRefs = new Set(ON)
let mispaired = 0
for (let i = 0; i < cells14.length; i++) {
  const wantOn = onRefs.has(cells14[i].cell)
  const propXml = await zOn.file(props14[i])!.async('string')
  if (propXml.includes('checked="Checked"') !== wantOn) mispaired++
}
check('켜진 컨트롤이 켜진 칸과 1:1로 짝이 맞는다', mispaired === 0, `${mispaired}건 어긋남`)

/* ━━━━━━━━━━━━━━━━━━ [B-4] 적용 범위 ━━━━━━━━━━━━━━━━━━ */
console.log('\n[B-4] 적용 범위 — 상자 있는 시트엔 붙고, 없는 시트엔 안 붙는다')
// 🔁 종전 계약(「컨트롤이 1.4 시트에만 있다」)을 **폐지하고 이 쌍으로 교체**한다.
//    지우기만 하면 「어디에 붙어야 하는가」를 아무도 안 묻게 되어, 확대가 절반만 돼도 초록이다.
const sheetParts = Object.keys(zOff.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
let withControls = 0, strayControls = 0
const strayEx: string[] = []
const partToName = new Map([...sheetPart].map(([n, p]) => [p, n]))
for (const p of sheetParts) {
  const has = (await zOff.file(p)!.async('string')).includes('<controls>')
  const name = partToName.get(p) ?? p
  const want = (perSheetEligible.get(name) ?? 0) > 0
  if (has) withControls++
  if (has !== want) { strayControls++; if (strayEx.length < 4) strayEx.push(`${name}(있음=${has} 기대=${want})`) }
}
check(`컨트롤이 적격 시트 ${SHEETS_WITH}장 전부에 붙었다 — 양성`, withControls === SHEETS_WITH, `${withControls}장`)
check('적격 0칸인 시트엔 한 개도 안 붙었다 — 음성 짝', strayControls === 0, strayEx.join(' '))
check('상자가 있어도 적격 0칸인 시트가 실재한다(음성 짝이 공허하지 않다)',
  FIRE_PLAN_MANIFEST.sheets.some(s => Object.keys(s.boxes).length > 0 && !perSheetEligible.has(s.name)))

/* ━━━━━━━━━━━━━━━━━━ [B-5] 확대가 새로 만든 위험 — 파트 무결성 ━━━━━━━━━━━━━━━━━━ */
console.log('\n[B-5] 시트 28장 × 파트 582개 — 번호가 겹치면 서로 덮어쓴다')
// 🚨 한 시트만 달 때는 존재할 수 없던 결함들이다.
const seenProps = new Set<string>()
const seenVml = new Set<string>()
let dupProp = 0, badVml = 0, shapeMismatch = 0, orderBad = 0
for (const [sheet, want] of perSheetEligible) {
  const part = sheetPart.get(sheet)!
  const xml = await zOff.file(part)!.async('string')
  // ① 순서 — 전 시트에서 본다(1.4만 보면 나머지 27장이 무검증이다)
  const iPage = xml.indexOf('<pageSetup'), iLeg = xml.indexOf('<legacyDrawing'), iCtl = xml.indexOf('<controls>')
  if (!(iPage >= 0 && iPage < iLeg && iLeg < iCtl)) orderBad++
  // ② ctrlProp 번호가 워크북 전역에서 유일한가 — 겹치면 뒤 시트가 앞 시트의 체크 상태를 덮어쓴다
  const props = await propsOfSheet(zOff, part)
  if (props.length !== want) shapeMismatch++
  for (const p of props) { if (seenProps.has(p)) dupProp++; seenProps.add(p) }
  // ③ 이 시트의 legacyDrawing이 **자기 VML**을 가리키고, 그 VML의 shape 수가 이 시트 몫과 같은가
  const vml = await vmlOf(zOff, part)
  const shapes = (vml.match(/<v:shape /g) ?? []).length
  if (shapes !== want) badVml++
  const relsXml = await zOff.file(part.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels'))!.async('string')
  const vmlTarget = /Type="[^"]*vmlDrawing"[^>]*Target="([^"]+)"/.exec(relsXml)?.[1] ?? ''
  if (seenVml.has(vmlTarget)) badVml++
  seenVml.add(vmlTarget)
}
check(`CT_Worksheet 순서가 ${SHEETS_WITH}장 전부에서 옳다`, orderBad === 0, `${orderBad}장 위반`)
check('시트별 control 수 = 그 시트 적격 수', shapeMismatch === 0, `${shapeMismatch}장 불일치`)
check(`ctrlProp 파트가 워크북 전역에서 유일 — 덮어쓰기 0`, dupProp === 0 && seenProps.size === TOTAL,
  `중복 ${dupProp} · 유일 ${seenProps.size}/${TOTAL}`)
check('시트마다 자기 VML을 가리키고 shape 수가 맞는다', badVml === 0, `${badVml}건`)
check(`VML 파트도 시트 수만큼 유일 ${SHEETS_WITH}개`, seenVml.size === SHEETS_WITH, `${seenVml.size}개`)

// ⑤ 🚨 **VML shape id 블록** — 이 축에 단언이 없어서 실제 Excel이 컨트롤을 **두 배로 셌다**(582→1163).
//    `<o:idmap data="N">`은 「이 파트가 id 블록 N을 소유한다」는 선언이고 그 블록의 shape id는
//    `N*1024 … N*1024+1023`이다. 28개 파트가 전부 `data="1"`이면 id가 모호해져
//    `<control shapeId>`가 VML shape와 짝을 못 짓고 각각 별개 객체가 된다.
//    노드 검사 52/0·변이 15/15가 전부 초록이었다 — 잡은 것은 Excel COM뿐이었다. 그래서 여기 못 박는다.
const seenBlocks = new Set<number>()
const seenShapeIds = new Set<number>()
let blockDup = 0, outOfBlock = 0, unpaired = 0, shapeIdDup = 0
for (const [sheet] of perSheetEligible) {
  const part = sheetPart.get(sheet)!
  const vml = await vmlOf(zOff, part)
  const block = Number(/<o:idmap[^>]*data="(\d+)"/.exec(vml)![1])
  if (seenBlocks.has(block)) blockDup++
  seenBlocks.add(block)
  const ids = [...vml.matchAll(/<v:shape id="_x0000_s(\d+)"/g)].map(m => Number(m[1]))
  for (const id of ids) {
    if (Math.floor(id / 1024) !== block) outOfBlock++
    if (seenShapeIds.has(id)) shapeIdDup++
    seenShapeIds.add(id)
  }
  // 짝짓기 — 이 시트의 `<control shapeId>` 집합이 이 시트 VML의 shape id 집합과 **같아야** 한다
  const xml = await zOff.file(part)!.async('string')
  const ctlIds = [...xml.matchAll(/<control shapeId="(\d+)"/g)].map(m => Number(m[1]))
  const a = [...ids].sort((x, y) => x - y).join(',')
  const b = [...ctlIds].sort((x, y) => x - y).join(',')
  if (a !== b) unpaired++
}
check(`idmap 블록이 파트마다 유일 ${SHEETS_WITH}개 — 겹치면 Excel이 컨트롤을 두 배로 센다`,
  blockDup === 0 && seenBlocks.size === SHEETS_WITH, `중복 ${blockDup} · 유일 ${seenBlocks.size}`)
check('모든 shape id가 자기 파트의 블록 안(N*1024 … +1023)', outOfBlock === 0, `${outOfBlock}개 이탈`)
check(`shape id가 워크북 전역에서 유일 ${TOTAL}개`, shapeIdDup === 0 && seenShapeIds.size === TOTAL,
  `중복 ${shapeIdDup} · 유일 ${seenShapeIds.size}/${TOTAL}`)
check('시트마다 <control shapeId> 집합 = 그 시트 VML shape id 집합(짝짓기)', unpaired === 0, `${unpaired}장 불일치`)

// ④ 🚨 **앵커가 시트 밖으로 넘지 않는가**. 이 축에 단언이 없어서 인쇄물 아래에 점선 띠가 찍혔다.
//    앵커의 `to row`가 dimension의 마지막 행을 넘으면 엑셀이 그 다음 빈 행까지 인쇄 범위에 넣어
//    표 아래에 그 행의 테두리가 띠처럼 나온다(28장 중 3장: 1.11.1·1.14.1·2.5).
//    수치 검사·변이·LO는 전부 통과했고 **인쇄 렌더를 대조군과 나란히 놓았을 때만** 드러났다.
let overflowRow = 0, overflowCol = 0
const overEx: string[] = []
for (const [sheet] of perSheetEligible) {
  const part = sheetPart.get(sheet)!
  const xml = await zOff.file(part)!.async('string')
  const dim = /<dimension ref="[A-Z]+\d+:([A-Z]+)(\d+)"/.exec(xml)!
  const lastRow1 = Number(dim[2]), lastCol0 = colNum(dim[1])
  const vml = await vmlOf(zOff, part)
  for (const a of [...vml.matchAll(/<x:Anchor>([^<]*)<\/x:Anchor>/g)].map(m => m[1].split(',').map(v => Number(v.trim())))) {
    if (a[6] > lastRow1 - 1) { overflowRow++; if (overEx.length < 4) overEx.push(`${sheet} to행=${a[6]}>${lastRow1 - 1}`) }
    if (a[4] > lastCol0) { overflowCol++; if (overEx.length < 4) overEx.push(`${sheet} to열=${a[4]}>${lastCol0}`) }
  }
}
check('앵커 to행이 시트 마지막 행을 안 넘는다 — 넘으면 인쇄물에 빈 행 테두리가 띠로 찍힌다',
  overflowRow === 0, `${overflowRow}개 ${overEx.join(' ')}`)
check('앵커 to열도 시트 마지막 열을 안 넘는다 — 같은 부류(가로 축)', overflowCol === 0, `${overflowCol}개`)

// 폭은 **전 워크북에서** 묻는다(위 J16 하나만 보면 나머지 581개가 무검증이다)
let badWidth = 0
for (const [sheet] of perSheetEligible) {
  const vml = await vmlOf(zOff, sheetPart.get(sheet)!)
  for (const a of [...vml.matchAll(/<x:Anchor>([^<]*)<\/x:Anchor>/g)].map(m => m[1].split(',').map(v => Number(v.trim())))) {
    if (a[4] - a[0] !== 2) badWidth++
  }
}
check(`${TOTAL}개 전부 앵커 폭이 정확히 2열 — 0이면 상자를 못 덮고 넓으면 옆 글을 먹는다`,
  badWidth === 0, `${badWidth}개 어긋남`)

// ④ 기하 가정 — 컨트롤 폭 2열이 옆 칸을 덮지 않는가(적격 칸 병합 폭 ≥ 3열이 실측 최솟값)
let tooNarrow = 0, minWidth = 99
for (const [sheet] of perSheetEligible) {
  const xml = await zOff.file(sheetPart.get(sheet)!)!.async('string')
  const mg = new Map<string, number>()
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+)\d+"\/>/g)) mg.set(m[1], colNum(m[2]))
  for (const c of firePlanCheckboxCells(sheet)) {
    const w = (mg.get(c.cell) ?? c.col) - c.col + 1
    minWidth = Math.min(minWidth, w)
    if (w < 2) tooNarrow++
  }
}
check('적격 칸 병합 폭 ≥ 컨트롤 폭(2열) — 옆 칸을 안 덮는다', tooNarrow === 0, `최소 ${minWidth}열`)

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
