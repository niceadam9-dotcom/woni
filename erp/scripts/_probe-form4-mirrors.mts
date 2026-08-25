/** 별지 4호 설치칸·점검결과칸을 **단일 참조로 복제**하는 칸 전수(폐포 전파 대상) 실측 */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { sheetFileMap, buildRefGraph, transitiveClosure } from '../src/lib/xlsx-inject.ts'
import { FORM4_ROWS, FORM4_SHEET, FORM4_UNWIRED } from '../src/lib/xlsx-form4.ts'

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(process.argv[2] ?? 'templates/report-workbook.xlsx')))
const files = await sheetFileMap(zip)
const edges = await buildRefGraph(zip, files)

const show = (title: string, cells: string[]) => {
  let total = 0
  const lines: string[] = []
  for (const c of cells) {
    const d = transitiveClosure(edges, FORM4_SHEET, c)
    total += d.length
    if (d.length) lines.push(`  ${FORM4_SHEET}!${c} → ${d.map(x => `${x.sheet}!${x.cell}`).join(', ')}`)
  }
  console.log(`\n=== ${title} — 복제 ${total}칸 (씨앗 ${lines.length}/${cells.length}) ===`)
  console.log(lines.join('\n') || '  (없음)')
  return total
}

show('설치 체크칸(배선)', FORM4_ROWS.map(r => r.cell))
show('점검결과칸(배선)', FORM4_ROWS.map(r => r.verdictCell).filter(Boolean) as string[])
show('미배선 설치칸', FORM4_UNWIRED.map(u => u.cell))
show('미배선 점검결과칸', FORM4_UNWIRED.map(u => u.verdictCell))
