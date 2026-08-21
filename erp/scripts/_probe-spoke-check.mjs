/** 소방계획서_27 — 갑지 스포크가 정말 수식인가 (원본 .xls vs LibreOffice 변환본 .xlsx)
 *  실행: node scripts/_probe-spoke-check.mjs   (_probe-xlsx-gate가 만든 TEMP 산출물을 읽는다) */
import XLSX from 'xlsx'
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const TMP = 'C:/Users/dwhwang/AppData/Local/Temp'
const latest = readdirSync(TMP).filter(d => d.startsWith('x27-')).sort().at(-1)
const TPL = `${TMP}/${latest}/template.xlsx`
console.log('변환본:', existsSync(TPL) ? TPL : '(없음 — _probe-xlsx-gate를 먼저 돌릴 것)')

const targets = [['공문', 'B8'], ['보고서', 'C4'], ['정보', 'B4'], ['위임장', 'C6'], ['계획서', 'B5']]

for (const [label, path] of [['원본 .xls', 'F:/AI/ERP/erp/보고서 갑지.xls'], ['변환 .xlsx', TPL]]) {
  if (!existsSync(path)) continue
  const wb = XLSX.read(readFileSync(path), { cellFormula: true, cellStyles: true })
  console.log(`\n── ${label} ──`)
  for (const [s, c] of targets) {
    const cell = wb.Sheets[s]?.[c]
    console.log(`  ${s}!${c}  v=${JSON.stringify(cell?.v)}  f=${JSON.stringify(cell?.f)}`)
  }
  const hits = []
  for (const s of wb.SheetNames) {
    const ws = wb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const f = ws[k].f
      if (f && /개요/.test(f)) hits.push(`${s}!${k}=${f}`)
    }
  }
  console.log(`  '개요' 참조 수식 ${hits.length}건`)
  for (const h of hits.slice(0, 15)) console.log(`     ${h}`)
  let total = 0
  for (const s of wb.SheetNames) for (const k of Object.keys(wb.Sheets[s])) if (!k.startsWith('!') && wb.Sheets[s][k].f) total++
  console.log(`  수식 총수 ${total}`)
}
