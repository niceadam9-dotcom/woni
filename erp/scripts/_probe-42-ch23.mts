/** 소방계획서_42 2단계 설계 조사 — 제2·3장(표 #44~#94)을 시트로 어떻게 가를지 실측한다.
 *
 *  🚨 **산출물을 저장소에 두지 않는다**(%TEMP%). 스크럽 **전** 원문이라 표본 고객의 실명·
 *    개인 휴대폰·내부 메모가 그대로 찍힌다(R-2). `_probe-42-outline.mts`가 제1장에 한 일을
 *    제2·3장에 하는 것이고, 그쪽과 달리 산출 경로만 저장소 밖으로 뺐다.
 *
 *  묻는 것: ①제2장·제3장이 각각 어디서 시작·끝나는가 ②배너 표가 어디인가
 *  ③중첩표(depth>0)가 어느 표에 걸리는가(S1-1이 미리 대응해 둔 자리) ④열 경계가 같은
 *  연속 표가 실제로 몇 쌍인가(S3-1 세로 병합 후보 — 제1장엔 0쌍이었다).
 *
 *  실행: npx tsx scripts/_probe-42-ch23.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import JSZip from 'jszip'
import { parseTables, columnEdges } from '../src/lib/hwpx-table.ts'

const LINES: string[] = []
const say = (...a: unknown[]) => LINES.push(a.map(String).join(' '))

const HERE = dirname(fileURLToPath(import.meta.url))
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')

const zip = await JSZip.loadAsync(readFileSync(HWPX))
const tables = parseTables(await zip.file('Contents/section0.xml')!.async('string'))
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

// 장 경계 — 1행짜리 배너에서 '제N장'을 찾는다(제1장 지도가 CH1_END를 그렇게 구했다)
const chapterAt = (n: number) =>
  tables.findIndex(t => t.rowCnt === 1 && t.cells.some(c => new RegExp(`제\\s*${n}\\s*장`).test(c.text)))
const CH2 = chapterAt(2), CH3 = chapterAt(3), CH4 = chapterAt(4)
say(`표 ${tables.length}`)
say(`제2장 배너 #${CH2} · 제3장 배너 #${CH3} · 제4장 배너 #${CH4}`)
say(`→ 제2장 = #${CH2}..#${CH3 - 1} (${CH3 - CH2}표) · 제3장 = #${CH3}..#${CH4 < 0 ? tables.length - 1 : CH4 - 1} (${(CH4 < 0 ? tables.length : CH4) - CH3}표)`)

say('\n[1] 표 목록 #44.. (index · rowxcol · depth · 첫 3셀)')
for (const t of tables) {
  if (t.index < CH2) continue
  const head = [...t.cells].sort((a, b) => (a.row - b.row) || (a.col - b.col))
    .slice(0, 3).map(c => oneLine(c.text).slice(0, 30)).filter(Boolean).join(' | ')
  say(`#${String(t.index).padStart(2)} ${String(t.rowCnt).padStart(3)}x${String(t.colCnt).padStart(2)}`
    + ` d${t.depth}${t.parent === null ? '' : `<-${t.parent}`}  ${head}`)
}

say('\n[2] 배너 후보 — 1행짜리 표')
for (const t of tables) {
  if (t.index < CH2 || t.rowCnt !== 1) continue
  say(`  #${t.index} ${t.rowCnt}x${t.colCnt}  ${oneLine(t.cells.map(c => c.text).join(' / ')).slice(0, 90)}`)
}

say('\n[3] 중첩표(depth>0) — S1-1이 미리 대응해 둔 자리')
for (const t of tables) if (t.depth > 0) say(`  #${t.index} ${t.rowCnt}x${t.colCnt} d${t.depth} <- 부모 #${t.parent}`)

say('\n[4] 열 경계 벡터가 동일한 연속 표 (세로 병합 후보)')
{
  const key = (i: number) => columnEdges(tables[i]).join(',')
  let runStart = CH2
  for (let i = CH2 + 1; i <= tables.length; i++) {
    if (i < tables.length && tables[i].depth === 0 && tables[runStart].depth === 0 && key(i) === key(runStart)) continue
    if (i - runStart > 1) say(`  #${runStart}..#${i - 1} (${i - runStart}표) colCnt=${tables[runStart].colCnt}`)
    runStart = i
  }
}

say('\n[5] {{token}} — 제2·3장에 씨앗이 있는가')
{
  const tok = new Map<string, string[]>()
  for (const t of tables) {
    if (t.index < CH2) continue
    for (const c of t.cells) for (const m of c.text.matchAll(/\{\{([^}]+)\}\}/g)) {
      const k = m[1]
      if (!tok.has(k)) tok.set(k, [])
      tok.get(k)!.push(`#${t.index}(${c.row},${c.col})`)
    }
  }
  say(`  고유 ${tok.size}종`)
  for (const [k, at] of tok) say(`    {{${k}}} ×${at.length}  ${at.slice(0, 6).join(' ')}`)
}

say('\n[6] 제2·3장 표 전문 — 셀 전수(좌표·글)')
for (const t of tables) {
  if (t.index < CH2 || (CH4 >= 0 && t.index >= CH4)) continue
  say(`\n  ── #${t.index} ${t.rowCnt}x${t.colCnt} d${t.depth}${t.parent === null ? '' : `<-${t.parent}`} ──`)
  for (const c of [...t.cells].sort((a, b) => (a.row - b.row) || (a.col - b.col))) {
    const s = oneLine(c.text)
    if (!s) continue
    const span = (c.rowSpan > 1 || c.colSpan > 1) ? `+${c.rowSpan}x${c.colSpan}` : ''
    say(`    (${c.row},${c.col})${span}  ${s.slice(0, 120)}`)
  }
}

const dest = join(process.env.TEMP ?? '.', '_probe-42-ch23.txt')
writeFileSync(dest, LINES.join('\n'), 'utf8')
console.log(`wrote ${dest} (${LINES.length} lines)`)
