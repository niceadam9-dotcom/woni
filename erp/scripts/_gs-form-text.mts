/** 양식 hwpx(placeholder)의 서식 1.1 본문 — ERP 양식으로 쓰려면 **여기 글자**가 원천이어야 한다.
 *  지금 산출물은 강순기(실고객) 값을 담고 있어 양식으로 쓸 수 없다. 무엇으로 갈아끼울지 본다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { parseTables } from '../src/lib/hwpx-table.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const zip = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const tables = parseTables(await zip.file('Contents/section0.xml')!.async('string'))
const t = tables.find(x => x.cells.some(c => c.text.replace(/\s/g, '').includes('도로명주소')))!

console.log(`서식 1.1 = ${t.rowCnt}행×${t.colCnt}열 · 셀 ${t.cells.length}\n`)
const byRow = new Map<number, typeof t.cells>()
for (const c of t.cells) { if (!byRow.has(c.row)) byRow.set(c.row, []); byRow.get(c.row)!.push(c) }
for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
  const line = byRow.get(r)!.sort((a, b) => a.col - b.col)
    .map(c => `c${c.col}=${JSON.stringify(c.text.replace(/\s+/g, ' ').trim())}`).join(' ')
  console.log(` r${String(r).padStart(2)} | ${line}`)
}

/* 토큰이 있나 */
const all = tables.flatMap(x => x.cells.map(c => c.text)).join('\n')
const tokens = [...new Set([...all.matchAll(/\{\{[^}]+\}\}/g)].map(m => m[0]))]
console.log(`\n전 표의 토큰 ${tokens.length}종: ${tokens.join(', ') || '(없음)'}`)
const filled = tables.flatMap(x => x.cells).filter(c => c.text.trim() && !/^[☐■※]/.test(c.text.trim())).length
console.log(`글자 있는 셀 ${filled}개 (라벨 위주라면 양식으로 바로 쓸 수 있다)`)
