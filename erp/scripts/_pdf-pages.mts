/** PDF 쪽수 세기 — 「시트당 1쪽」의 판정축. 두 방식으로 세어 어긋나면 알린다(한 축만 믿지 않는다). */
import { readFileSync } from 'node:fs'
const p = process.argv[2]
const buf = readFileSync(p)
const s = buf.toString('latin1')
const byType = (s.match(/\/Type\s*\/Page(?![sA-Za-z])/g) ?? []).length
const countAttr = [...s.matchAll(/\/Count\s+(\d+)/g)].map(m => +m[1])
const byCount = countAttr.length ? Math.max(...countAttr) : 0
console.log(`${p.split('\\').pop()}: /Type/Page ${byType}쪽 · /Count ${byCount}쪽`)
if (byType !== byCount) console.log('⚠ 두 축이 다르다 — 압축 객체 스트림일 수 있다')
console.log(byType || byCount)
