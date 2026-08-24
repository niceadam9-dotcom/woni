/** 다수동일때 시트 전 값 셀 — 수식(허브 종속) vs 리터럴(표본 고정) 판별.
 *  이 시트는 코드가 한 번도 언급하지 않는다(grep 0) — 즉 **손 안 댄 채로 전 고객에게 나간다**.
 *  2·3·4동 블록이라 ERP의 단일 동 데이터로는 채울 수 없다 → 표본 답이 남았는지가 관건이다. */
import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'
const wb = XLSX.read(readFileSync('templates/report-workbook-full.xlsx'), { cellFormula: true })
const out: string[] = []
const ws = wb.Sheets['다수동일때']
out.push(`### 다수동일때 — 값 셀 (범위 ${ws['!ref']})`)
let lit = 0, fml = 0
for (const k of Object.keys(ws).filter(k => !k.startsWith('!')).sort((a, b) => {
  const ma = /^([A-Z]+)(\d+)$/.exec(a)!, mb = /^([A-Z]+)(\d+)$/.exec(b)!
  return Number(ma[2]) - Number(mb[2]) || ma[1].localeCompare(mb[1])
})) {
  const c = ws[k] as XLSX.CellObject
  const v = String(c.v ?? '')
  if (c.f) { fml++; out.push(`  ${k.padEnd(5)} FML f=${c.f} v=${JSON.stringify(v.slice(0, 40))}`); continue }
  lit++
  // 표본 종속 의심 — √ 마크나 숫자·날짜를 든 리터럴
  const susp = /√|개소|\d/.test(v)
  out.push(`  ${k.padEnd(5)} LIT${susp ? ' ⚠' : '  '} ${JSON.stringify(v.slice(0, 90))}`)
}
out.push(`\n리터럴 ${lit} · 수식 ${fml}`)
writeFileSync('scripts/_probe-multibldg-dump.txt', out.join('\n'), 'utf8')
console.log('ok')
