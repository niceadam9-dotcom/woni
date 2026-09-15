// 읽기 전용 — 3순위 「법정 기본」의 관문 `hasDefect`가 PDF와 엑셀에서 **다른 술어**를 쓴다.
//   PDF  (report9-actions:191)  hasDefect = plannedCount > 0
//                                = inspection_defects 중 action_plan|action_start|action_end 가 있는 건
//   엑셀 (workbook/route:159)   hasDefect = r9.data.defectRows.length > 0
//                                = 점검표 X 응답 + inspection_defects 전건
// 두 집합이 갈라지는 회차에서는 **같은 회차의 두 산출물이 이행기간을 다르게 말한다**
// (엑셀엔 10일이 서고 PDF는 빈다). 양쪽 주석은 「같은 재료라야 한다」고 적혀 있다.
import { readFileSync } from 'node:fs'
for (const line of readFileSync(process.argv[2] ?? '.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
console.log(`DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
async function all(b, label) {
  const o=[]
  for(let i=0;;i+=1000){
    const {data,error}=await b().order('id').range(i,i+999)
    if(error){ console.log(`  🚨 ${label} ERR ${error.message} — 이 프로브의 결론은 무효다`); process.exit(2) }
    o.push(...(data??[])); if(!data||data.length<1000)break
  }
  return o
}
const insp = await all(() => db.from('inspections').select('id, status'), 'inspections')
const defects = await all(() => db.from('inspection_defects').select('id, inspection_id, action_plan, action_start, action_end'), 'defects')
const resp = await all(() => db.from('inspection_sheet_responses').select('id, inspection_id, result'), 'responses')
const inputs = await all(() => db.from('annex_inputs').select('id, inspection_id, annex_no, fields'), 'annex_inputs')

const planned = new Map(), anyDef = new Map(), xs = new Map()
for (const d of defects) {
  anyDef.set(d.inspection_id, (anyDef.get(d.inspection_id) ?? 0) + 1)
  if (d.action_plan || d.action_start || d.action_end) planned.set(d.inspection_id, (planned.get(d.inspection_id) ?? 0) + 1)
}
for (const r of resp) if (r.result === 'X') xs.set(r.inspection_id, (xs.get(r.inspection_id) ?? 0) + 1)
const f10 = new Map(inputs.filter(r => r.annex_no === 'report10').map(r => [r.inspection_id, r.fields ?? {}]))

let gap = 0, both = 0, neither = 0, manualWins = 0
const samples = []
for (const i of insp) {
  const p = planned.get(i.id) ?? 0
  const rows = (xs.get(i.id) ?? 0) + (anyDef.get(i.id) ?? 0)   // defectRows 근사(X + 불량행)
  const pdf = p > 0, xlsx = rows > 0
  if (!pdf && !xlsx) { neither++; continue }
  const tp = f10.get(i.id)?.totalPeriod
  const hasManual = typeof tp === 'string' && tp.includes('~')
  if (pdf === xlsx) { both++; continue }
  // 갈라짐 — 단, 수기 총기간이 있으면 3순위까지 안 내려가므로 인쇄는 같다
  if (hasManual) { manualWins++; continue }
  gap++
  if (samples.length < 6) samples.push({ id: i.id.slice(0,8), status: i.status, planned: p, rows })
}
console.log(`\n두 술어가 같은 회차        ${both}`)
console.log(`둘 다 0(이행기간 없음)     ${neither}`)
console.log(`갈라지지만 수기값이 이김   ${manualWins}`)
console.log(`🚨 실제로 갈라지는 회차    ${gap}   ← 엑셀엔 법정 10일, PDF는 공란`)
for (const s of samples) console.log(`   ${s.id} status=${s.status} planned=${s.planned} defectRows≈${s.rows}`)
