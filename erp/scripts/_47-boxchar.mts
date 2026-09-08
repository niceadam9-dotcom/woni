/** 체크 글리프의 **실제 코드포인트**를 센다 — `☐`(U+2610)과 `□`(U+25A1)은 눈으로 구별되지 않는다.
 *  정규식이 한쪽만 잡으면 좌정렬이 절반만 걸린다(실제로 그랬다). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { parseTables } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset } from './hwp5-read.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const zf = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const form = parseTables(await zf.file('Contents/section0.xml')!.async('string'))
const { bytes } = readSectionStream(readFileSync(resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')))
const cal = calibrateCellOffset(walkRecords(bytes), form.map(t => t.cells.map(c => ({ row: c.row, col: c.col }))))!
const fills = extractTables(walkRecords(bytes), cal.offset)

const head = new Map<string, number>()
for (const t of fills) for (const c of t.cells) {
  const s = c.text.trimStart()
  if (!s) continue
  const cp = s.codePointAt(0)!
  // 사각형·체크류만 본다
  if ((cp >= 0x2460 && cp <= 0x27BF) || (cp >= 0x25A0 && cp <= 0x25FF) || cp === 0x2610 || cp === 0x2611) {
    const k = `U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${String.fromCodePoint(cp)}`
    head.set(k, (head.get(k) ?? 0) + 1)
  }
}
console.log('셀 첫 글자가 사각형·기호류인 것:')
for (const [k, n] of [...head.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}  ${n}개`)

const total = fills.flatMap(t => t.cells).filter(c => c.text.trim()).length
console.log(`\n(글자 있는 셀 ${total}개 중)`)
console.log('\n현재 정규식 /^\\s*[☐■]/ 이 잡는 수:',
  fills.flatMap(t => t.cells).filter(c => /^\s*[☐■]/.test(c.text)).length)
console.log('넓힌 정규식 /^\\s*[☐■□▣☑✔]/ 이 잡는 수:',
  fills.flatMap(t => t.cells).filter(c => /^\s*[☐■□▣☑✔]/.test(c.text)).length)
