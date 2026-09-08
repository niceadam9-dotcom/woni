/** 체크박스(직사각형 도형) **자동 생성** 가능성 실증.
 *
 *  sj 템플릿에는 사람이 손으로 그린 직사각형이 5개뿐이다(I22·I24·I26·I46·Y46 — 전부 ☐ 칸 앞).
 *  같은 자리가 서식 1.1에만 20곳 넘으므로 손으로는 95개 표를 감당할 수 없다.
 *  → hwp 글자가 ☐/■로 시작하는 칸을 전부 찾아 **같은 모양의 도형을 프로그램으로 앉힌다**.
 *
 *  · ☐(미체크) → 빈 사각형
 *  · ■(체크)   → 사각형 + 안에 √   ← 서식 머리말이 "√표를 합니다"라고 지시한다
 *  · 글자에서는 ☐/■ 글리프를 뗀다 — 안 떼면 상자가 두 개로 보인다
 *
 *  도형 크기는 사용자가 그린 것에서 실측(약 139700 EMU ≈ 0.39cm)했다.
 *  실행: npx tsx scripts/_gs-checkbox-gen.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { parseTables } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset } from './hwp5-read.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWP = resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')
const SRC = 'F:\\AI\\sjfire\\_강순기_형식비교\\A_sj격자_강순기_서식1.1.xlsx'
const OUT = 'F:\\AI\\sjfire\\_강순기_형식비교\\C_체크박스생성_강순기_서식1.1.xlsx'
const SHEET = '소방안전관리계획 (3)'
const SHEET_XML = 'xl/worksheets/sheet5.xml'
const BOX = 139700          // EMU — 사용자가 그린 상자 실측치
const PAD_X = 76200         // 칸 왼쪽 여백 (사용자 도형과 같은 값)
const PAD_Y = 38100

/* ── 1. hwp에서 서식 1.1 다시 뽑아 '어느 칸이 체크 칸인가'를 안다 ── */
const { bytes } = readSectionStream(readFileSync(HWP))
const records = walkRecords(bytes)
const zf = await JSZip.loadAsync(readFileSync(HWPX))
const truth = parseTables(await zf.file('Contents/section0.xml')!.async('string')).map(t => t.cells.map(c => ({ row: c.row, col: c.col })))
const cal = calibrateCellOffset(records, truth)!
const T = extractTables(records, cal.offset)
  .map(t => ({ t, s: ['명칭', '도로명주소', '수신기위치', '대상물급수'].filter(k => t.cells.some(c => c.text.replace(/\s/g, '').includes(k))).length }))
  .sort((a, b) => b.s - a.s)[0].t

/* ── 2. 산출물에서 ☐/■로 시작하는 칸을 찾는다 ── */
const wb = XLSX.read(readFileSync(SRC), { sheetStubs: true })
const ws = wb.Sheets[SHEET]
const range = XLSX.utils.decode_range(ws['!ref']!)
type Box = { r: number; c: number; checked: boolean; rest: string; addr: string }
const boxes: Box[] = []
for (let R = range.s.r; R <= range.e.r; R++) {
  for (let C = range.s.c; C <= range.e.c; C++) {
    const addr = XLSX.utils.encode_cell({ r: R, c: C })
    const cell = ws[addr]
    if (!cell || cell.v === undefined) continue
    const v = String(cell.v)
    const m = v.match(/^\s*([☐■])\s*([\s\S]*)$/)
    if (!m) continue
    boxes.push({ r: R, c: C, checked: m[1] === '■', rest: m[2].trim(), addr })
  }
}
console.log(`체크 칸 ${boxes.length}개 발견 (미체크 ${boxes.filter(b => !b.checked).length} · 체크 ${boxes.filter(b => b.checked).length})`)
console.log(boxes.map(b => `${b.addr}${b.checked ? '■' : '☐'}${b.rest.slice(0, 8)}`).join('  '))

/* hwp 원문의 체크 수와 대조 — 산출물만 보고 세면 '내가 쓴 것을 내가 세는' 자기충족이 된다 */
const hwpBoxes = T.cells.filter(c => /^[☐■]/.test(c.text.trim()))
console.log(`\nhwp 원문 체크 칸 ${hwpBoxes.length}개 (체크 ${hwpBoxes.filter(c => c.text.trim().startsWith('■')).length})`)
if (hwpBoxes.length !== boxes.length) console.log('⚠ 개수 불일치 — 산출물이 원문을 다 담지 못했다')

/* ── 3. 도형 XML 생성 ── */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const shape = (b: Box, id: number) => `<xdr:oneCellAnchor>` +
  `<xdr:from><xdr:col>${b.c}</xdr:col><xdr:colOff>${PAD_X}</xdr:colOff><xdr:row>${b.r}</xdr:row><xdr:rowOff>${PAD_Y}</xdr:rowOff></xdr:from>` +
  `<xdr:ext cx="${BOX}" cy="${BOX}"/>` +
  `<xdr:sp macro="" textlink=""><xdr:nvSpPr>` +
  `<xdr:cNvPr id="${id}" name="체크박스 ${id}"/><xdr:cNvSpPr/></xdr:nvSpPr>` +
  `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${BOX}" cy="${BOX}"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>` +
  `<a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></xdr:spPr>` +
  `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/><a:lstStyle/>` +
  `<a:p><a:pPr algn="ctr"/>${b.checked
    ? `<a:r><a:rPr lang="ko-KR" sz="800" b="1"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:rPr><a:t>${esc('√')}</a:t></a:r>`
    : `<a:endParaRPr lang="ko-KR" sz="800"/>`}</a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:oneCellAnchor>`

const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
  boxes.map((b, i) => shape(b, i + 2)).join('') + `</xdr:wsDr>`

/* ── 4. 패치: 도형 교체 + 글자에서 글리프 제거 ── */
const zip = await JSZip.loadAsync(readFileSync(SRC))
zip.file('xl/drawings/drawing1.xml', drawingXml)     // 손으로 그린 5개를 생성본으로 **대체**

let xml = await zip.file(SHEET_XML)!.async('string')
let stripped = 0
for (const b of boxes) {
  const re = new RegExp(`(<c r="${b.addr}"[^>]*?>)([\\s\\S]*?)(</c>)`)
  const m = xml.match(re)
  if (!m) continue
  // 글리프를 뗀 나머지 글자만 남긴다(상자가 두 개로 보이는 것을 막는다)
  const attrs = m[1].replace(/\s*t="[^"]*"/, '')
  xml = xml.replace(re, `${attrs.slice(0, -1)} t="inlineStr"><is><t xml:space="preserve">${esc(' ' + b.rest)}</t></is></c>`)
  stripped++
}
zip.file(SHEET_XML, xml)
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log(`\n✅ 도형 ${boxes.length}개 생성 · 글리프 제거 ${stripped}칸 → ${OUT}`)
