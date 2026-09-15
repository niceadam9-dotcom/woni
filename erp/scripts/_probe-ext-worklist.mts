/** 1.4 대장 소화기구 축 **작업 목록** — 부모만 체크된 건에 무엇을 채워야 하는지 (2026-09-15)
 *
 *  점검표(STD-01) 응답을 방증으로 함께 낸다: 1-A에 ○/× 응답이 있으면 소화기구가 실재한다는 뜻이고,
 *  1-B의 어느 세부묶음에 응답이 있으면 그 종류의 자동소화장치가 실재한다는 뜻이다.
 *  ⚠ **방증이지 답이 아니다** — 최종 판단은 사람이 한다(시스템은 대장을 지어내지 않는다).
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { FIRE_SUB_ITEMS, FIRE_SUB_BY_SUBGROUP } from '../src/lib/facility-codes.ts'
config({ path: '.env.local', quiet: true })
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const PARENT = '소화기구 및 자동소화장치'

const q = async <T>(t: string, sel: string): Promise<T[]> => {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await a.from(t).select(sel).range(from, from + 999)
    if (error) throw new Error(`${t}: ${error.message}`)
    out.push(...(data ?? []) as never)
    if ((data?.length ?? 0) < 1000) break
  }
  return out
}
const facs = await q<{ building_id: string; facility_code: string; installed: boolean }>('fire_facilities', 'building_id, facility_code, installed')
const blds = await q<{ id: string; customer_id: string }>('buildings', 'id, customer_id')
const custs = await q<{ id: string; customer_name: string }>('customers', 'id, customer_name')
const items = await q<{ item_code: string; group_code: string | null; subgroup_name: string | null; sheet_id: string }>('inspection_sheet_items', 'item_code, group_code, subgroup_name, sheet_id')
const sheets = await q<{ id: string; sheet_code: string }>('inspection_sheets', 'id, sheet_code')
const resp = await q<{ inspection_id: string; item_code: string; result: string }>('inspection_sheet_responses', 'inspection_id, item_code, result')
const insps = await q<{ id: string; customer_id: string }>('inspections', 'id, customer_id')

const std01 = sheets.find(s => s.sheet_code === 'STD-01')!.id
const itemOf = new Map(items.filter(i => i.sheet_id === std01).map(i => [i.item_code, i]))
const custOfInsp = new Map(insps.map(i => [i.id, i.customer_id]))
const nameOf = new Map(custs.map(c => [c.id, c.customer_name]))
const custOfBld = new Map(blds.map(b => [b.id, b.customer_id]))

const ledger = new Map<string, Set<string>>()
for (const f of facs) {
  if (!f.installed) continue
  const cid = custOfBld.get(f.building_id); if (!cid) continue
  if (!ledger.has(cid)) ledger.set(cid, new Set())
  ledger.get(cid)!.add(f.facility_code)
}
// 점검표 방증 — 고객별로 1-A / 1-B 세부묶음에 응답이 있는가
const evid = new Map<string, { a: number; sub: Map<string, number> }>()
for (const r of resp) {
  const it = itemOf.get(r.item_code); if (!it) continue
  const cid = custOfInsp.get(r.inspection_id); if (!cid) continue
  if (!evid.has(cid)) evid.set(cid, { a: 0, sub: new Map() })
  const e = evid.get(cid)!
  if (it.group_code === '1-A') e.a++
  else if (it.subgroup_name) e.sub.set(it.subgroup_name, (e.sub.get(it.subgroup_name) ?? 0) + 1)
}

console.log('■ 1.4 대장 소화기구 — 손봐야 할 건')
let n = 0
for (const [cid, codes] of ledger) {
  if (!codes.has(PARENT)) continue
  const subs = FIRE_SUB_ITEMS.filter(s => codes.has(s))
  const e = evid.get(cid)
  const 소화기없음 = !codes.has(FIRE_SUB_ITEMS[0])
  if (subs.length && !소화기없음) continue           // 소화기 포함해 하위가 있으면 정상
  n++
  console.log(`\n${n}. ${nameOf.get(cid)}`)
  console.log(`   지금 대장: 부모 ☑ · 하위 ${subs.length ? subs.join(', ') : '없음'}`)
  if (!e) { console.log('   점검표 응답: 없음 (방증 없음 — 현장 확인 필요)'); continue }
  console.log(`   점검표 방증: 1-A(소화기구) 응답 ${e.a}건`
    + (e.a ? ' → 소화기구가 실재한다는 뜻' : ' → 방증 없음'))
  const hit = [...e.sub].filter(([, c]) => c > 0)
  console.log(`                1-B(자동소화장치) 응답: ${hit.length ? hit.map(([k, c]) => `${k} ${c}건 → 대장코드 '${FIRE_SUB_BY_SUBGROUP[k] ?? '?'}'`).join(' · ') : '없음'}`)
}
console.log(`\n총 ${n}건 — 1.4 「소방시설」 탭에서 부모 옆 하위 5종 체크박스로 채우면 됩니다.`)
