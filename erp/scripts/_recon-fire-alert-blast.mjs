// A4-6 ⑤ 영향 범위 실측 — 별지4호에서 '화재알림설비' 행을 빼면 실제로 무엇이 사라지는가.
// 가드/삭제는 켜기 전에 막히는(사라지는) 건수를 센다.
//
// ⚠ 열 이름을 추측하지 않는다 — 한 행을 읽어 실제 키를 확인한 뒤 훑는다.
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
config({ path: process.argv[2] ?? '.env.local', override: true })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })
console.log('DB:', process.env.NEXT_PUBLIC_SUPABASE_URL)

// 1) 설비 대장 — 한글을 질의문에 넣지 않는다(조용한 0건 방지). 전량 받아 JS에서 판정한다.
const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('fire_facilities')
    .select('building_id, facility_code, installed').range(from, from + 999)
  if (error) { console.log('fire_facilities 조회 실패:', error.message); break }
  rows.push(...data)
  if (data.length < 1000) break
}
console.log(`fire_facilities 총 ${rows.length}행`)
const ALERT = '화재알림설비'   // 화재알림설비 (ASCII 소스로만 표기)
const hit = rows.filter(r => r.facility_code === ALERT)
console.log(`  facility_code == 화재알림설비 : ${hit.length}행`)
console.log(`  그중 installed=true          : ${hit.filter(r => r.installed).length}행 (건물 ${new Set(hit.filter(r => r.installed).map(r => r.building_id)).size}곳)`)
// 축이 살아 있다는 반대 증거 — 대장에 실제로 쓰이는 코드 상위 5종
const freq = {}
for (const r of rows) if (r.installed) freq[r.facility_code] = (freq[r.facility_code] ?? 0) + 1
console.log('  (대조) installed=true 상위 5종:', Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5)
  .map(([k, v]) => `${k}=${v}`).join(', '))

// 2) 점검표 응답 — 화재알림설비 축 시트에 실제 응답이 있는가
const { data: items, error: e2 } = await db.from('inspection_sheet_items')
  .select('item_code, item_name, facility_type').limit(2000)
if (e2) console.log('inspection_sheet_items 조회 실패:', e2.message)
else {
  const alertItems = items.filter(i => (i.facility_type ?? '').includes(ALERT) || (i.item_name ?? '').includes(ALERT))
  console.log(`inspection_sheet_items 중 화재알림 관련 항목: ${alertItems.length}건`)
  for (const i of alertItems.slice(0, 5)) console.log(`   ${i.item_code} ${i.item_name}`)
}
