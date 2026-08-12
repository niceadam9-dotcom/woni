/** [독립 판정 19] B-4b 9쪽 '작성방법' 원문 대조 — _doc01 원본(EUC-KR htm) vs report9.ts page9() */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const dir = 'F:/AI/ERP/erp_goal/_doc01'
const file = readdirSync(dir).find(f => f.includes('0009.htm'))
const bytes = readFileSync(join(dir, file))
const orig = new TextDecoder('euc-kr').decode(bytes)
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim()

const src = readFileSync('F:/AI/ERP/erp/src/lib/doc-templates/report9.ts', 'utf8')
const m = /function page9\(\): string \{([\s\S]*?)\n\}/.exec(src)
const impl = m[1].replace(/\$\{[^}]*\}/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

const norm = s => s.replace(/[“”]/g, '"').replace(/[\s ]+/g, ' ').replace(/[　]/g, ' ').trim()
const split = s => norm(s).split(/(?<=니다\.|니다\.\))\s*/).map(x => x.trim()).filter(x => x.length > 12)

const o = split(orig), i = split(impl)
console.log(`원문 문장 ${o.length} / 구현 문장 ${i.length}`)
let miss = 0
for (const s of o) {
  if (!norm(impl).includes(s)) { miss++; console.log('  ❌ 원문에만 있음:', s.slice(0, 120)) }
}
for (const s of i) {
  if (!norm(orig).includes(s)) console.log('  ⚠ 구현에만 있음:', s.slice(0, 120))
}
console.log(miss === 0 ? '\n✅ 원문 전 문장이 구현에 포함됨' : `\n❌ 누락/변형 ${miss}건`)
process.exit(0)
