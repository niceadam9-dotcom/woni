/** 소방계획서 엑셀 — 클릭 가능한 양식 컨트롤 체크박스 검사.
 *
 *  두 층을 **따로** 묻는다.
 *   [A] 순수 계층 — manifest만 보고 「어느 칸에 다는가」. 제외 규칙이 밀리면 여기가 먼저 붉어진다.
 *   [B] 적용 계층 — 실제 템플릿에 달았을 때 파트·순서·글자가 어떻게 되는가.
 *
 *  ⚠ 이 검사는 **Excel이 받아들이는가**를 묻지 못한다(노드에는 Excel이 없다).
 *    그 축은 `_verify-spike-checkbox.ps1`이 실제 Excel COM으로 따로 본다 — 여기서 초록이라고
 *    「엑셀에서 열린다」고 말하면 안 된다. 순서 위반은 **LibreOffice는 통과하고 Excel만** 문다.
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

const HERE = dirname(fileURLToPath(import.meta.url))
const XLSX_PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')
const S14 = '1.4 소방시설 현황'

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
for (const s of FIRE_PLAN_MANIFEST.sheets) {
  const bullets = new Set(Object.keys(s.bulletCells ?? {}))
  const picked = firePlanCheckboxCells(s.name)
  totalEligible += picked.length
  for (const c of picked) if (bullets.has(c.cell)) bulletHit++
}
check('법정 불릿(bulletCells)이 대상에 섞이지 않는다 — 전 시트', bulletHit === 0, `${bulletHit}칸`)
// 전 워크북 적격 수를 못 박는다: 제외 규칙이 느슨해지면 이 수가 올라가며 먼저 붉어진다
check('전 워크북 적격 582칸(규칙 드리프트 감시)', totalEligible === 582, `${totalEligible}칸`)

/* ━━━━━━━━━━━━━━━━━━ [B] 적용 계층 — 실제 파일 ━━━━━━━━━━━━━━━━━━ */
console.log('\n[B] 적용 — 템플릿(전부 미체크)')
const off = await applyFirePlanCheckboxes(bytes)
check('40개 적용·미적용 0', off.applied === 40 && off.skipped.length === 0,
  `applied=${off.applied} skipped=${off.skipped.length} ${off.skipped.slice(0, 4).join(' ')}`)

const zOff = await JSZip.loadAsync(off.bytes)
const names = Object.keys(zOff.files)
check('vmlDrawing 파트 1개', names.filter(n => /^xl\/drawings\/vmlDrawing\d+\.vml$/.test(n)).length === 1)
check('ctrlProps 파트 40개', names.filter(n => /^xl\/ctrlProps\/ctrlProp\d+\.xml$/.test(n)).length === 40)
check('시트 rels 생성', names.includes('xl/worksheets/_rels/sheet8.xml.rels'))

const ctOff = await zOff.file('[Content_Types].xml')!.async('string')
check('Content_Types: vml Default', /Extension="vml"/.test(ctOff))
check('Content_Types: ctrlProp Override 40건',
  (ctOff.match(/controlproperties\+xml/g) ?? []).length === 40)

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
check('control 요소 40개', (sh8.match(/<control shapeId=/g) ?? []).length === 40)
// 사진 단계가 `<drawing>`을 끼울 자리(legacyDrawing 앞)가 실제로 있는지 — 배선 전제를 단언한다
check('사진 단계가 <drawing>을 끼울 앵커(<legacyDrawing)가 있다', sh8.includes('<legacyDrawing'))

// 🚨 눈으로 먼저 잡은 결함의 단언 — 「피난기구」(J16:Q17)는 **두 행에 걸친 병합**이다.
//    컨트롤을 첫 행에만 걸면 글자는 병합 전체의 가운데, 컨트롤은 첫 행의 가운데에 서서 떠 보인다.
//    수치 검사(칸 좌상단 ≤1pt)는 이걸 **통과시켰다** — 렌더가 잡았다. 그래서 여기 못 박는다.
const vmlOff = await zOff.file('xl/drawings/vmlDrawing1.vml')!.async('string')
const anchorOf = (vml: string, shapeIdx: number) =>
  [...vml.matchAll(/<x:Anchor>([^<]*)<\/x:Anchor>/g)][shapeIdx]?.[1]?.split(',').map(s => Number(s.trim()))
const j16At = cells14.findIndex(c => c.cell === 'J16')
check('J16이 대상에 있다(전제)', j16At >= 0)
const a16 = anchorOf(vmlOff, j16At)!
check('J16 앵커가 병합 끝 행(17)까지 걸린다 — 여러 행 병합', a16[6] === 17, `끝행=${a16[6]}`)
const a3 = anchorOf(vmlOff, cells14.findIndex(c => c.cell === 'J3'))!
check('J3(한 행 병합)은 자기 행 하나만 — 음성 짝', a3[6] === 3, `끝행=${a3[6]}`)
check('controls 블록의 끝 행도 VML과 같다',
  new RegExp(`<to><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>17</xdr:row>`).test(sh8))

console.log('\n[B-2] 글자 — 상자만 사라지고 법정 문구는 남는가')
let glyphLeft = 0, wordingBroken = 0
for (const c of cells14) {
  const now = cellText(sh8, c.cell) ?? ''
  if (/[□☐■☑▣]/.test(now)) glyphLeft++
  // 전각 공백을 원래 상자 글자로 되돌리면 manifest 라벨과 **글자 단위로** 같아야 한다
  const restored = now.replace('　', sheetManifest(S14).boxes[c.cell])
  if (restored !== labelAt(S14, c.cell)) wordingBroken++
}
check('40칸 모두 상자 글자가 사라졌다', glyphLeft === 0, `${glyphLeft}칸 잔존`)
check('40칸 모두 법정 문구가 글자 단위로 보존', wordingBroken === 0, `${wordingBroken}칸 훼손`)

// 음성 축: 대상이 아닌 칸은 **건드리지 않았다**
check('AJ2(안내문장) 원문 그대로', cellText(sh8, 'AJ2') === labelAt(S14, 'AJ2'))
check('R16(상자 5개) 원문 그대로', cellText(sh8, 'R16') === labelAt(S14, 'R16'))

// 미체크 파일에는 checked 표시가 한 건도 없어야 한다
check('미체크: VML에 x:Checked 0건', !vmlOff.includes('<x:Checked>'))
let ctrlOn = 0
for (let i = 1; i <= 40; i++) if ((await zOff.file(`xl/ctrlProps/ctrlProp${i}.xml`)!.async('string')).includes('checked="Checked"')) ctrlOn++
check('미체크: ctrlProp에 checked 0건', ctrlOn === 0, `${ctrlOn}건`)

console.log('\n[B-3] 체크 상태가 주입된 글을 따라가는가 (양성 짝)')
// 주입이 `■`를 적은 칸만 켜져야 한다. 켜짐·꺼짐을 **한 파일 안에서** 함께 본다.
const ON = ['J3', 'J5', 'AJ7', 'J19']
const injected = await injectWorkbook(bytes, ON.map(cell => ({
  sheet: S14, cell, value: labelAt(S14, cell).replace(/[□☐]/, '■'),
})))
check('주입 미착지 0', injected.missed.length === 0, injected.missed.join(' '))
const on = await applyFirePlanCheckboxes(injected.bytes)
check('주입본도 40개 적용', on.applied === 40 && on.skipped.length === 0, `applied=${on.applied}`)

const zOn = await JSZip.loadAsync(on.bytes)
const vmlOn = await zOn.file('xl/drawings/vmlDrawing1.vml')!.async('string')
check('VML x:Checked 정확히 4건', (vmlOn.match(/<x:Checked>1<\/x:Checked>/g) ?? []).length === 4,
  `${(vmlOn.match(/<x:Checked>1<\/x:Checked>/g) ?? []).length}건`)
let onCount = 0
for (let i = 1; i <= 40; i++) if ((await zOn.file(`xl/ctrlProps/ctrlProp${i}.xml`)!.async('string')).includes('checked="Checked"')) onCount++
check('ctrlProp checked 정확히 4건', onCount === 4, `${onCount}건`)

// 켜진 칸도 글자는 비고 문구는 남아야 한다(체크 표시가 글자로 남으면 이중 표시가 된다)
const sh8On = await zOn.file('xl/worksheets/sheet8.xml')!.async('string')
let onGlyph = 0
for (const ref of ON) if (/[■☑▣□☐]/.test(cellText(sh8On, ref) ?? '')) onGlyph++
check('켜진 4칸도 상자 글자가 사라졌다 — 컨트롤과 이중 표시 금지', onGlyph === 0, `${onGlyph}칸`)

// 🚨 가장 중요한 단언: 켜짐이 **컨트롤 순서와 짝**이 맞는가. 수만 세면 엉뚱한 칸이 켜져도 초록이다.
const onRefs = new Set(ON)
let mispaired = 0
for (let i = 0; i < cells14.length; i++) {
  const wantOn = onRefs.has(cells14[i].cell)
  const propXml = await zOn.file(`xl/ctrlProps/ctrlProp${i + 1}.xml`)!.async('string')
  if (propXml.includes('checked="Checked"') !== wantOn) mispaired++
}
check('켜진 컨트롤이 켜진 칸과 1:1로 짝이 맞는다', mispaired === 0, `${mispaired}건 어긋남`)

console.log('\n[B-4] 다른 시트 무손상')
let otherTouched = 0
for (const s of FIRE_PLAN_MANIFEST.sheets) {
  if (CHECKBOX_SHEETS.includes(s.name)) continue
  const boxes = Object.keys(s.boxes)
  if (!boxes.length) continue
  otherTouched++
  break
}
const sheetParts = Object.keys(zOff.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
let strayControls = 0
for (const p of sheetParts) {
  if (p === 'xl/worksheets/sheet8.xml') continue
  if ((await zOff.file(p)!.async('string')).includes('<controls>')) strayControls++
}
check('컨트롤이 1.4 시트에만 있다', strayControls === 0, `${strayControls}개 시트에 유출`)
check('다른 시트에도 상자 칸은 그대로 남아 있다(아직 미적용 범위)', otherTouched > 0)

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
