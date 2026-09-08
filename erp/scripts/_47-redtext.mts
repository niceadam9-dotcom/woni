/** hwp/hwpx의 **글자 색**을 뽑을 수 있는가 — 「빨강 글씨는 엑셀에서도 빨강」 요구의 실현 가능성.
 *  색은 본문이 아니라 **머리(header) 문자 속성표**에 있고 문단 run이 charPrIDRef로 가리킨다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'

const HERE = dirname(fileURLToPath(import.meta.url))
const zip = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
console.log('엔트리:', Object.keys(zip.files).filter(n => /Contents|header/i.test(n)).join(', '))

const header = await zip.file('Contents/header.xml')?.async('string')
if (!header) { console.log('header.xml 없음'); process.exit(1) }
console.log(`header.xml ${header.length}바이트`)

/* 문자 속성 — textColor */
const charPrs = [...header.matchAll(/<hh:charPr\b[^>]*id="(\d+)"[^>]*textColor="([^"]*)"/g)]
console.log(`\ncharPr(textColor 있는 것) ${charPrs.length}개`)
const byColor = new Map<string, number[]>()
for (const m of charPrs) {
  const c = m[2].toUpperCase()
  if (!byColor.has(c)) byColor.set(c, [])
  byColor.get(c)!.push(Number(m[1]))
}
for (const [c, ids] of [...byColor.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const isRed = /^#?(FF0000|E[0-9A-F]{2}0000|CC0000|FF3300)$/.test(c) || /^#?(FF|E[0-9A-F]|C[0-9A-F])0{4}$/.test(c)
  console.log(`  ${c.padEnd(10)} charPr ${ids.length}종 ${isRed ? '← 빨강 계열' : ''}  id=${ids.slice(0, 8).join(',')}`)
}

/* 본문 run이 charPrIDRef로 그것을 가리키는가 */
const sec = await zip.file('Contents/section0.xml')!.async('string')
const refs = [...sec.matchAll(/charPrIDRef="(\d+)"/g)].map(m => Number(m[1]))
const used = new Map<number, number>()
for (const r of refs) used.set(r, (used.get(r) ?? 0) + 1)
console.log(`\nsection0의 charPrIDRef 사용 ${refs.length}회 · 서로 다른 id ${used.size}종`)

const redIds = new Set([...byColor.entries()].filter(([c]) => /(FF0000|E00000|CC0000)/.test(c)).flatMap(([, ids]) => ids))
const redUse = [...used.entries()].filter(([id]) => redIds.has(id))
console.log(`빨강 charPr을 쓰는 run ${redUse.reduce((a, [, n]) => a + n, 0)}회 (id ${redUse.map(([id, n]) => `${id}×${n}`).join(', ') || '없음'})`)
console.log(`\n→ 판정: ${redUse.length ? '색 추출 **가능**' : '이 양식에는 빨강 run이 없다 — hwp(강순기 완성본) 쪽을 봐야 한다'}`)
