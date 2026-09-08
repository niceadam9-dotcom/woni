/** 소방계획서_42 — HWP5 레코드 태그를 **실측으로 보정**한다.
 *
 *  스펙 문서마다 HWPTAG_BEGIN 기준이 어긋나 있어 태그 번호를 눈대중으로 박으면 조용히 틀린다
 *  (실제로 76을 TABLE이라 두었더니 표가 8개로 나왔다). 정답지가 있다 — **표는 95개여야 한다**.
 *  개수로 태그를 역산하고, 그 태그의 페이로드에서 rowCnt/colCnt가 나오는 오프셋도 역산한다.
 *
 *  실행: npx tsx scripts/_probe-42-hwp5-tags.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { parseTables } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords } from './hwp5-read.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWP = resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')

const L: string[] = []
const say = (s: string) => { L.push(s); console.log(s) }

const zip = await JSZip.loadAsync(readFileSync(HWPX))
const formTables = parseTables(await zip.file('Contents/section0.xml')!.async('string'))
const WANT_TABLES = formTables.length
const WANT_CELLS = formTables.reduce((n, t) => n + t.cells.length, 0)
say(`정답지(양식 hwpx): 표 ${WANT_TABLES} · 셀 ${WANT_CELLS}`)

const { bytes } = readSectionStream(readFileSync(HWP))
const recs = walkRecords(bytes)
say(`강순기 레코드 ${recs.length}개\n`)

const hist = new Map<number, { n: number; sizes: number[] }>()
for (const r of recs) {
  const e = hist.get(r.tag) ?? { n: 0, sizes: [] }
  e.n++
  if (e.sizes.length < 5) e.sizes.push(r.size)
  hist.set(r.tag, e)
}

say('태그 인구조사 (개수 내림차순)')
for (const [tag, e] of [...hist].sort((a, b) => b[1].n - a[1].n)) {
  const mark = e.n === WANT_TABLES ? '   ← 표 95개와 일치!' : e.n === WANT_CELLS ? '   ← 셀 수와 일치!' : ''
  say(`  tag ${String(tag).padStart(3)}  ×${String(e.n).padStart(6)}  size표본 ${e.sizes.join(',')}${mark}`)
}

// 표 태그 후보의 페이로드에서 rowCnt/colCnt 오프셋 역산
const tableTag = [...hist].find(([, e]) => e.n === WANT_TABLES)?.[0]
say(`\n표 태그 후보: ${tableTag ?? '(없음)'}`)
if (tableTag !== undefined) {
  const tblRecs = recs.filter(r => r.tag === tableTag)
  const wantDims = formTables.map(t => [t.rowCnt, t.colCnt] as const)
  say('  rowCnt/colCnt 오프셋 역산 (앞 12표로 채점)')
  for (let off = 0; off <= 16; off += 2) {
    let hit = 0
    for (let i = 0; i < Math.min(12, tblRecs.length); i++) {
      const p = tblRecs[i].payload
      if (p.length < off + 4) continue
      if (p.readUInt16LE(off) === wantDims[i][0] && p.readUInt16LE(off + 2) === wantDims[i][1]) hit++
    }
    if (hit) say(`    offset ${String(off).padStart(2)} → ${hit}/12 일치${hit === 12 ? '  ✅' : ''}`)
  }
  say('  첫 표 페이로드 앞 24바이트: ' + [...tblRecs[0].payload.subarray(0, 24)].map(b => b.toString(16).padStart(2, '0')).join(' '))
  say(`  (정답: 표#0 = ${wantDims[0][0]}행 x ${wantDims[0][1]}열)`)
}

// 셀 태그 후보
const cellTag = [...hist].find(([, e]) => e.n === WANT_CELLS)?.[0]
say(`\n셀 태그 후보(정확히 ${WANT_CELLS}개): ${cellTag ?? '(없음 — 셀 외 용도로도 쓰이는 태그다)'}`)
say('  ※ LIST_HEADER는 표 셀 말고 글상자 등에도 쓰이므로 개수가 딱 맞지 않는 게 정상이다.')
say('    후보(셀 수 이상, 셀 수의 2배 미만):')
for (const [tag, e] of [...hist].sort((a, b) => b[1].n - a[1].n)) {
  if (e.n >= WANT_CELLS && e.n < WANT_CELLS * 2) say(`      tag ${tag} ×${e.n}`)
}

writeFileSync(join(tmpdir(), '_42-hwp5-tags.txt'), L.join('\n'), 'utf8')
