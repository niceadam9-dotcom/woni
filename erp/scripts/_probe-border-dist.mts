/** 테두리 분포 프로브 — 리더가 테두리를 「전부 있다」로 뭉개고 있지 않은지 본다.
 *  검사 [5]가 「1.1 전 1620칸에 테두리」라고 해서 그게 참인지 확인하려고 만들었다. */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(resolve(HERE, '../templates/fire-plan-workbook.xlsx'))))

for (const name of ['1.1 건축물 일반현황', '표지', '2.3 임무']) {
  const g = await readSheetGrid(zip, name)
  const sides = (s: { left: string; right: string; top: string; bottom: string }) =>
    [s.left, s.right, s.top, s.bottom].filter(x => x !== 'none').length
  const dist: Record<number, number> = {}
  for (const c of g.cells) { const n = sides(c.style); dist[n] = (dist[n] ?? 0) + 1 }
  const kinds: Record<string, number> = {}
  for (const c of g.cells) for (const k of [c.style.left, c.style.right, c.style.top, c.style.bottom]) kinds[k] = (kinds[k] ?? 0) + 1
  console.log(`\n${name}  (${g.rows}행 × ${g.cols}열, 셀 ${g.cells.length})`)
  console.log('  변 개수별 칸 수:', JSON.stringify(dist))
  console.log('  변 종류 합계  :', JSON.stringify(kinds))
  const s0 = g.cells.filter(c => sides(c.style) === 0).slice(0, 3).map(c => c.ref)
  console.log('  변 0개 칸 예시:', s0.join(',') || '(없음)')
}

const styles = await zip.file('xl/styles.xml')!.async('string')
console.log('\nstyles.xml — cellXfs', (styles.match(/<xf /g) ?? []).length, '· borders',
  (styles.match(/<border>/g) ?? []).length, '· fills', (styles.match(/<fill>/g) ?? []).length)
