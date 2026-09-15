// 읽기 전용 — 건물·시설의 네 칸(건축허가일·사용승인일·건축면적·높이) 공란 실태.
// 「라벨을 상시 빨강으로」가 정직한 신호인지(대부분 비어 있음) 소음인지(대부분 채워짐)를 가른다.
import { readFileSync } from 'node:fs'
const envFile = process.argv[2] ?? '.env.local'
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
console.log(`DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

async function all(b) {
  const out = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await b().order('id').range(i, i + 999)
    if (error) { console.log('  ERR', error.message); return out }
    out.push(...(data ?? [])); if (!data || data.length < 1000) break
  }
  return out
}

const blds = await all(() => admin.from('buildings')
  .select('id, customer_id, building_name, permit_date, building_area, height, is_active'))
const custs = await all(() => admin.from('customers').select('id, use_approval_date, is_active'))
const ua = new Map(custs.map(c => [c.id, c.use_approval_date]))
const act = blds.filter(b => b.is_active !== false)
const n = act.length
const blank = (v) => v === null || v === undefined || String(v).trim() === ''

const axes = [
  ['건축허가일 (필수·저장차단)', b => blank(b.permit_date)],
  ['사용승인일 (읽기전용·고객이 원천)', b => blank(ua.get(b.customer_id))],
  ['건축면적 (표시만 필수)', b => blank(b.building_area)],
  ['높이 (선택)', b => blank(b.height)],
]
console.log(`\n활성 건물 ${n}동`)
for (const [label, f] of axes) {
  const c = act.filter(f).length
  const pct = n ? (c / n * 100).toFixed(1) : '0'
  console.log(`  ${label.padEnd(34)} 공란 ${String(c).padStart(4)} / ${n}  (${pct}%)`)
}
// 네 칸이 동시에 다 찬 동은 몇 동인가 — 「상시 빨강」이면 이 동들도 빨갛다
const allFilled = act.filter(b => axes.every(([, f]) => !f(b))).length
console.log(`\n네 칸이 모두 채워진 동 = ${allFilled} / ${n} (${n ? (allFilled / n * 100).toFixed(1) : 0}%)`)
console.log('  → 이만큼은 「상시 빨강」이 거짓 경고가 된다(채웠는데도 빨강)')
const anyBlank = n - allFilled
console.log(`한 칸 이상 빈 동 = ${anyBlank} / ${n} (${n ? (anyBlank / n * 100).toFixed(1) : 0}%)`)
