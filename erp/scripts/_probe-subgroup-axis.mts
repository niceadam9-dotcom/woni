/** subgroup_name 축이 1.4 세분 코드와 맞는가 — 자동소화장치(1-B) vs 자탐(15) 대조 (2026-09-15) */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const norm = (s: string) => s.replace(/\s+/g, '')

const items: Array<{ item_code: string; group_code: string | null; group_name: string | null; subgroup_name: string | null; sheet_id: string }> = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await a.from('inspection_sheet_items')
    .select('item_code, group_code, group_name, subgroup_name, sheet_id').order('item_code').range(from, from + 999)
  if (error) throw new Error(error.message)
  items.push(...(data ?? []) as never)
  if ((data?.length ?? 0) < 1000) break
}
const { data: sheets, error: e1 } = await a.from('inspection_sheets').select('id, sheet_code, sheet_name')
if (e1) throw new Error(e1.message)
const shOf = new Map((sheets ?? []).map(s => [s.id as string, s]))

const facs: string[] = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await a.from('fire_facilities').select('facility_code').eq('installed', true).range(from, from + 999)
  if (error) throw new Error(error.message)
  facs.push(...(data ?? []).map(r => r.facility_code as string))
  if ((data?.length ?? 0) < 1000) break
}
const codeSet = new Set(facs.map(norm))
console.log(`1.4에 **실제 저장된** 설비코드(정규화) ${codeSet.size}종\n`)

for (const code of ['STD-01', 'STD-15']) {
  const sh = (sheets ?? []).find(s => s.sheet_code === code)!
  const its = items.filter(i => i.sheet_id === sh.id)
  console.log(`■ ${sh.sheet_code} ${sh.sheet_name}`)
  const seen = new Set<string>()
  for (const i of its) {
    const key = `${i.group_code}|${i.subgroup_name ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const g = String(i.group_name ?? ''), sg = String(i.subgroup_name ?? '')
    const gHit = codeSet.has(norm(g)), sHit = sg ? codeSet.has(norm(sg)) : false
    console.log(`   [${i.group_code}] "${g}"${sg ? ` / "${sg}"` : ''}`)
    console.log(`        그룹이 1.4 코드와 일치? ${gHit ? '✔' : '✕'}   세부묶음이 1.4 코드와 일치? ${sg ? (sHit ? '✔ ← 이 축으로 갈린다' : '✕') : '(세부묶음 없음)'}`)
  }
  console.log()
}
