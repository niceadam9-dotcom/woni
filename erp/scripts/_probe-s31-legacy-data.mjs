// 3-1 소화기구 세부제원의 **기존 저장 데이터 실측** (읽기 전용)
// 개편(동별 구조화) 전에 "버려도 되는 자유 기입인가"를 추측이 아니라 건수로 판정한다.
// 실행: node scripts/_probe-s31-legacy-data.mjs [envFile]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = process.argv[2] ?? '.env.local'
const env = {}
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error(`키 없음 (${envFile})`); process.exit(1) }
console.log(`대상: ${url}  (${envFile})`)

const db = createClient(url, key, { auth: { persistSession: false } })
const { data, error } = await db.from('customer_facility_specs')
  .select('customer_id, building_id, spec')
  .eq('section_key', 's31_extinguisher')
if (error) { console.error('조회 실패:', error.message); process.exit(1) }

const rows = data ?? []
console.log(`\n3-1 섹션 저장 행: ${rows.length}건`)

const QTY = ['qty_ext_powder', 'qty_ext_other', 'qty_simple_throw', 'qty_simple_other', 'qty_auto_diffuse', 'qty_auto_device']
let withQty = 0, withNote = 0, withDongText = 0, withTypes = 0
const dongSamples = []
for (const r of rows) {
  const s = r.spec?.summary ?? {}
  const d = r.spec?.by_dong ?? {}
  if (QTY.some(k => s[k] != null && String(s[k]).trim() !== '')) withQty++
  if (String(s.note ?? '').trim()) withNote++
  if (Array.isArray(s.types) && s.types.length) withTypes++
  const txt = String(d.rows ?? '').trim()
  if (txt) { withDongText++; if (dongSamples.length < 10) dongSamples.push(txt) }
}
console.log(`  설치 종류(types) 있음 : ${withTypes}건`)
console.log(`  합계 수량 있음        : ${withQty}건   ← 첫 행으로 이관 대상`)
console.log(`  합계 비고 있음        : ${withNote}건`)
console.log(`  동별 자유기입 있음    : ${withDongText}건 ← 폐기 대상`)
if (dongSamples.length) {
  console.log('\n  동별 자유기입 샘플:')
  for (const t of dongSamples) console.log(`    | ${t.replace(/\n/g, ' ⏎ ')}`)
}
