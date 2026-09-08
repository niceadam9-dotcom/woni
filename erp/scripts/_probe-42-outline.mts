/** 소방계획서_42 S3 설계 조사 — 95표를 시트로 어떻게 가를지 실측한다(일회성).
 *
 *  🚨 **출력물(`_out-42-outline.txt`)을 커밋하지 말 것.** 양식 hwpx에는 표본 고객의 실명·
 *    개인 휴대폰·내부 업무 메모가 리터럴로 남아 있고(FIRE_PLAN_SCRUB_RULES 참조) 이 스크립트는
 *    스크럽 **전** 원문을 그대로 찍는다. 산출물은 저장소 밖에서 보고 지운다(R-2).
 *
 *  묻는 것: ①서식 번호·제목이 어느 표에서 나오는가(배너 표) ②제1장이 어디서 끝나는가
 *  ③열 경계 벡터가 같은 연속 표가 실제로 몇 쌍인가(S3-1 세로 병합 후보).
 *
 *  실행: npx tsx scripts/_probe-42-outline.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import JSZip from 'jszip'
import { parseTables, parseBorderFills, columnEdges } from '../src/lib/hwpx-table.ts'

// ⚠ PowerShell 5.1로 한글을 흘리면 CP949 모지바케가 된다 — 파일로 직접 쓴다(UTF-8)
const LINES: string[] = []
const console = { log: (...a: unknown[]) => LINES.push(a.map(String).join(' ')) }

const HERE = dirname(fileURLToPath(import.meta.url))
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')

const zip = await JSZip.loadAsync(readFileSync(HWPX))
const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
const headerXml = await zip.file('Contents/header.xml')!.async('string')
const tables = parseTables(sectionXml)
const { fills, unknownBorderTypes } = parseBorderFills(headerXml)

console.log(`표 ${tables.length} · borderFill ${fills.size} · 미지 ${unknownBorderTypes.length}`)

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

console.log('\n[1] 표 목록 (index · rowxcol · depth · 첫 3셀 글)')
for (const t of tables) {
  const head = t.cells
    .slice()
    .sort((a, b) => (a.row - b.row) || (a.col - b.col))
    .slice(0, 3)
    .map(c => oneLine(c.text).slice(0, 26))
    .filter(Boolean)
    .join(' | ')
  const edges = columnEdges(t)
  console.log(
    `#${String(t.index).padStart(2)} ${String(t.rowCnt).padStart(3)}x${String(t.colCnt).padStart(2)}`
    + ` d${t.depth}${t.parent === null ? '' : `<-${t.parent}`}`
    + ` w=${edges[t.colCnt]}  ${head}`,
  )
}

console.log('\n[2] 배너 후보 — 1행짜리 표(서식 제목 줄)')
for (const t of tables) {
  if (t.rowCnt !== 1) continue
  console.log(`  #${t.index} ${t.rowCnt}x${t.colCnt}  ${oneLine(t.cells.map(c => c.text).join(' / ')).slice(0, 90)}`)
}

console.log('\n[3] 「서식」 문자열이 든 셀 전수 (표·좌표)')
for (const t of tables) {
  for (const c of t.cells) {
    if (!/서\s*식|^\s*\d+\.\d+/.test(c.text)) continue
    const s = oneLine(c.text)
    if (s.length > 60) continue
    console.log(`  #${t.index} (${c.row},${c.col})  ${s}`)
  }
}

console.log('\n[4] 열 경계 벡터가 동일한 연속 표 (S3-1 세로 병합 후보)')
let runStart = 0
const key = (i: number) => columnEdges(tables[i]).join(',')
for (let i = 1; i <= tables.length; i++) {
  if (i < tables.length && tables[i].depth === 0 && tables[runStart].depth === 0 && key(i) === key(runStart)) continue
  if (i - runStart > 1) console.log(`  #${runStart}..#${i - 1} (${i - runStart}표) colCnt=${tables[runStart].colCnt}`)
  runStart = i
}

console.log('\n[5] 체크박스 글자 인구조사')
const census = new Map<string, number>()
for (const t of tables) for (const c of t.cells) {
  for (const ch of c.text) {
    if (ch === '□' || ch === '☐' || ch === '■' || ch === '☑' || ch === '▣') {
      census.set(ch, (census.get(ch) ?? 0) + 1)
    }
  }
}
for (const [ch, n] of census) console.log(`  ${ch} U+${ch.codePointAt(0)!.toString(16).toUpperCase()} — ${n}`)

console.log('\n[6] {{token}} 인구조사')
const tokens = new Map<string, number>()
for (const t of tables) for (const c of t.cells) {
  for (const m of c.text.matchAll(/\{\{([^}]+)\}\}/g)) tokens.set(m[1], (tokens.get(m[1]) ?? 0) + 1)
}
console.log(`  고유 ${tokens.size}종`)
for (const [k, n] of [...tokens].sort((a, b) => b[1] - a[1])) console.log(`    {{${k}}} ×${n}`)

console.log('\n[7] 제1장 범위 표 전문 — 셀 전수(좌표·글)')
const CH1_END = tables.findIndex(t => t.rowCnt === 1 && t.cells.some(c => /제\s*2\s*장/.test(c.text)))
console.log(`  제1장 = 표 #0 .. #${CH1_END - 1} (제2장 배너는 #${CH1_END})`)
for (const t of tables.slice(0, CH1_END)) {
  console.log(`\n  ── #${t.index} ${t.rowCnt}x${t.colCnt} ──`)
  for (const c of [...t.cells].sort((a, b) => (a.row - b.row) || (a.col - b.col))) {
    const s = oneLine(c.text)
    if (!s) continue
    const span = (c.rowSpan > 1 || c.colSpan > 1) ? `+${c.rowSpan}x${c.colSpan}` : ''
    console.log(`    (${c.row},${c.col})${span}  ${s}`)
  }
}

writeFileSync(join(HERE, '_out-42-outline.txt'), LINES.join('\n'), 'utf8')
