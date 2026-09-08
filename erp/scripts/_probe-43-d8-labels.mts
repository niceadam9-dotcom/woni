/** D-8 안전 4칸 — 앵커 라벨 후보와 값 일치 확인 (소방계획서_43).
 *  배선은 "DB 값이 템플릿과 **글자까지 같다**"는 전제 위에 선다. 그 전제를 여기서 못박는다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-43-d8-labels.mts */
import './_env.mjs'
import fs from 'node:fs'
import JSZip from 'jszip'
import { createAdminClient } from '../src/lib/supabase/admin'
import { formatTel } from '../src/lib/format-contact'

const TARGETS: Array<[sheet: string, from: number, to: number]> = [
  ['완료보고서', 11, 16],
  ['계약서', 26, 30],
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
const unesc = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#10;/g, '\\n')

for (const [sheet, from, to] of TARGETS) {
  const hit = [...wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)].find(m => m[1] === sheet)!
  const xml = await zip.file('xl/' + (relTarget.get(hit[2]) ?? '').replace(/^\/?xl\//, ''))!.async('string')
  console.log(`── ${sheet} 행 ${from}~${to} ──`)
  for (const c of xml.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) ?? []) {
    const ref = c.match(/r="([A-Z]+\d+)"/)?.[1]
    if (!ref) continue
    const row = Number(ref.match(/\d+$/)![0])
    if (row < from || row > to) continue
    const t = c.match(/ t="([^"]+)"/)?.[1] ?? 'n'
    const f = c.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1]
    const raw = c.match(/<v>([\s\S]*?)<\/v>/)?.[1]
    const inline = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1]
    const v = unesc(t === 's' && raw ? (shared[Number(raw)] ?? '') : (inline ?? raw ?? ''))
    if (!v && !f) continue
    console.log(`   ${ref.padEnd(5)} ${f ? `f==${f}`.padEnd(18) : ''.padEnd(18)} "${v}"`)
  }
  console.log('')
}

const admin = createAdminClient()
const { data } = await admin.from('company_profile').select('*').limit(1)
const row = (data?.[0] ?? {}) as Record<string, string>
console.log('── 값이 템플릿과 글자까지 같은가(배선의 전제) ──')
const pairs: Array<[string, string, string]> = [
  ['완료보고서!I12 사업자번호', row.business_number, '586-86-00740'],
  ['완료보고서!C14 대표이사', row.representative, '김흥준'],
  ['완료보고서!F14 전화(formatTel)', formatTel(row.phone), '031-772-3019'],
  ['계약서!H28 전화(formatTel)', formatTel(row.phone), '031-772-3019'],
]
for (const [name, dbv, tplv] of pairs) {
  console.log(`   ${dbv === tplv ? '✅' : '❌'} ${name.padEnd(30)} DB="${dbv}" 템플릿="${tplv}"`)
}
