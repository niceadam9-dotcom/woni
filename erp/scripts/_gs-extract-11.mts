/** 강순기 hwp에서 「서식 1.1 건축물 일반현황」 표를 뽑는다 (읽기 전용).
 *
 *  🚨 강순기는 **실고객 완성 문서**다(소방계획서_42 R-2) — 산출물을 저장소에 쓰지 않는다.
 *     이 스크립트는 화면에만 출력한다.
 *
 *  실행: npx tsx scripts/_gs-extract-11.mts
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { parseTables } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset } from './hwp5-read.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWP = resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')

if (!existsSync(HWP)) { console.log('강순기 원본이 없다:', HWP); process.exit(1) }

const { bytes, compressed } = readSectionStream(readFileSync(HWP))
const records = walkRecords(bytes)
console.log(`Section0 ${bytes.length}바이트(압축=${compressed}) · 레코드 ${records.length}개`)
if (records.length < 100) { console.log('레코드가 너무 적다 — 읽기 실패(눈멂 가드)'); process.exit(2) }

const zip = await JSZip.loadAsync(readFileSync(HWPX))
const formTables = parseTables(await zip.file('Contents/section0.xml')!.async('string'))
const truth = formTables.map(t => t.cells.map(c => ({ row: c.row, col: c.col })))
const cal = calibrateCellOffset(records, truth)
console.log(`좌표 보정: ${cal ? `offset=${cal.offset} 일치율=${(cal.hitRate * 100).toFixed(1)}%` : '실패'}`)

const tables = extractTables(records, cal?.offset ?? 8)
console.log(`표 ${tables.length}개 (양식 hwpx는 ${formTables.length}개)\n`)

/* 서식 1.1 = 「건축물 일반현황」 — 라벨로 찾는다(인덱스로 세지 않는다) */
const KEYS = ['명 칭', '명칭', '도로명주소', '연 락 처', '수신기위치', '대상물 급수']
const hits = tables
  .map((t, i) => ({ i, t, score: KEYS.filter(k => t.cells.some(c => c.text.replace(/\s/g, '').includes(k.replace(/\s/g, '')))).length }))
  .filter(x => x.score >= 3)
  .sort((a, b) => b.score - a.score)

console.log(`서식 1.1 후보 ${hits.length}개: ${hits.map(h => `표#${h.i}(점수${h.score}·${h.t.rowCnt}x${h.t.colCnt}·셀${h.t.cells.length})`).join(', ')}\n`)

for (const h of hits.slice(0, 2)) {
  const t = h.t
  console.log(`══════ 표 #${t.index} (depth ${t.depth}) — ${t.rowCnt}행 × ${t.colCnt}열 · 셀 ${t.cells.length}개 ══════`)
  // 좌표가 있으면 격자로, 없으면 순서대로
  const hasCoord = t.cells.every(c => c.row !== null && c.col !== null)
  if (hasCoord) {
    const byRow = new Map<number, typeof t.cells>()
    for (const c of t.cells) {
      if (!byRow.has(c.row!)) byRow.set(c.row!, [])
      byRow.get(c.row!)!.push(c)
    }
    for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
      const cells = byRow.get(r)!.sort((a, b) => a.col! - b.col!)
      console.log(`  r${String(r).padStart(2)} | ` + cells.map(c =>
        `c${c.col}${(c.rowSpan ?? 1) > 1 || (c.colSpan ?? 1) > 1 ? `(${c.rowSpan}x${c.colSpan})` : ''}=${JSON.stringify(c.text.replace(/\s+/g, ' ').trim())}`
      ).join('  '))
    }
  } else {
    console.log('  ⚠ 좌표 없음 — 순서대로 출력')
    t.cells.forEach((c, i) => console.log(`  [${i}] ${JSON.stringify(c.text.replace(/\s+/g, ' ').trim())}`))
  }
  console.log()
}
