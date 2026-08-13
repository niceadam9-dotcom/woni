// 편입 대상 15건(2-H·3-K·3-L·13-G 구획의 DB 누락 전건)의 문구·종합전용을 고시 원문에서 확정한다.
// DB 표기 규약에 맞춘다: 괄호는 앞 공백 없이 붙이고(여부(…)), 따옴표는 곡선(“ ”), `하고,“…”표지`.
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const GOAL = 'F:\\AI\\ERP\\erp_goal'
const f = readdirSync(join(GOAL, '_doc01')).find(x => x.startsWith('[별지 4]') && x.endsWith('.xml'))
const T = readFileSync(join(GOAL, '_doc01', f), 'utf8')
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ')

const CODE = String.raw`\d{1,2}-[A-Z]-\d{3}`
const TOKEN = new RegExp(`(${CODE})|\\[([^\\]]{2,12})\\]|([●○])\\s*([^●○\\[]{4,140}?)(?=\\s*(?:${CODE}|\\[|[●○]|※|\\d{1,2}-[A-Z]\\.|210mm|비고|$))`, 'g')

/** DB 표기 규약으로 정규화 — 내용은 그대로 두고 공백 관습만 맞춘다 */
const toDbStyle = s => s
  .replace(/\s+/g, ' ')
  .replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ') ')  // 괄호 붙임
  .replace(/\s*([“”"])\s*/g, '$1')                        // 따옴표 붙임
  .replace(/\s*,\s*/g, ',')                               // 쉼표 붙임(기존 `하고,“…`)
  .replace(/\s+/g, ' ').trim()
  .replace(/\)$/, ')')

const items = new Map()
let codes = [], texts = [], lastText = false
const flush = () => {
  for (let i = 0; i < codes.length && i < texts.length; i++) {
    if (!items.has(codes[i])) items.set(codes[i], { name: toDbStyle(texts[i][1]), comp: texts[i][0] === '●' })
  }
  codes = []; texts = []
}
let m
while ((m = TOKEN.exec(T))) {
  if (m[1]) { if (lastText) flush(); codes.push(m[1]); lastText = false }
  else if (m[3]) { texts.push([m[3], m[4]]); lastText = true }
}
flush()

const PLAN = [
  // ⚠ 2-H-002·022·023은 고시에 없다 — `12-H-0xx`를 경계 없이 훑은 내 정규식의 오탐이었다(2026-08-13 확인)
  { sheet: 'STD-02', sheetId: 'd6342a20-625f-47f2-8718-0edbedf287b9', fac: '옥내소화전설비', from: 58,
    codes: ['2-H-018', '2-H-019', '2-H-021', '2-H-031'] },
  { sheet: 'STD-03', sheetId: 'c55ba68d-46c1-40d7-97a2-8f43dcd6d417', fac: '스프링클러설비', from: 84,
    codes: ['3-K-022', '3-K-023', '3-K-031', '3-K-041', '3-L-001', '3-L-002'] },
  { sheet: 'STD-13', sheetId: 'dc7fa1e7-02b8-414a-a889-b1b6f36bd219', fac: '옥외소화전설비', from: 53,
    codes: ['13-G-031', '13-G-041'] },
]

const out = []
let bad = 0
for (const p of PLAN) {
  console.log(`\n== ${p.sheet} ${p.fac} (order_num ${p.from + 1}부터)`)
  p.codes.forEach((c, i) => {
    const ex = items.get(c)
    if (!ex || ex.name.length < 5) { bad++; console.log(`   ${c.padEnd(10)} ❌ 추출 실패`); return }
    const order = p.from + i + 1
    console.log(`   ${String(order).padStart(4)} ${c.padEnd(10)} [${ex.comp ? '●종합' : '○작동'}] ${ex.name}`)
    out.push({ code: c, name: ex.name, comprehensive: ex.comp, sheetId: p.sheetId, fac: p.fac, order })
  })
}
console.log(`\n총 ${out.length}건 · 추출 실패 ${bad}건`)
writeFileSync('scripts/_orphan-items.json', JSON.stringify(out, null, 2), 'utf8')
console.log('scripts/_orphan-items.json 기록')
