// R5-6(엑셀 폐지) 착수 가능 여부 판정 (읽기 전용).
// 두 가지를 본다: ① 엑셀에만 있던 12개 코드가 법정 고시에 실재하는 항목인가, DB에 있는가
//                ② 펌프성능시험 표가 붙는 설비를 구현이 다 담았는가
// 실행: node scripts/_probe-r56-blockers.mjs
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const GOAL = 'F:\\AI\\ERP\\erp_goal'
const f = readdirSync(join(GOAL, '_doc01')).find(x => x.startsWith('[별지 4]') && x.endsWith('.xml'))
const XML = readFileSync(join(GOAL, '_doc01', f), 'utf8')
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ')

const ORPHANS = [
  '2-H-018', '2-H-019', '2-H-021', '2-H-031',
  '3-K-022', '3-K-023', '3-K-031', '3-K-041',
  '3-L-001', '3-L-002',
  '13-G-031', '13-G-041',
]

console.log('① 엑셀 전용 12건 — 법정 고시 실재 여부 + 문구\n')
const inLaw = []
for (const code of ORPHANS) {
  const i = XML.indexOf(code)
  if (i === -1) { console.log(`  ${code.padEnd(10)} 고시에 없음`); continue }
  inLaw.push(code)
  // 코드 뒤 첫 '●' 항목 문구
  const after = XML.slice(i, i + 260)
  const m = after.match(/●\s*([^●]{4,80})/)
  console.log(`  ${code.padEnd(10)} 고시 있음 — ${m ? m[1].trim().slice(0, 66) : '(문구 인접 추출 실패)'}`)
}
console.log(`\n  → 법정 실재 ${inLaw.length}/12건`)

console.log('\n② DB(스테이징 inspection_sheet_items) 보유 여부')
const env = readFileSync('.env.staging', 'utf8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const h = { apikey: key, Authorization: `Bearer ${key}` }
const q = ORPHANS.map(c => `"${c}"`).join(',')
const r = await fetch(`${url}/rest/v1/inspection_sheet_items?select=item_code,item_name&item_code=in.(${q})`, { headers: h })
const have = r.ok ? await r.json() : []
const haveSet = new Set(have.map(x => x.item_code))
for (const c of ORPHANS) console.log(`  ${c.padEnd(10)} ${haveSet.has(c) ? 'DB 있음' : 'DB 없음  ← 엑셀 폐지 시 유실'}`)
console.log(`\n  → DB 보유 ${haveSet.size}/12건 · 유실 후보 ${12 - haveSet.size}건`)

console.log('\n③ 펌프성능시험 대상 설비 — 고시 vs 구현')
const LAW = [2, 3, 4, 5, 6, 7, 8, 13]
const impl = readFileSync('src/lib/pump-test.ts', 'utf8')
const nums = ((impl.match(/PUMP_TEST_SHEETS\s*=\s*\[([^\]]+)\]/) || [])[1] ?? '')
  .split(',').map(s => Number(s.trim())).filter(Number.isFinite)
console.log('  고시:', LAW.join(', '))
console.log('  구현:', nums.join(', '))
const miss = LAW.filter(n => !nums.includes(n))
const extra = nums.filter(n => !LAW.includes(n))
console.log(`  누락: ${miss.join(', ') || '없음'} · 과다: ${extra.join(', ') || '없음'}`)

console.log('\n판정')
const blockers = []
if (12 - haveSet.size > 0) blockers.push(`엑셀 전용 ${12 - haveSet.size}건이 DB에 없음`)
if (miss.length) blockers.push(`펌프성능시험 설비 ${miss.join('·')} 미구현`)
console.log(blockers.length ? `  R5-6 착수 불가 — ${blockers.join(' / ')}` : '  R5-6 착수 가능')
