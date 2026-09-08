/** D-8 착수 측정 — 자사 동결 리터럴 19칸의 **전체 값**과 매핑 후보 (소방계획서_43).
 *
 *  `_probe-43-company-literals`는 40자로 잘라 보여줬다. 배선하려면 잘리지 않은 원문과
 *  주변 라벨이 필요하다 — 합성 문자열(「대표이사 X(직인생략)」)은 셀 치환이 아니라 조립이다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-43-company-map.mts */
import fs from 'node:fs'
import JSZip from 'jszip'
import { ANCHORS } from '../src/lib/xlsx-anchors'

const NEEDLES: Array<[field: string, needle: string]> = [
  ['company_name', '승진소방'],
  ['business_number', '586-86-00740'],
  ['representative', '김흥준'],
  ['phone', '031-772-3019'],
  ['fax', '031-772-3018'],
  ['address', '잿말길'],
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
const unesc = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#10;/g, '\\n')

const anchored = new Set(ANCHORS.map(a => `${a.sheet}!${a.cell}`))
const nameForms = new Set<string>()
let total = 0

for (const m of wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
  const [, sheet, rid] = m
  const f = zip.file('xl/' + (relTarget.get(rid) ?? '').replace(/^\/?xl\//, ''))
  if (!f) continue
  const xml = await f.async('string')
  const hits: string[] = []
  for (const c of xml.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) ?? []) {
    const ref = c.match(/r="([A-Z]+\d+)"/)?.[1] ?? '?'
    const t = c.match(/ t="([^"]+)"/)?.[1] ?? 'n'
    const fml = c.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1] ?? null
    const raw = c.match(/<v>([\s\S]*?)<\/v>/)?.[1]
    const inline = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1]
    const v = unesc(t === 's' && raw ? (shared[Number(raw)] ?? '') : (inline ?? raw ?? ''))
    if (!v || fml) continue
    const found = NEEDLES.filter(([, n]) => v.includes(n)).map(([fld]) => fld)
    if (!found.length) continue
    total++
    // 합성 판정 — 값이 니들보다 길면 앞뒤에 서식 문구가 붙어 있다는 뜻
    const exact = NEEDLES.find(([, n]) => v.trim() === n)
    const kind = exact ? '단독' : '합성'
    if (found.includes('company_name')) {
      const mm = v.match(/(주식회사\s*승진소방\s*ENG|㈜승진소방\s*ENG|㈜승진소방ENG|㈜승진소방이엔지)/)
      if (mm) nameForms.add(mm[1])
    }
    hits.push(`    ${ref.padEnd(5)} [${kind}] ${found.join('+')}\n        "${v.length > 110 ? v.slice(0, 110) + '…' : v}"`
      + (anchored.has(`${sheet}!${ref}`) ? '\n        ⚠ 이미 앵커 있음' : ''))
  }
  if (hits.length) console.log(`── ${sheet} (${hits.length}칸) ──\n${hits.join('\n')}`)
}
console.log(`\n총 ${total}칸`)
console.log(`상호 표기 변형 ${nameForms.size}종: ${[...nameForms].join(' | ')}`)
