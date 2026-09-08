/** 어느 격자가 원본 치수에 더 충실한가 — 추정 말고 실측한다.
 *  기준: 양식 hwpx의 columnEdges(HWPUNIT). 두 시트의 열 경계를 같은 축으로 정규화해 오차를 잰다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { parseTables, columnEdges } from '../src/lib/hwpx-table.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const zip = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const tables = parseTables(await zip.file('Contents/section0.xml')!.async('string'))
const t = tables.find(x => x.cells.some(c => c.text.replace(/\s/g, '').includes('도로명주소')))!
const edges = columnEdges(t)
const total = edges[edges.length - 1]
const want = edges.map(e => e / total)      // 원본 열 경계(0~1)
console.log(`양식 서식1.1: ${t.rowCnt}행×${t.colCnt}열 · 열 경계 ${edges.length}개`)
console.log('원본 비율: ' + want.map(v => v.toFixed(3)).join(' '))

function sheetEdges(path: string, sheet: string, hwpColCnt: number) {
  const wb = XLSX.read(readFileSync(path), { sheetStubs: true })
  const ws = wb.Sheets[sheet]
  const cols = ws['!cols'] ?? []
  const range = XLSX.utils.decode_range(ws['!ref']!)
  const width = range.e.c - range.s.c + 1
  const DEF = 8.43
  const w = (i: number) => {
    const c = cols[i]
    if (!c) return DEF
    if (c.wch != null) return +c.wch
    if (c.wpx != null) return +c.wpx / 7
    return DEF
  }
  const defined = cols.filter(c => c && (c.wch != null || c.wpx != null)).length
  const merges = ws['!merges'] ?? []
  /* 표 본체 행에서 '논리 셀 경계'를 뽑는다 — 미세 격자는 병합 경계가 곧 열 경계다 */
  const fine = width > hwpColCnt * 2
  // 대표 행: 논리 셀이 가장 많은 행
  const byRow = new Map<number, number[]>()
  for (const m of merges) {
    if (!byRow.has(m.s.r)) byRow.set(m.s.r, [])
    byRow.get(m.s.r)!.push(m.s.c, m.e.c + 1)
  }
  return { width, defined, fine, cols: Array.from({ length: width }, (_, i) => w(i)) }
}

for (const [label, p, s] of [
  ['sj 미세 격자', resolve(HERE, '../../erp_goal/_doc01/sj_계획서.xlsx'), '소방안전관리계획 (3)'],
  ['리포 형식', resolve(HERE, '../templates/fire-plan-workbook.xlsx'), '1.1 건축물 일반현황'],
] as const) {
  const r = sheetEdges(p, s, t.colCnt)
  const sum = r.cols.reduce((a, b) => a + b, 0)
  console.log(`\n${label}: ${r.width}열 · **열 폭이 명시된 열 ${r.defined}개** · ${r.fine ? '미세' : '직접'} 격자`)
  console.log(`  열 폭: ${r.cols.slice(0, 14).map(v => v.toFixed(1)).join(' ')}${r.width > 14 ? ' …' : ''}  (합 ${sum.toFixed(1)})`)
  if (r.defined === 0) console.log('  ⚠ 명시 폭 0 — 전 열이 **기본 폭**이라 비율은 "병합이 몇 칸을 먹는가"로만 결정된다(양자화)')
}
