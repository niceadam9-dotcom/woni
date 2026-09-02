/** 급수 배지(B안)를 상시 띄우면 **몇 %가 실제 판정으로 이어지는가** — 실코드로 계량(읽기 전용).
 *  실행: $env:NODE_OPTIONS='--conditions=react-server'; node node_modules/tsx/dist/cli.mjs scripts/_probe-grade-inputs.mts [.env]
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { suggestGrade } from '../src/lib/fire-plan-suggest'

const envFile = process.argv[2] ?? '.env.local'
const env: Record<string, string> = {}
for (const line of readFileSync(new URL(`../${envFile}`, import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const all = async (t: string, sel: string) => {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(t).select(sel).range(from, from + 999)
    if (error) throw new Error(`${t}: ${error.message}`)
    out.push(...(data as any[])); if ((data as any[]).length < 1000) break
  }
  return out
}
const blds = (await all('buildings', 'id, customer_id, purpose, total_area, floors_above, floors_below, height, is_active'))
  .filter(b => b.is_active !== false)
const facs = await all('fire_facilities', 'building_id, facility_code, installed')
const facByBld = new Map<string, string[]>()
for (const f of facs) if (f.installed) facByBld.set(f.building_id, [...(facByBld.get(f.building_id) ?? []), f.facility_code])

let judged = 0, none = 0
const byGrade = new Map<string, number>()
const missing = { purpose: 0, area: 0, floors: 0, height: 0 }
for (const b of blds) {
  if (!b.purpose) missing.purpose++
  if (b.total_area == null) missing.area++
  if (b.floors_above == null) missing.floors++
  if (b.height == null) missing.height++
  const g = suggestGrade({
    purpose: b.purpose, totalArea: b.total_area, floorsAbove: b.floors_above,
    floorsBelow: b.floors_below, height: b.height, facilityCodes: facByBld.get(b.id) ?? [],
  })
  if (g) { judged++; byGrade.set(g.grade, (byGrade.get(g.grade) ?? 0) + 1) } else none++
}
console.log(`활성 건물 ${blds.length}동\n`)
console.log('[판정 입력 결측]')
console.log(`   용도 공란   ${missing.purpose} (${(missing.purpose / blds.length * 100).toFixed(0)}%)  ← 아파트/비아파트를 가르는 축`)
console.log(`   연면적 공란 ${missing.area} (${(missing.area / blds.length * 100).toFixed(0)}%)`)
console.log(`   층수 공란   ${missing.floors} (${(missing.floors / blds.length * 100).toFixed(0)}%)`)
console.log(`   높이 공란   ${missing.height} (${(missing.height / blds.length * 100).toFixed(0)}%)`)
console.log(`\n[suggestGrade 결과]`)
console.log(`   판정 나옴 ${judged}동 · null(판정 불가) ${none}동 (${(none / blds.length * 100).toFixed(0)}%)`)
for (const [g, n] of [...byGrade].sort()) console.log(`      ${g}: ${n}동`)
console.log(`\n>>> B안 배지를 상시 띄우면 ${none}동(${(none / blds.length * 100).toFixed(0)}%)에서 '판정 불가'가 뜬다`)
