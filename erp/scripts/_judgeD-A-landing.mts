/** 독립 판정자 A — D5 착지수 209의 인과(3-A-002 복구가 정말 +1인가) + F-4 옛 정규식 재구성.
 *  읽기 전용. 실행: npx tsx scripts/_judgeD-A-landing.mts */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { extractDonorItemMap, readCells } from '../src/lib/xlsx-donor-itemmap-extract.ts'
import { allDonorSheets } from '../src/lib/xlsx-donors.ts'
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'

const INSP = process.env.INSP ?? '98e3a13b-881d-4e20-9e42-b68c7c3b88f4'
const zip = await JSZip.loadAsync(readFileSync('templates/report-workbook-full.xlsx'))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(x => [x[1], x[2]]))
const dn = new Set(allDonorSheets())
const sheets: Array<{ name: string; xml: string }> = []
for (const x of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  if (!dn.has(x[1])) continue
  sheets.push({ name: x[1], xml: await zip.file('xl/' + relMap.get(x[2])!.replace(/^\/?xl\//, ''))!.async('string') })
}

const base = extractDonorItemMap(sheets)
const baseCodes = new Set(base.entries.map(e => e.code))

// R-1 되돌림(스1!A5 = A4 코드) — 수리 전 자산의 맵을 재현
const rev = sheets.map(s => ({ name: s.name, xml: s.xml }))
const t = rev.find(s => s.name === '스1')!
const v = readCells(t.xml).val
const a4 = (v.get('A4') ?? '').trim(), a5 = (v.get('A5') ?? '').trim()
t.xml = t.xml.replace(new RegExp(`(<c r="A5"[^>]*><is><t[^>]*>)${a5}(</t>)`), `$1${a4}$2`)
const revEx = extractDonorItemMap(rev)
const revCodes = new Set(revEx.entries.map(e => e.code))

const { data, error } = await raw.from('inspection_sheet_responses')
  .select('item_code').eq('inspection_id', INSP).limit(2000)
if (error) throw new Error(error.message)
const rows = (data ?? []) as Array<{ item_code: string }>
const hitBase = rows.filter(r => baseCodes.has(r.item_code)).length
const hitRev = rows.filter(r => revCodes.has(r.item_code)).length

console.log(`서림사 응답 ${rows.length}건`)
console.log(`  수리 후 맵(${baseCodes.size}코드) 착지 ${hitBase}`)
console.log(`  R-1 되돌린 맵(${revCodes.size}코드) 착지 ${hitRev}  · 되돌림 실패 ${revEx.failures.length}건`)
console.log(`  차이 ${hitBase - hitRev} · 서림사에 ${a5} 응답 있음? ${rows.some(r => r.item_code === a5)}`)

// F-4 옛 정규식 재구성 — 자백의 인과가 성립하는가
const sample = '<c r="C4" s="734"/>'
const old1 = /<c\s[^>]*(?:^|\s)r="C4"/.test(sample)
const old2 = /(?:^|\s)r="C4"/.test('r="C4" s="734"')
console.log(`\nF-4 옛 정규식 재구성: <c\\s[^>]*(?:^|\\s)r=" 형태 → ${old1 ? '매치' : '불일치(자백대로 720 전량 오탐)'}`)
console.log(`  참고: 속성 문자열에만 적용하면 ^가 살아 매치된다 → ${old2}`)
