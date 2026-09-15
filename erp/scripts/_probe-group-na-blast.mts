/** 전 고객 영향 범위 — 「미설치 중분류 자동 ／」가 몇 명·몇 칸을 바꾸는가 (2026-09-15)
 *  법정 문서의 인쇄 내용을 바꾸는 변경이라, 배포 전에 폭을 수치로 안다. */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { groupInstalledInSheet, subgroupInstalledInSheet, sheetMatchesFacilities } from '../src/lib/sheet-facility-map.ts'
config({ path: '.env.local', quiet: true })
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { data: custs, error: e0 } = await a.from('customers').select('id, customer_name')
if (e0) throw new Error(e0.message)
const { data: blds, error: e1 } = await a.from('buildings').select('id, customer_id')
if (e1) throw new Error(e1.message)
const { data: facs, error: e2 } = await a.from('fire_facilities').select('building_id, facility_code, installed')
if (e2) throw new Error(e2.message)
const custOfBld = new Map((blds ?? []).map(x => [x.id as string, x.customer_id as string]))
const codesByCust = new Map<string, Set<string>>()
for (const r of facs ?? []) {
  if (!r.installed) continue
  const cid = custOfBld.get(r.building_id as string); if (!cid) continue
  if (!codesByCust.has(cid)) codesByCust.set(cid, new Set())
  codesByCust.get(cid)!.add(r.facility_code as string)
}
// 🚨 1000행 상한 — 항목이 1288행이라 페이징 없이는 그룹이 조용히 빠진다
const items: Array<{ item_code: string; group_code: string | null; subgroup_name: string | null; sheet_id: string }> = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await a.from('inspection_sheet_items')
    .select('item_code, group_code, subgroup_name, sheet_id').order('item_code').range(from, from + 999)
  if (error) throw new Error(error.message)
  items.push(...(data ?? []) as never)
  if ((data?.length ?? 0) < 1000) break
}
const { data: sheets, error: e3 } = await a.from('inspection_sheets').select('id, sheet_name, sheet_code')
if (e3) throw new Error(e3.message)
const sheetOf = new Map((sheets ?? []).map(s => [s.id as string, s]))

let affected = 0, total = 0
const bySheet = new Map<string, number>()
const samples: string[] = []
for (const cust of custs ?? []) {
  const codes = [...(codesByCust.get(cust.id as string) ?? [])]
  if (!codes.length) continue
  let na = 0
  for (const it of items) {
    const sh = sheetOf.get(it.sheet_id)
    if (!sh || !/^STD-/.test(String(sh.sheet_code))) continue
    if (!sheetMatchesFacilities(String(sh.sheet_name), codes)) continue   // 시트째 미설치는 종전 축이 다룬다
    const byGroup = groupInstalledInSheet(String(sh.sheet_name), it.group_code ?? null, codes) === false
    const bySub = subgroupInstalledInSheet(it.subgroup_name, codes) === false
    if (!byGroup && !bySub) continue
    na++
    const k = `${sh.sheet_code} ${sh.sheet_name}`
    bySheet.set(k, (bySheet.get(k) ?? 0) + 1)
  }
  if (na) { affected++; total += na; if (samples.length < 6) samples.push(`   ${cust.customer_name}: ${na}칸  (설치: ${codes.join(' / ')})`) }
}
console.log(`고객 ${(custs ?? []).length}명 · 1.4 설비가 등록된 고객 ${codesByCust.size}명`)
console.log(`\n■ 영향 받는 고객 ${affected}명 · 자동 ／로 바뀌는 칸 총 ${total}건`)
console.log(samples.join('\n'))
console.log(`\n시트별:`)
for (const [k, v] of [...bySheet].sort((x, y) => y[1] - x[1])) console.log(`   ${k}: ${v}칸`)
