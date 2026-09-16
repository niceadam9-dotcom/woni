/** 컨트롤이 **상자 글리프에서 얼마나 밀렸는가**를 재기 위한 세 판 만들기.
 *
 *  🎯 계산하지 않는다. 그리는 주체(Excel)에게 묻되, 이번엔 **두 가지를 따로** 묻는다:
 *
 *      X = 제품 그대로          (상자는 바탕색으로 숨김 · 컨트롤 있음)
 *      Y = X에서 컨트롤만 뗀 판 (상자 숨김 · 컨트롤 없음)
 *      Z = Y에서 숨긴 상자를 **빨강**으로 되살린 판 (컨트롤 없음)
 *
 *    diff(X,Y) = **컨트롤만**      → 컨트롤이 실제로 선 자리
 *    diff(Y,Z) = **상자 글리프만** → 상자가 실제로 있는 자리
 *
 *  세 판의 **글자 배치가 완전히 같다**(글자를 바꾸지 않고 색만 바꾸므로). 그래서 두 자리를
 *  같은 좌표계에서 빼면 곧 어긋남이다 — 글꼴 대체·축소율·자간을 하나도 몰라도 된다.
 *
 *  ⚠ 종전 `_probe-cb-diffmeasure`는 **상자끼리의 상대 거리**만 쟀다. 그래서 「첫 상자 자리」와
 *    「컨트롤이 실제로 서는 자리」가 어긋나 있으면 전부 같이 밀려도 0으로 보인다 —
 *    이번 사용자 지적(image-5·6·7)이 정확히 그 부류다. 여기서는 **절대 자리**를 맞댄다.
 *
 *  실행: npx tsx scripts/_probe-cb-render3.mts
 *        → %TEMP%\cb3\{X,Y,Z}.xlsx · 굽을 시트 번호를 CB3_SHEETS= 로 찍어 준다
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { applyFirePlanCheckboxes, firePlanCheckboxCells } from '../src/lib/fire-plan-checkbox-controls.ts'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'

const HERE = import.meta.dirname
const OUT = path.join(process.env.TEMP ?? '/tmp', 'cb3')
await mkdir(OUT, { recursive: true })

const tpl = new Uint8Array(await readFile(path.join(HERE, '..', 'templates', 'fire-plan-workbook.xlsx')))
const res = await applyFirePlanCheckboxes(tpl)
console.log(`컨트롤 ${res.applied}개 · 미적용 ${res.skipped.length}`)
await writeFile(path.join(OUT, 'X.xlsx'), Buffer.from(res.bytes))

/* ── Y: 컨트롤만 뗀다. 글자·서식·행높이는 한 글자도 안 건드린다. ───────────────── */
const y = await JSZip.loadAsync(res.bytes)
let strippedSheets = 0, strippedCtrl = 0
for (const p of Object.keys(y.files)) {
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(p)) continue
  let xml = await y.file(p)!.async('string')
  const before = xml
  xml = xml.replace(/<legacyDrawing r:id="rIdCbVml"\/>/g, '')
  /* `<controls>`를 품은 바깥 AlternateContent 통째로.
   * 🚨 **끝을 `</controls>`로 잡는다.** 「첫 `</mc:AlternateContent>`까지」로 잡으면 컨트롤
   *   하나하나가 제 AlternateContent로 싸여 있어 **첫 컨트롤만** 떼고 XML이 깨진다
   *   (실제로 밟았다 — 29장에서 29개만 지워졌다. 부착 수 대조가 그 자리에서 세웠다). */
  xml = xml.replace(/<mc:AlternateContent[^>]*><mc:Choice Requires="x14"><controls>[\s\S]*?<\/controls><\/mc:Choice><\/mc:AlternateContent>/g,
    m => { strippedCtrl += (m.match(/<control /g) ?? []).length; return '' })
  if (xml !== before) { y.file(p, xml); strippedSheets++ }
}
for (const p of Object.keys(y.files)) if (/^xl\/drawings\/vmlDrawing\d+\.vml$/.test(p)) y.remove(p)
await writeFile(path.join(OUT, 'Y.xlsx'), Buffer.from(await y.generateAsync({ type: 'uint8array' })))
if (strippedCtrl !== res.applied) throw new Error(`컨트롤 제거 ${strippedCtrl} ≠ 부착 ${res.applied}`)
console.log(`Y: 시트 ${strippedSheets}장에서 컨트롤 ${strippedCtrl}개 제거`)

/* ── Z: 숨긴 상자를 빨강으로. 제품이 만든 **바로 그 런**의 색만 바꾼다.
 *     🚨 글자는 안 바꾼다 — `□`→`■`로 바꿨다가 전진 폭이 달라 뒤 글자가 통째로 밀린 전례가 있다.
 *     상자 글자를 품은 색런만 고르므로, 원래 서식이 있던 다른 런은 안 건드린다. */
const z = await JSZip.loadAsync(await y.generateAsync({ type: 'uint8array' }))
let reddened = 0
for (const p of Object.keys(z.files)) {
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(p)) continue
  let xml = await z.file(p)!.async('string')
  xml = xml.replace(/<r><rPr><color rgb="[0-9A-Fa-f]{8}"\/><\/rPr><t xml:space="preserve">([^<]*)<\/t><\/r>/g,
    (m, t) => (/^[□☐■☑▣]$/.test(t) ? (reddened++, `<r><rPr><color rgb="FFFF0000"/></rPr><t xml:space="preserve">${t}</t></r>`) : m))
  z.file(p, xml)
}
await writeFile(path.join(OUT, 'Z.xlsx'), Buffer.from(await z.generateAsync({ type: 'uint8array' })))
if (reddened !== res.applied) throw new Error(`빨강 표식 ${reddened} ≠ 부착 ${res.applied} — 숨김 런을 못 찾았다`)
console.log(`Z: 상자 ${reddened}개 빨강`)

/* ── W: **종전 방식 재현본**(대조군). 상자를 전각 공백으로 갈아 끼운다.
 *
 *  `230e952` 이전의 제품이 이랬다. `□`(SegoeUISymbol)와 `　`(맑은 고딕)는 전진 폭이 달라
 *  **상자를 하나 비울 때마다 뒤 글자가 왼쪽으로 밀리고**, 컨트롤은 제자리에 있으므로
 *  라벨이 컨트롤 밑으로 파고든다 — 그 증상이 사용자 캡처와 같은지 **눈으로 맞대기 위한** 판이다.
 *  🚨 가설을 재현해 보지 않고 「배포가 낡았다」고 말하면 그건 추측이다. */
const wz = await JSZip.loadAsync(res.bytes)
let widened = 0
for (const p of Object.keys(wz.files)) {
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(p)) continue
  let xml = await wz.file(p)!.async('string')
  xml = xml.replace(/<r><rPr><color rgb="[0-9A-Fa-f]{8}"\/><\/rPr><t xml:space="preserve">([^<]*)<\/t><\/r>/g,
    (m, t) => (/^[□☐■☑▣]$/.test(t) ? (widened++, '<r><t xml:space="preserve">　</t></r>') : m))
  wz.file(p, xml)
}
await writeFile(path.join(OUT, 'W.xlsx'), Buffer.from(await wz.generateAsync({ type: 'uint8array' })))
console.log(`W(종전 방식 대조군): 상자 ${widened}개를 전각 공백으로`)

/* ── 굽을 시트: 컨트롤이 있는 시트 전부(번호는 워크북 순서 1-based) ───────────── */
const names = FIRE_PLAN_MANIFEST.sheets.map(s => s.name)
const want: number[] = []
names.forEach((n, i) => { if (firePlanCheckboxCells(n).length) want.push(i + 1) })
console.log(`\n${OUT}`)
console.log(`CB3_SHEETS=${want.join(',')}`)
