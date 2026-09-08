/** 소방계획서_42 — 표지 표의 테두리가 정말 점선인가, 아니면 내 매핑이 틀렸나.
 *  원본 header.xml의 **생 속성**을 그대로 꺼내 본다(내 mapBorder를 거치지 않고).
 *  실행: npx tsx scripts/_probe-42-border-raw.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import JSZip from 'jszip'
import { parseTables, parseBorderFills, mapBorder } from '../src/lib/hwpx-table.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')
const L: string[] = []
const say = (s: string) => L.push(s)

const zip = await JSZip.loadAsync(readFileSync(HWPX))
const headerXml = await zip.file('Contents/header.xml')!.async('string')
const tables = parseTables(await zip.file('Contents/section0.xml')!.async('string'))
const { fills } = parseBorderFills(headerXml)

/** 생 borderFill 블록을 id로 꺼낸다 */
function rawFill(id: number): string | null {
  const re = new RegExp(`<hh:borderFill\\b[^>]*\\bid="${id}"[\\s\\S]*?</hh:borderFill>`)
  return re.exec(headerXml)?.[0] ?? null
}

// 전 문서 type 인구조사 — 'DASH'가 실제로 얼마나 쓰이는가
say('[1] 문서 전체 border type 인구조사 (생 속성)')
{
  const census = new Map<string, number>()
  for (const m of headerXml.matchAll(/<hh:(?:left|right|top|bottom)Border\b[^>]*>/g)) {
    const t = /type="([^"]*)"/.exec(m[0])?.[1] ?? '(없음)'
    const w = /width="([^"]*)"/.exec(m[0])?.[1] ?? '(없음)'
    const k = `${t} | ${w}`
    census.set(k, (census.get(k) ?? 0) + 1)
  }
  for (const [k, n] of [...census].sort((a, b) => b[1] - a[1])) {
    const [t, w] = k.split(' | ')
    say(`  ${k.padEnd(28)} ×${String(n).padStart(4)}  → mapBorder='${mapBorder(t, w)}'`)
  }
}

say('\n[2] 표지 표(#0)가 쓰는 borderFill 생 블록')
for (const id of [...new Set(tables[0].cells.map(c => c.borderFillId))]) {
  const f = fills.get(id)
  say(`\n  ── id=${id}  매핑결과 L=${f?.left} R=${f?.right} T=${f?.top} B=${f?.bottom} fill=${f?.faceColor ?? '-'}`)
  say('  ' + (rawFill(id) ?? '(못 찾음)').replace(/></g, '>\n    <'))
}

say('\n[3] 대조군 — 서식 1.1 표(#5)의 첫 borderFill')
{
  const id = tables[5].cells[0].borderFillId
  const f = fills.get(id)
  say(`  ── id=${id}  매핑결과 L=${f?.left} R=${f?.right} T=${f?.top} B=${f?.bottom}`)
  say('  ' + (rawFill(id) ?? '(못 찾음)').replace(/></g, '>\n    <'))
}

writeFileSync(join(HERE, '_out-42-border-raw.txt'), L.join('\n'), 'utf8')
console.log(`wrote ${L.length} lines`)
