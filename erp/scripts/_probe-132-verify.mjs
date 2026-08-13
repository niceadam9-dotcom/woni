// 132 적용 결과 검증 (읽기 전용) — 삽입 12건이 활성이고, 별지 4호 조립 경로에 실제로 실리는지.
import { readFileSync } from 'fs'

const env = readFileSync('.env.staging', 'utf8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const h = { apikey: key, Authorization: `Bearer ${key}` }

const CODES = ['2-H-018', '2-H-019', '2-H-021', '2-H-031', '3-K-022', '3-K-023', '3-K-031', '3-K-041', '3-L-001', '3-L-002', '13-G-031', '13-G-041']
const inList = CODES.map(c => `"${c}"`).join(',')

const r = await fetch(`${url}/rest/v1/inspection_sheet_items?select=item_code,item_name,is_active,comprehensive_only,order_num,facility_type,sheet_id&item_code=in.(${inList})&order=order_num`, { headers: h })
const rows = await r.json()

console.log(`① 삽입 확인 ${rows.length}/12건\n`)
let inactive = 0
for (const x of rows) {
  if (!x.is_active) inactive++
  console.log(`  ${x.item_code.padEnd(10)} active=${String(x.is_active).padEnd(6)} comp=${String(x.comprehensive_only).padEnd(6)} ord=${String(x.order_num).padEnd(4)} ${x.item_name.slice(0, 44)}`)
}
console.log(`\n  비활성 ${inactive}건 ${inactive ? '← 문서에 안 나온다' : '(전건 활성 — 문서 조립 대상)'}`)

// ② 시트별 정렬 연속성 — order_num 중복이 있으면 인쇄 순서가 흔들린다
console.log('\n② 시트별 order_num 중복 검사')
for (const [sid, label] of [['d6342a20-625f-47f2-8718-0edbedf287b9', '옥내소화전'], ['c55ba68d-46c1-40d7-97a2-8f43dcd6d417', '스프링클러'], ['dc7fa1e7-02b8-414a-a889-b1b6f36bd219', '옥외소화전']]) {
  const q = await fetch(`${url}/rest/v1/inspection_sheet_items?select=item_code,order_num&sheet_id=eq.${sid}&order=order_num`, { headers: h })
  const all = await q.json()
  const seen = new Map()
  const dup = []
  for (const x of all) {
    if (seen.has(x.order_num)) dup.push(`${x.order_num}: ${seen.get(x.order_num)} / ${x.item_code}`)
    else seen.set(x.order_num, x.item_code)
  }
  console.log(`  ${label.padEnd(8)} ${all.length}건 · 중복 ${dup.length}건 ${dup.length ? '→ ' + dup.join(' · ') : ''}`)
}
