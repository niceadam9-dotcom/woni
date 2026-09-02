/** 현N 시트의 라벨 후보 — 지정 열 범위에서 비어 있지 않은 칸을 행 순서로 찍는다.
 *  왜: 앵커는 좌표만 믿지 않고 **이웃 라벨**로 검증한다. 그 라벨칸을 고르려면 원문이 필요하다.
 *  사용: npx tsx scripts/_p4-hyeon-labels.mts 현1 15 38 A F
 *  ⚠ 셀 정규식은 자기닫힘 분기 필수(소방계획서_27.md:197).
 */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

const [SHEET = '현1', R1 = '15', R2 = '38', C1 = 'A', C2 = 'F'] = process.argv.slice(2)
const colNum = (s: string) => [...s].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0)
const lo = colNum(C1), hi = colNum(C2)

const zip = await JSZip.loadAsync(readFileSync('templates/report-workbook-full.xlsx'))
const wb = await zip.file('xl/workbook.xml')!.async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const hit = [...wb.matchAll(/<sheet[^>]*\sname="([^"]+)"[^>]*r:id="([^"]+)"/g)]
  .map(m => ({ name: m[1], path: 'xl/' + relMap.get(m[2])!.replace(/^\//, '').replace(/^xl\//, '') }))
  .find(s => s.name === SHEET)!

let shared: string[] = []
const ss = zip.file('xl/sharedStrings.xml')
if (ss) {
  const t = await ss.async('string')
  shared = [...t.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))
}
const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&')

const xml = await zip.file(hit.path)!.async('string')
const out: string[] = [`sheet=${SHEET} rows ${R1}..${R2} cols ${C1}..${C2}`]
for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
  const ref = /r="([A-Z]+)(\d+)"/.exec(m[1])
  if (!ref) continue
  const col = colNum(ref[1]), row = +ref[2]
  if (row < +R1 || row > +R2 || col < lo || col > hi) continue
  const body = m[2] ?? ''
  // 수식은 **원문을 그대로** 찍는다. 캐시값만 보면 '무엇을 참조하는가'를 알 수 없고,
  // 그걸 모르면 이미 배선된 칸을 중복 배선하게 된다.
  const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1]
  const isF = /<f[ >]/.test(body)
  const t = /t="([^"]+)"/.exec(m[1])?.[1] ?? 'n'
  let text = ''
  if (t === 's') { const v = /<v>(\d+)<\/v>/.exec(body)?.[1]; if (v != null) text = shared[+v] ?? '' }
  else if (t === 'inlineStr') text = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')
  else text = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
  text = dec(text)
  if (!text.trim() && !isF) continue
  out.push(`${ref[0]}${isF ? ` {=${f ?? '?'}}` : ''}  ${JSON.stringify(text)}`)
}
console.log(out.join('\n'))
