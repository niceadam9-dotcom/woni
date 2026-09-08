/** A안 화면의 빈 ☐ 잔재가 도형(체크박스 개체)인지 셀 글자인지 가른다. */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

const z = await JSZip.loadAsync(readFileSync('F:/AI/sjfire/_강순기_형식비교/A_sj격자_강순기_서식1.1.xlsx'))
const sheet = await z.file('xl/worksheets/sheet5.xml')!.async('string')
console.log('sheet5에 <drawing> 참조:', /<drawing[ /]/.test(sheet))
console.log('sheet5에 <legacyDrawing> 참조:', /<legacyDrawing/.test(sheet))

const d = z.file('xl/drawings/drawing1.xml')
if (d) {
  const x = await d.async('string')
  const anchors = [...x.matchAll(/<xdr:(twoCell|oneCell|absolute)Anchor/g)].length
  const names = [...x.matchAll(/name="([^"]*)"/g)].map(m => m[1])
  console.log(`drawing1.xml ${x.length}바이트 · 앵커 ${anchors}개 · 개체명: ${names.slice(0, 15).join(' | ')}`)
} else console.log('drawing1.xml 없음')

for (const k of Object.keys(z.files).filter(n => n.includes('_rels/sheet5'))) {
  console.log(`\n${k}:\n${(await z.file(k)!.async('string')).slice(0, 500)}`)
}

/* 승강기·주차장·화재보험 행 근처 셀에 실제로 뭐가 들어 있나 */
for (const addr of ['D22', 'I22', 'D24', 'I24', 'B46', 'I46']) {
  const m = sheet.match(new RegExp(`<c r="${addr}"[^>]*(?:/>|>[\\s\\S]*?</c>)`))
  console.log(`${addr}: ${m ? m[0].slice(0, 140) : '없음'}`)
}
