/** 판정 수식(IF(…="[  ]","/","○") 부류) 전수 + 씨앗 추적 실측 — JSZip 축(SheetJS는 캐시 없는 수식 셀을 건너뛴다) */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { sheetFileMap } from '../src/lib/xlsx-inject.ts'

const file = process.argv[2] ?? 'templates/report-workbook.xlsx'
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(file)))
const files = await sheetFileMap(zip)

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
type Cell = { sheet: string; cell: string; f: string; v: string | null }
const all: Cell[] = []
for (const [sheet, path] of files) {
  const xml = await zip.file(path)!.async('string')
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const inner = m[2] ?? ''
    const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1]
    if (!f) continue
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? null
    all.push({ sheet, cell: m[1], f: unesc(f), v: v === null ? null : unesc(v) })
  }
}
console.log(`전체 수식 셀 ${all.length}칸 (캐시 보유 ${all.filter(c => c.v !== null).length}칸)`)

const verdict = all.filter(c => /"\s*\/\s*"|"○"|"／"/.test(c.f))
console.log(`\n=== 판정 수식 ${verdict.length}칸 ===`)
const byShape = new Map<string, Cell[]>()
for (const c of verdict) {
  const shape = c.f.replace(/[A-Z]{1,3}\d{1,5}/g, '#')
  const arr = byShape.get(shape) ?? []
  arr.push(c); byShape.set(shape, arr)
}
for (const [shape, cs] of byShape) {
  console.log(`\n[형태] ${shape}  → ${cs.length}칸 (캐시 잔존 ${cs.filter(c => c.v !== null).length})`)
  console.log(`  예: ${cs.slice(0, 4).map(c => `${c.sheet}!${c.cell} = ${c.f}${c.v !== null ? ` [v=${c.v}]` : ''}`).join('\n      ')}`)
}
const bySheet = new Map<string, number>()
for (const c of verdict) bySheet.set(c.sheet, (bySheet.get(c.sheet) ?? 0) + 1)
console.log(`\n시트별: ${[...bySheet].map(([s, n]) => `${s}=${n}`).join(', ')}`)

// 씨앗 추적 — 단일 참조 사슬을 거슬러 근원 리터럴까지
const fMap = new Map(all.map(c => [`${c.sheet}!${c.cell}`, c.f]))
function root(sheet: string, cell: string, depth = 0): string {
  if (depth > 10) return `${sheet}!${cell}(깊이초과)`
  const f = fMap.get(`${sheet}!${cell}`)
  if (!f) return `${sheet}!${cell}`
  const m = /^'?([^'!=]+)'?!(\$?[A-Z]{1,3}\$?\d{1,5})$/.exec(f.trim())
  if (m) return root(m[1], m[2].replace(/\$/g, ''), depth + 1)
  const l = /^(\$?[A-Z]{1,3}\$?\d{1,5})$/.exec(f.trim())
  if (l) return root(sheet, l[1].replace(/\$/g, ''), depth + 1)
  return `${sheet}!${cell}`
}
console.log(`\n=== 판정 수식 → 씨앗 ===`)
const seeds = new Map<string, string[]>()
for (const c of verdict) {
  for (const r of c.f.matchAll(/(?:'?([^'!=,()"]+)'?!)?(\$?[A-Z]{1,3}\$?\d{1,5})/g)) {
    const rt = root(r[1] ?? c.sheet, r[2].replace(/\$/g, ''))
    const arr = seeds.get(rt) ?? []
    arr.push(`${c.sheet}!${c.cell}`)
    seeds.set(rt, arr)
  }
}
for (const [seed, users] of [...seeds].sort()) console.log(`${seed} → ${users.length}칸: ${users.slice(0, 12).join(', ')}${users.length > 12 ? ' …' : ''}`)
