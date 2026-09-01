/** Phase 4 / S9-1 — 「현1」 통문자열 셀 자구 실측 (소방계획서_27 S9-4가 확정한 축).
 *
 *  왜 이 축인가: `_scope31-spec-confirm`이 '라벨 | 값 칸' 모델을 반증했다(A등급 0건).
 *  이 시트들은 값이 **문자열 안 슬롯**(체크 마크 위치·괄호 안)에 들어가는 √ 통문자열 부류로,
 *  `정보` 12칸(S7-4)·`다수동일때` 15칸(S7-5)과 같다. 그래서 배선은 서식 원문과 **자구 동일**하게
 *  문자열을 재조립하는 것이고, 그 전제가 공백 런까지 정확한 원문 실측이다(_probe-info-spaces 방식).
 *
 *  ⚠ 공백은 눈으로 셀 수 없다 — 런 길이를 명시적으로 찍는다.
 *  ⚠ SheetJS 금지(D-8) — 캐시 없는 수식 셀을 통째로 건너뛴다. 원시 XML 축으로만 본다.
 */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

const SHEET = process.argv[2] ?? '현1'

const zip = await JSZip.loadAsync(readFileSync('templates/report-workbook-full.xlsx'))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const sheets = [...wbXml.matchAll(/<sheet[^>]*\sname="([^"]+)"[^>]*r:id="([^"]+)"/g)]
  .map(m => ({ name: m[1], path: 'xl/' + relMap.get(m[2])!.replace(/^\//, '').replace(/^xl\//, '') }))
const hit = sheets.find(s => s.name === SHEET)!

let shared: string[] = []
const ssFile = zip.file('xl/sharedStrings.xml')
if (ssFile) {
  const ss = await ssFile.async('string')
  shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))
}
const dec = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&')

/** 공백 런을 보이게 — 연속 공백 n칸을 ·n 으로, 줄바꿈을 \n 으로 */
function visible(s: string): string {
  return s.replace(/\n/g, '\\n').replace(/ {2,}/g, m => `·${m.length}·`)
}

const xml = await zip.file(hit.path)!.async('string')
const rows: Array<{ ref: string; text: string }> = []
// ⚠ 자기닫힘 `<c .../>`를 **분기로** 받는다. `\/?>` 하나로 뭉뚱그리면 빈 셀의 body가
// 다음 `</c>`까지 삼켜 **다음 셀의 값이 앞 셀 좌표로 귀속**된다(소방계획서_27.md:197이
// 계약서!A3에서 겪은 함정. 내 첫 판본이 정확히 이걸 밟아 E3에 J3의 값을 붙였다).
for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
  const attrs = m[1], body = m[2] ?? ''
  const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '?'
  const t = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
  if (/<f[ >]/.test(body)) continue
  let text = ''
  if (t === 's') { const v = /<v>(\d+)<\/v>/.exec(body)?.[1]; if (v != null) text = shared[+v] ?? '' }
  else if (t === 'inlineStr') text = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')
  else text = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
  text = dec(text)
  if (!text.trim()) continue
  // 통문자열 = 수식 없는 리터럴 중 **마크 대괄호** 또는 **괄호 write-in 슬롯**을 가진 칸
  // (소방계획서_27 S9-4가 확정한 정의 — 순수 라벨은 배선 불필요라 제외한다)
  const hasMark = /\[\s*[√✓✔]?\s*\]/.test(text)
  const hasSlot = /[(（][ 　]*[)）]/.test(text)
  if (!hasMark && !hasSlot) continue
  rows.push({ ref, text })
}

// 행→열 순 정렬 (A10이 A9보다 뒤로 가게 숫자 비교)
const key = (r: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(r)!
  return [+m[2], m[1]] as [number, string]
}
rows.sort((a, b) => {
  const [ra, ca] = key(a.ref), [rb, cb] = key(b.ref)
  return ra - rb || ca.localeCompare(cb)
})

console.log(`sheet=${SHEET}  through-string cells=${rows.length}`)
console.log('(· n · = a run of n spaces)')
console.log('='.repeat(78))
for (const { ref, text } of rows) {
  const marks = [...text.matchAll(/\[\s*([√✓✔])?\s*\]/g)].length
  const filled = [...text.matchAll(/\[\s*[√✓✔]\s*\]/g)].length
  const slots = [...text.matchAll(/[(（]\s{2,}[)）]/g)].length
  console.log(`${ref.padEnd(5)} marks=${String(marks).padStart(2)} filled=${filled} slots=${slots}`)
  console.log(`      ${visible(text)}`)
}
