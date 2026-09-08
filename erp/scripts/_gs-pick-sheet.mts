/** 95시트 산출물에서 한 시트만 떼어 렌더용 파일로 — 육안 표본 검사용.
 *  사용: npx tsx scripts/_gs-pick-sheet.mts <시트인덱스|시트이름> */
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'

const SRC = process.argv[3] ?? 'F:\\AI\\sjfire\\_강순기_형식비교\\강순기_소방계획서_50쪽.xlsx'
const DST = 'F:\\AI\\sjfire\\_강순기_형식비교\\render_pick.xlsx'
const key = process.argv[2] ?? '18'

const wb = XLSX.read(readFileSync(SRC), { sheetStubs: true, bookSheets: true })
const idx = /^\d+$/.test(key) ? Number(key) : wb.SheetNames.indexOf(key)
const name = wb.SheetNames[idx]
if (!name) throw new Error(`시트를 못 찾음: ${key} (총 ${wb.SheetNames.length}개)`)

const zip = await JSZip.loadAsync(readFileSync(SRC))
let w = await zip.file('xl/workbook.xml')!.async('string')
const all = [...w.matchAll(/<sheet\b[^>]*\/>/g)].map(m => m[0])
const keep = all.find(s => s.includes(`name="${name}"`))
if (!keep) throw new Error('workbook.xml에서 못 찾음')
for (const s of all) if (s !== keep) w = w.replace(s, '')
w = w.replace(/activeTab="\d+"/, 'activeTab="0"')
zip.file('xl/workbook.xml', w)
writeFileSync(DST, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))

/* 무엇을 보는지 함께 찍는다 — 빈 시트를 '통과'로 읽지 않도록 */
const ws = XLSX.read(readFileSync(SRC), { sheetStubs: true }).Sheets[name]
const r = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
let filled = 0
for (let R = r.s.r; R <= r.e.r; R++) for (let C = r.s.c; C <= r.e.c; C++) {
  const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]
  if (c && c.v !== undefined && String(c.v).trim()) filled++
}
console.log(`[${idx}] «${name}» 범위 ${ws['!ref']} · 값 ${filled}칸 · 병합 ${(ws['!merges'] ?? []).length} → ${DST}`)
