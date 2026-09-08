/** 조사 — 갑지 템플릿에서 **자사 정보가 동결 리터럴로 박힌 칸**을 전 시트에서 찾는다(43 D-8).
 *
 *  완료보고서 5칸만 보고 고치면 [[feedback_fix_the_sibling_too]] 함정에 빠진다. 같은 값의
 *  정본은 DB `company_profile`(화면 편집 가능)이고 PDF는 그 값을 인쇄하므로, 리터럴로 박힌
 *  칸은 회사 정보가 바뀌는 순간 조용히 갈라진다.
 *
 *  판정: 리터럴(수식 없음)이면 위험, 수식(`=개요!…` 등)이면 이미 배선된 것.
 *  실행: npx tsx --conditions=react-server scripts/_probe-43-company-literals.mts */
import fs from 'node:fs'
import JSZip from 'jszip'

const NEEDLES: Array<[string, string]> = [
  ['업체명', '승진소방'],
  ['사업자번호', '586-86-00740'],
  ['대표이사', '김흥준'],
  ['전화', '031-772-3019'],
  ['소재지', '잿말길'],
  ['팩스', '031-772-3018'],
]

const zip = await JSZip.loadAsync(fs.readFileSync('templates/report-workbook-full.xlsx'))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relTarget = new Map([...relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))

const shared: string[] = []
const ss = zip.file('xl/sharedStrings.xml')
if (ss) {
  for (const si of (await ss.async('string')).match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
  }
}

let literal = 0, formula = 0
const bySheet = new Map<string, string[]>()
for (const m of wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
  const [, name, rid] = m
  const path = 'xl/' + (relTarget.get(rid) ?? '').replace(/^\/?xl\//, '')
  const f = zip.file(path)
  if (!f) continue
  const xml = await f.async('string')
  for (const c of xml.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) ?? []) {
    const ref = c.match(/r="([A-Z]+\d+)"/)?.[1] ?? '?'
    const t = c.match(/ t="([^"]+)"/)?.[1] ?? 'n'
    const fml = c.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1] ?? null
    const raw = c.match(/<v>([\s\S]*?)<\/v>/)?.[1]
    const inline = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1]
    const v = t === 's' && raw ? (shared[Number(raw)] ?? '') : (inline ?? raw ?? '')
    if (!v) continue
    const hit = NEEDLES.find(([, n]) => v.includes(n))
    if (!hit) continue
    if (fml) { formula++; continue }             // 이미 배선됨 — 원천이 하나다
    literal++
    if (!bySheet.has(name)) bySheet.set(name, [])
    bySheet.get(name)!.push(`${ref}(${hit[0]}) "${v.slice(0, 40)}"`)
  }
}

console.log(`동결 리터럴 ${literal}칸 · 수식(배선됨) ${formula}칸\n`)
for (const [sheet, cells] of [...bySheet].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${sheet} — ${cells.length}칸`)
  for (const c of cells) console.log(`      ${c}`)
}
