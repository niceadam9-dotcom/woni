/** 정보 시트와 **같은 리터럴을 든 이웃 칸** 색출 — 전 시트 축.
 *  충실도 프로브가 워크북 전체 HTML에서 '( 1 개소 )'·'[√]옥외' 잔존을 잡았다. 정보!B21·B23은
 *  주입되므로 다른 시트에 같은 서식이 또 있다는 뜻이다([[feedback_fix_the_sibling_too]]). */
import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'
import { ANCHORS } from '../src/lib/xlsx-anchors.ts'

const NEEDLES = [
  '( 1 개소 )', '[√]옥외', '[√]철근콘크리트구조', '[√]해당없음', '2024년  1월  1일',
  '[√]소방안전관리자수첩', '[√]작성 (', '[√]가입,', '[√]기타', '[√]실시',
]
const anchored = new Set(ANCHORS.map(a => `${a.sheet}!${a.cell}`))
const out: string[] = []
for (const tpl of ['templates/report-workbook.xlsx', 'templates/report-workbook-full.xlsx']) {
  const wb = XLSX.read(readFileSync(tpl), { cellFormula: true })
  out.push(`\n### ${tpl} (시트 ${wb.SheetNames.length})`)
  for (const s of wb.SheetNames) {
    const ws = wb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const c = ws[k] as XLSX.CellObject
      const v = String(c.v ?? '')
      const hit = NEEDLES.filter(n => v.includes(n))
      if (!hit.length) continue
      out.push(`  ${s}!${k} ${c.f ? `FML(${c.f})` : 'LIT'}${anchored.has(`${s}!${k}`) ? ' [앵커]' : ''}`
        + ` ⊃ ${hit.join(' ')}`)
      out.push(`     ${JSON.stringify(v.slice(0, 110))}`)
    }
  }
}
writeFileSync('scripts/_probe-info-siblings.txt', out.join('\n'), 'utf8')
console.log('ok')
