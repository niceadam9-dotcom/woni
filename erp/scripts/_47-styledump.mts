/** styles.xml의 cellXfs를 순서대로 찍는다 — 정렬이 밀렸는지 **표 자체를** 본다. */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

const zip = await JSZip.loadAsync(readFileSync(process.argv[2] ?? 'F:\\AI\\sjfire\\_강순기_형식비교\\강순기_소방계획서_v5.xlsx'))
const s = await zip.file('xl/styles.xml')!.async('string')

const fonts = [...(s.match(/<fonts[\s\S]*?<\/fonts>/)?.[0] ?? '').matchAll(/<font>[\s\S]*?<\/font>/g)].map(m => m[0])
console.log(`fonts ${fonts.length}개`)
fonts.slice(0, 6).forEach((f, i) => console.log(`  [${i}] ${f.replace(/\s+/g, ' ')}`))

const block = s.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
/* ⚠ `<xf …/>`(자기닫힘)과 `<xf …>…</xf>`를 **둘 다** 잡아야 한다. 1차 정규식이 기본 xf 하나를
 *   놓쳐 인덱스가 한 칸 밀렸고, 그 바람에 멀쩡한 정렬을 「밀렸다」고 오독할 뻔했다. */
const xfs = [...block.matchAll(/<xf[\s\S]*?(?:\/>|<\/xf>)/g)].map(m => m[0])
console.log(`\ncellXfs ${xfs.length}개 (선언 count=${/count="(\d+)"/.exec(s.match(/<cellXfs[^>]*>/)?.[0] ?? '')?.[1]})`)
xfs.slice(0, 8).forEach((x, i) => {
  const h = /horizontal="([a-z]+)"/.exec(x)?.[1] ?? '(없음)'
  const f = /fontId="(\d+)"/.exec(x)?.[1] ?? '?'
  console.log(`  [${i}] horizontal=${h.padEnd(7)} fontId=${f}`)
})
