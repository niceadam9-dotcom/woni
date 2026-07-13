// 보고서 템플릿/실제 채워진 보고서 구조 조사 (P34-5/P33-3 셀맵 파악용, 읽기 전용)
// 사용: node scripts/_inspect-report-template.mjs
import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'

function load(path) {
  return XLSX.read(readFileSync(path), { type: 'buffer', cellFormula: true, cellNF: true })
}

function sheetList(wb, label) {
  console.log(`\n===== ${label} — 시트 ${wb.SheetNames.length}개 =====`)
  wb.SheetNames.forEach((n, i) => console.log(`  [${i}] ${n}`))
}

const tmpl = load('전체 보고서.xls')
sheetList(tmpl, '전체 보고서.xls (템플릿)')

const filled = load('강순기건물 작동보고서 - 25. 12. 01 주윤종.xls')
sheetList(filled, '강순기건물 작동보고서 (실제 채워짐)')

function dumpSheet(wb, name, maxCells = 200) {
  const ws = wb.Sheets[name]
  if (!ws || !ws['!ref']) { console.log(`\n[${name}] 없음/빈시트`); return }
  const range = XLSX.utils.decode_range(ws['!ref'])
  console.log(`\n----- [${name}] ref=${ws['!ref']} -----`)
  let count = 0
  for (let r = range.s.r; r <= range.e.r && count < maxCells; r++) {
    for (let c = range.s.c; c <= range.e.c && count < maxCells; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (!cell || (cell.v === undefined && !cell.f)) continue
      const v = cell.v === undefined ? '' : String(cell.v).replace(/\n/g, '\\n').slice(0, 40)
      const f = cell.f ? ` =${cell.f.slice(0, 45)}` : ''
      console.log(`  ${addr}: "${v}"${f}`)
      count++
    }
  }
}

const gapji = load('보고서 갑지.xls')
sheetList(gapji, '보고서 갑지.xls (현재 운영 템플릿 소스)')

for (const s of ['현황', '현1', '세1']) {
  dumpSheet(filled, s, 90)
}
