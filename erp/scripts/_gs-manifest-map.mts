/** 매니페스트의 95표 → 50시트 묶음을 읽는다 (읽기 전용 — 타 세션 자산이다). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const m = JSON.parse(readFileSync(resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json'), 'utf8'))
console.log(`매니페스트 v${m.version} · scope=${m.scope} · 시트 ${m.sheets.length}개`)

const seen = new Set<number>()
for (const [i, s] of m.sheets.entries()) {
  for (const t of s.tables) seen.add(t)
  const tops = (s.gridTops ?? []).map((g: { table: number; top: number; rows: number }) => `#${g.table}@${g.top}(${g.rows}행)`).join(' ')
  console.log(`${String(i).padStart(2)} ${String(s.no ?? '').padEnd(8)} ${s.name.padEnd(26)} 표[${s.tables.join(',')}] ${s.rows}행×${s.cols}열 배너행[${(s.bannerRows ?? []).join(',')}] ${tops}`)
}
console.log(`\n덮인 표 ${seen.size}개 / 95`)
const missing = Array.from({ length: 95 }, (_, i) => i).filter(i => !seen.has(i))
console.log(missing.length ? `⚠ 어느 시트에도 안 들어간 표: ${missing.join(', ')}` : '✅ 95표 전건이 어느 시트엔가 들어간다')
