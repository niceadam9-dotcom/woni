/** 현5 불량 세부 칸이 줄바꿈을 두부(■)로 그리는 원인 진단.
 *
 *  가설: 접기 규약이 여러 불량을 `\n`으로 합치는데, 셀 스타일에 `wrapText`가 없으면
 *  Excel은 0x0A를 줄바꿈이 아니라 **네모 글리프**로 그린다. 행 높이(ht=77.25)는 여러 줄을
 *  전제하는데 정렬 속성이 그걸 못 받는 상태.
 *
 *  ⚠ '열리는가'와 '텍스트가 사는가'는 다른 검사다(S10-1 교훈). 여기선 **보이는가**가 축이다.
 *  ⚠ 셀 정규식은 자기닫힘 분기 필수(소방계획서_27.md:197).
 */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

const zip = await JSZip.loadAsync(readFileSync('templates/report-workbook-full.xlsx'))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const sheets = [...wbXml.matchAll(/<sheet[^>]*\sname="([^"]+)"[^>]*r:id="([^"]+)"/g)]
  .map(m => ({ name: m[1], path: 'xl/' + relMap.get(m[2])!.replace(/^\//, '').replace(/^xl\//, '') }))

const styles = await zip.file('xl/styles.xml')!.async('string')
const cellXfsBlock = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)![1]
const xfs = [...cellXfsBlock.matchAll(/<xf\s[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => m[0])
console.log(`cellXfs entries: ${xfs.length}`)

function wrapOf(s: number): string {
  const xf = xfs[s]
  if (!xf) return '(no such xf)'
  const al = /<alignment\s[^>]*?\/?>/.exec(xf)?.[0] ?? ''
  const w = /wrapText="([^"]+)"/.exec(al)?.[1] ?? '(absent)'
  const v = /vertical="([^"]+)"/.exec(al)?.[1] ?? '-'
  return `wrapText=${w}  vertical=${v}  ${al ? '' : '(no <alignment>)'}`
}

for (const name of ['현5']) {
  const s = sheets.find(x => x.name === name)!
  const xml = await zip.file(s.path)!.async('string')
  console.log(`\n=== ${name} ===`)
  for (const rowNo of [3, 4, 5, 6, 7, 8, 9, 10]) {
    const rowRe = new RegExp(`<row[^>]*\\sr="${rowNo}"[^>]*>([\\s\\S]*?)</row>`)
    const rm = rowRe.exec(xml)
    if (!rm) { console.log(`row ${rowNo}: (absent)`); continue }
    const ht = /\sht="([^"]+)"/.exec(rm[0])?.[1] ?? '-'
    const cells = [...rm[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
    const parts: string[] = []
    for (const c of cells) {
      const ref = /r="([A-Z]+\d+)"/.exec(c[1])?.[1] ?? '?'
      if (!/^[ABC]\d+$/.test(ref)) continue
      const st = /s="(\d+)"/.exec(c[1])?.[1]
      parts.push(`${ref}[s=${st ?? '-'}] ${st ? wrapOf(+st) : ''}`)
    }
    console.log(`row ${rowNo} ht=${ht}`)
    for (const p of parts) console.log(`   ${p}`)
  }
}
