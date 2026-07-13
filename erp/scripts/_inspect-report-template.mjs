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

// 현황 시트: 설비명(E/F, AA/AB 열) + 체크박스(C/D, Y/Z 열) + 결과수식(S, AO 열) 전체 맵
function dumpHyeonhwang(wb, label) {
  const ws = wb.Sheets['현황']
  if (!ws || !ws['!ref']) { console.log(`\n[${label} 현황] 없음`); return }
  const range = XLSX.utils.decode_range(ws['!ref'])
  console.log(`\n===== [${label}] 현황 ref=${ws['!ref']} — 설비명·체크박스·결과 =====`)
  for (let r = range.s.r; r <= range.e.r; r++) {
    const get = (col) => { const c = ws[XLSX.utils.encode_cell({ r, c: XLSX.utils.decode_col(col) })]; return c ? String(c.v ?? '').replace(/\n/g, ' ').trim() : '' }
    const getf = (col) => { const c = ws[XLSX.utils.encode_cell({ r, c: XLSX.utils.decode_col(col) })]; return c?.f ? `=${c.f}` : '' }
    // 좌측 블록: C/D 체크, E/F 설비명, S 결과 | 우측: Y/Z 체크, AA/AB 설비명, AO 결과
    const lname = get('E') || get('F')
    const rname = get('AA') || get('AB')
    if (!lname && !rname) continue
    const lchk = get('C') || get('D'), rchk = get('Y') || get('Z')
    const lres = get('S') + (getf('S') ? ` ${getf('S')}` : '')
    const rres = get('AO') + (getf('AO') ? ` ${getf('AO')}` : '')
    console.log(`  R${r + 1} L[chk C=${get('C')}|D=${get('D')}] "${lname}" S=${lres}   ||   R[chk Y=${get('Y')}|Z=${get('Z')}] "${rname}" AO=${rres}`)
  }
}

dumpHyeonhwang(gapji, '갑지 템플릿(blank)')

for (const s of ['계획서', '완료보고서']) dumpSheet(filled, s, 70)
