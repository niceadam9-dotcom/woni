// 편입 후보 12건이 DB에 이미 다른 코드로 있는지 교차 확인 (중복 편입 방지)
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('F:/AI/ERP/erp/.env.local', 'utf8')
const url = /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(env)[1].trim()
const key = /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(env)[1].trim()
const db = createClient(url, key, { auth: { persistSession: false } })

const rows = []
for (let f = 0; ; f += 1000) {
  const { data } = await db.from('inspection_sheet_items').select('item_code, item_name').range(f, f + 999)
  rows.push(...data)
  if (data.length < 1000) break
}

const CAND = [
  ['2-H-018', '2-', '감시제어반 전용실'],
  ['2-H-019', '2-', '제어 및 감시설비 외 설치'],
  ['2-H-021', '2-', '동력제어반'],
  ['2-H-031', '2-', '발전기'],
  ['3-K-022', '3-', '일제개방밸브 사용'],
  ['3-K-023', '3-', '수신기 간 상호 연동'],
  ['3-K-031', '3-', '동력제어반'],
  ['3-K-041', '3-', '발전기'],
  ['3-L-001', '3-', '헤드 설치 ?제외'],
  ['3-L-002', '3-', '드렌처'],
  ['13-G-031', '13-', '동력제어반'],
  ['13-G-041', '13-', '발전기'],
]

let dup = 0
for (const [code, pfx, kw] of CAND) {
  const exact = rows.find(r => r.item_code === code)
  const similar = rows.filter(r => r.item_code.startsWith(pfx) && new RegExp(kw).test(r.item_name))
  const verdict = exact ? '🔴 코드 이미 존재' : similar.length ? '⚠ 유사 문장 존재' : '✅ 신규(중복 없음)'
  if (exact || similar.length) dup++
  console.log(`${code.padEnd(9)} ${verdict}${similar.length ? ' → ' + similar.map(r => r.item_code).join(',') : ''}`)
}
console.log(`\n중복/유사 ${dup}건 / 후보 ${CAND.length}건`)
