/** 원본 hwpx의 **글자 크기** 분포 — 지금 엑셀 9pt가 원본 대비 어떤지 알기 위해.
 *  hwpx charPr의 height는 1/100 pt 단위다(1000 = 10pt). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'

const HERE = dirname(fileURLToPath(import.meta.url))
const zip = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const header = await zip.file('Contents/header.xml')!.async('string')
const sec = await zip.file('Contents/section0.xml')!.async('string')

const sizeOf = new Map<number, number>()
for (const m of header.matchAll(/<hh:charPr\b[^>]*?id="(\d+)"[^>]*?height="(\d+)"/g)) {
  sizeOf.set(Number(m[1]), Number(m[2]) / 100)
}
const use = new Map<number, number>()
for (const m of sec.matchAll(/charPrIDRef="(\d+)"/g)) {
  const pt = sizeOf.get(Number(m[1]))
  if (pt) use.set(pt, (use.get(pt) ?? 0) + 1)
}
const total = [...use.values()].reduce((a, b) => a + b, 0)
console.log(`원본 hwpx 글자 크기 (run ${total}회 기준)\n`)
for (const [pt, n] of [...use.entries()].sort((a, b) => b[1] - a[1])) {
  const bar = '█'.repeat(Math.max(1, Math.round((n / total) * 40)))
  console.log(`  ${String(pt).padStart(5)}pt  ${String(n).padStart(5)}회  ${(n / total * 100).toFixed(1).padStart(5)}%  ${bar}`)
}
const weighted = [...use.entries()].reduce((a, [pt, n]) => a + pt * n, 0) / total
console.log(`\n가중 평균 ${weighted.toFixed(2)}pt · 최빈 ${[...use.entries()].sort((a, b) => b[1] - a[1])[0][0]}pt`)
console.log(`\n지금 엑셀: 본문 9pt · 머리띠 12pt(굵게)`)
