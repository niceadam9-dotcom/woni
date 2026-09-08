/** 소방계획서_42 — 1.9.3 입주사 현황 반복행의 스타일이 왜 갈리는가.
 *  묻는 것: 원본 hwpx가 그렇게 생겼는가, 아니면 내 빌더가 만든 것인가.
 *  실행: npx tsx scripts/_probe-42-rowstyle.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import JSZip from 'jszip'
import { parseTables, parseBorderFills } from '../src/lib/hwpx-table.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')

const L: string[] = []
const say = (s: string) => L.push(s)

const zip = await JSZip.loadAsync(readFileSync(HWPX))
const tables = parseTables(await zip.file('Contents/section0.xml')!.async('string'))
const { fills } = parseBorderFills(await zip.file('Contents/header.xml')!.async('string'))

for (const [idx, why] of [[23, '1.9.3 입주사 현황'], [2, '개정이력(대조군 — 통과한 표)']] as const) {
  const t = tables[idx]
  say(`\n══ 표 #${idx} ${why} — ${t.rowCnt}x${t.colCnt} ══`)
  say('  row | ' + Array.from({ length: t.colCnt }, (_, c) => `c${c}`.padStart(5)).join(''))
  for (let r = 0; r < t.rowCnt; r++) {
    const cells = t.cells.filter(c => c.row === r).sort((a, b) => a.col - b.col)
    const line = Array.from({ length: t.colCnt }, (_, c) => {
      const cell = cells.find(x => x.col === c)
      return cell ? String(cell.borderFillId).padStart(5) : '    .'
    }).join('')
    const txt = cells.map(c => c.text.trim()).filter(Boolean).join('|').slice(0, 30)
    say(`  ${String(r).padStart(3)} | ${line}   ${txt}`)
  }
  // 갈라지는 borderFill 두 개의 실제 차이
  const ids = [...new Set(t.cells.map(c => c.borderFillId))]
  say(`  쓰인 borderFill: ${ids.join(', ')}`)
  for (const id of ids) {
    const f = fills.get(id)
    say(`    #${id}  L=${f?.left} R=${f?.right} T=${f?.top} B=${f?.bottom} fill=${f?.faceColor ?? '-'}`)
  }
}

writeFileSync(join(HERE, '_out-42-rowstyle.txt'), L.join('\n'), 'utf8')
console.log(`wrote ${L.length} lines`)
