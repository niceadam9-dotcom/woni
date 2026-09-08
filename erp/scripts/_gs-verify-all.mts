/** 95시트 산출물 전수 검증 — 기준은 산출물이 아니라 **강순기 hwp 원문**이다.
 *  '몇 칸 썼다'가 아니라 '원문의 글자가 전부 실렸는가'를 본다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { parseTables } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset } from './hwp5-read.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = process.argv[2] ?? 'F:\\AI\\sjfire\\_강순기_형식비교\\E_자동미세격자_강순기.xlsx'

const zf = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const form = parseTables(await zf.file('Contents/section0.xml')!.async('string'))
const { bytes } = readSectionStream(readFileSync(resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')))
const rec = walkRecords(bytes)
const cal = calibrateCellOffset(rec, form.map(t => t.cells.map(c => ({ row: c.row, col: c.col }))))!
const fill = extractTables(rec, cal.offset)

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const srcAll = new Set<string>()
let srcCells = 0
for (const t of fill) for (const c of t.cells) { const v = norm(c.text); if (v) { srcAll.add(v); srcCells++ } }

const wb = XLSX.read(readFileSync(OUT), { sheetStubs: true })
const gotAll = new Set<string>()
let gotCells = 0
for (const n of wb.SheetNames) {
  const ws = wb.Sheets[n]
  if (!ws['!ref']) continue
  const r = XLSX.utils.decode_range(ws['!ref'])
  for (let R = r.s.r; R <= r.e.r; R++) for (let C = r.s.c; C <= r.e.c; C++) {
    const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]
    if (c && c.v !== undefined) { const v = norm(String(c.v)); if (v) { gotAll.add(v); gotCells++ } }
  }
}

console.log(`시트 ${wb.SheetNames.length}개`)
console.log(`원문 글자 있는 셀 ${srcCells} · 고유 ${srcAll.size}`)
console.log(`산출물 글자 있는 셀 ${gotCells} · 고유 ${gotAll.size}`)

const missing = [...srcAll].filter(v => !gotAll.has(v))
/* 이어 붙은 칸(머리 블록 합치기) 안에 들어 있는 것과 **정말 없는 것**을 가른다.
   둘을 뭉뚱그리면 진짜 유실을 '표기 문제'로 덮게 된다. */
const joined = missing.filter(v => [...gotAll].some(g => g.includes(v)))
const gone = missing.filter(v => !joined.includes(v))
console.log(`\n🎯 원문 고유 문자열 ${srcAll.size}개 중`)
console.log(`   그대로 있는 것        ${srcAll.size - missing.length}`)
console.log(`   이어 붙은 칸 안에 있음 ${joined.length}${joined.length ? ' — ' + joined.slice(0, 4).map(v => JSON.stringify(v.slice(0, 30))).join(', ') : ''}`)
console.log(`   🚨 정말 없는 것        ${gone.length}${gone.length ? '\n' + gone.slice(0, 20).map(v => `      ${JSON.stringify(v.slice(0, 50))}`).join('\n') : ''}`)

/* 체크 상태 보존 */
const srcChk = [...srcAll].filter(v => v.startsWith('■')).length
const gotChk = [...gotAll].filter(v => v.startsWith('■')).length
console.log(`\n체크(■) 고유 문자열: 원문 ${srcChk} · 산출물 ${gotChk}`)

/* 시트 이름 훑기 */
console.log(`\n시트 이름 앞 20개:\n  ${wb.SheetNames.slice(0, 20).join(' | ')}`)
