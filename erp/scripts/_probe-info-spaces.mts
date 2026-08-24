/** 정보 시트 리터럴의 **공백 런 길이** 실측 — 자구 조립에 눈대중을 넣지 않기 위해 */
import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'
const wb = XLSX.read(readFileSync('templates/report-workbook-full.xlsx'))
const out: string[] = []
for (const c of ['B8', 'B10', 'B11', 'B12', 'B13', 'B19', 'B20', 'B21', 'B22', 'B23']) {
  const s = String((wb.Sheets['정보']?.[c] as XLSX.CellObject | undefined)?.v ?? '')
  // 2칸 이상 공백 런을 위치와 길이로 뽑는다(마크 내부의 '[  ]' 2칸도 함께 보인다)
  const runs = [...s.matchAll(/ {2,}/g)].map(m => `@${m.index}×${m[0].length}`)
  out.push(`정보!${c}  런: ${runs.join(' ')}`)
  out.push(`   토큰: ${JSON.stringify(s.split(/(\[√\]|\[ {2}\])/).filter(x => x !== ''))}`)
}
writeFileSync('scripts/_probe-info-spaces.txt', out.join('\n'), 'utf8')
console.log('ok')
