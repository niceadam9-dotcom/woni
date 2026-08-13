// 2-H · 3-K · 3-L · 13-G 구획의 고시↔DB 전체 갭 (읽기 전용).
// 12건만 보고 마이그레이션을 쓰면 같은 구획의 다른 누락을 놓친다 — 구획 통째로 대조한다.
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const GOAL = 'F:\\AI\\ERP\\erp_goal'
const f = readdirSync(join(GOAL, '_doc01')).find(x => x.startsWith('[별지 4]') && x.endsWith('.xml'))
const T = readFileSync(join(GOAL, '_doc01', f), 'utf8')
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ')

const SECTIONS = ['2-H', '3-K', '3-L', '13-G']
const env = readFileSync('.env.staging', 'utf8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const h = { apikey: key, Authorization: `Bearer ${key}` }

for (const sec of SECTIONS) {
  // ⚠ 앞자리 경계 필수 — `2-H-002`가 `12-H-002` 안에서 잡히는 오탐이 실제로 났다
  const inLaw = [...new Set([...T.matchAll(new RegExp(`(?<![\\d-])${sec}-\\d{3}`, 'g'))].map(m => m[0]))].sort()
  const r = await fetch(`${url}/rest/v1/inspection_sheet_items?select=item_code&item_code=like.${sec}-*`, { headers: h })
  const inDb = new Set((await r.json()).map(x => x.item_code))
  const missing = inLaw.filter(c => !inDb.has(c))
  const extra = [...inDb].filter(c => !inLaw.includes(c)).sort()
  console.log(`\n== ${sec}  고시 ${inLaw.length}건 / DB ${inDb.size}건`)
  console.log(`   고시 목록: ${inLaw.join(' ')}`)
  console.log(`   DB 누락  : ${missing.join(' ') || '없음'}`)
  console.log(`   DB 잉여  : ${extra.join(' ') || '없음'}`)
}
