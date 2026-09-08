/** section0.xml에서 **셀 → 글자색** 경로를 확인한다. 구조를 모르고 스캐너를 짜면 조용히 어긋난다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'

const HERE = dirname(fileURLToPath(import.meta.url))
const zip = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const sec = await zip.file('Contents/section0.xml')!.async('string')

/* 빨강 charPr id 하나를 잡아 그 run이 든 셀 주변을 통째로 본다 */
const header = await zip.file('Contents/header.xml')!.async('string')
const redIds = [...header.matchAll(/<hh:charPr\b[^>]*id="(\d+)"[^>]*textColor="#FF0000"/g)].map(m => m[1])
console.log(`빨강 charPr id: ${redIds.join(', ')}\n`)

const id = redIds.find(i => sec.includes(`charPrIDRef="${i}"`))
const at = sec.indexOf(`charPrIDRef="${id}"`)
console.log(`— id=${id} 첫 등장 주변 (앞 400 / 뒤 500) —`)
console.log(sec.slice(Math.max(0, at - 400), at + 500).replace(/></g, '>\n<'))

/* 태그 이름 확인 */
for (const tag of ['hp:tc', 'hp:subList', 'hp:p', 'hp:run', 'hp:t', 'hp:cellAddr']) {
  console.log(`\n<${tag}> 등장 ${(sec.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length}회`)
}
