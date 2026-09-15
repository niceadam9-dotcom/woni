// 읽기 전용 — 「법정 기본 이행기간」이 실제로 깔리는 회차가 몇 건이고, 그 기산일이 무엇인가.
// 묻는 것: 보고일 수기값이 없는 회차가 몇 개이고(= 기산일이 「오늘」로 폴백), 그 회차에
// 불량이 있어 기간이 실제로 발명되는가.
import { readFileSync } from 'node:fs'
for (const line of readFileSync(process.argv[2] ?? '.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
console.log(`DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

async function all(b) { const o=[]; for(let i=0;;i+=1000){ const {data,error}=await b().order('id').range(i,i+999); if(error){console.log('  ERR',error.message);return o} o.push(...(data??[])); if(!data||data.length<1000)break } return o }

const insp = await all(() => db.from('inspections').select('id, customer_id, status'))
const defects = await all(() => db.from('inspection_defects').select('inspection_id, action_plan, action_start, action_end'))
// 🚨 스키마는 `annex_no` + `fields`다. 처음에 `report10` 컬럼을 물어 42703이 났고,
//   PostgREST는 쿼리 **전체**를 거절하므로 inputs가 빈 배열이 되어 「수기 0건」 오보가 났다
//   (구조분해가 에러를 삼키는 그 부류 — 이 프로브는 error를 찍도록 만들어 두어 잡았다).
const inputs = await all(() => db.from('annex_inputs').select('inspection_id, annex_no, fields'))

const byInsp = new Map()
for (const d of defects) { const a = byInsp.get(d.inspection_id) ?? []; a.push(d); byInsp.set(d.inspection_id, a) }
const inp = new Map(inputs.filter(r => r.annex_no === 'report10').map(r => [r.inspection_id, r.fields ?? {}]))
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

let withDefect=0, manual=0, auto=0, legalToday=0, legalManualDate=0
for (const i of insp) {
  const ds = byInsp.get(i.id) ?? []
  if (!ds.length) continue
  const planned = ds.filter(d => d.action_plan || d.action_start || d.action_end)
  if (!planned.length) continue           // hasDefect는 plannedCount>0
  withDefect++
  const f = inp.get(i.id) ?? {}
  const tp = typeof f.totalPeriod === 'string' ? f.totalPeriod : ''
  const starts = planned.map(d=>d.action_start).filter(Boolean)
  const ends = planned.map(d=>d.action_end).filter(Boolean)
  if (tp.includes('~')) { manual++; continue }                 // 1순위 수기
  if (starts.length && ends.length) { auto++; continue }        // 2순위 자동
  // 3순위 법정 기본 — 기산일은 report10.reportDate(수기) 없으면 오늘
  if (isDate(f.reportDate)) legalManualDate++
  else legalToday++
}
console.log(`\n이행계획이 있는 회차 ${withDefect}건`)
console.log(`  1순위 수기 총기간        ${manual}`)
console.log(`  2순위 자동(불량 시작·종료) ${auto}`)
console.log(`  3순위 법정기본 · 보고일 수기 ${legalManualDate}  ← 기산일 고정(문제 없음)`)
console.log(`  3순위 법정기본 · 보고일 공란 ${legalToday}  ← 기산일이 「오늘」로 폴백`)
console.log(`\n※ 인쇄되는 보고일도 같은 함수를 타므로 문서 안에서는 일관하다.`)
console.log(`   위험은 「두 폴백이 갈라지는 순간」이고, 지금 그것을 단언하는 검사가 0건이다.`)
