/** 「건물 미완」의 정체 — 용도인가 연면적인가 건물 자체인가 (2026-09-15) */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const q = async <T>(t: string, sel: string): Promise<T[]> => {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await a.from(t).select(sel).range(from, from + 999)
    if (error) throw new Error(`${t}: ${error.message}`)
    out.push(...(data ?? []) as never); if ((data?.length ?? 0) < 1000) break
  }
  return out
}
const cs = await q<{ id: string; is_active: boolean | null }>('customers', 'id, is_active')
const bs = await q<{ customer_id: string; is_active: boolean | null; purpose: string | null; total_area: number | null; floors_above: number | null }>(
  'buildings', 'customer_id, is_active, purpose, total_area, floors_above')
const act = cs.filter(c => c.is_active !== false)
const byB = new Map<string, typeof bs>(); for (const b of bs) { const v = byB.get(b.customer_id) ?? []; v.push(b as never); byB.set(b.customer_id, v as never) }
let none = 0, noPurpose = 0, noArea = 0, noBoth = 0, ok = 0
for (const c of act) {
  const ab = (byB.get(c.id) ?? []).filter(b => b.is_active)
  if (ab.length === 0) { none++; continue }
  if (ab.some(b => b.purpose && b.total_area != null)) { ok++; continue }
  const p = ab.some(b => b.purpose), ar = ab.some(b => b.total_area != null)
  if (!p && !ar) noBoth++; else if (!p) noPurpose++; else noArea++
}
console.log(`활성 고객 ${act.length}명`)
console.log(`  ✅ 용도+연면적 있는 동 존재 : ${ok}`)
console.log(`  ⚠ 활성 건물 0동            : ${none}`)
console.log(`  ⚠ 용도만 없음              : ${noPurpose}`)
console.log(`  ⚠ 연면적만 없음            : ${noArea}`)
console.log(`  ⚠ 둘 다 없음               : ${noBoth}`)
const ab = bs.filter(b => b.is_active)
console.log(`\n활성 건물 ${ab.length}행 — 용도 有 ${ab.filter(b => b.purpose).length} · 연면적 有 ${ab.filter(b => b.total_area != null).length} · 층수 有 ${ab.filter(b => b.floors_above != null).length}`)
