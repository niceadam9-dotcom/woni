/** 담당직원 미배정 분포 — 점검유형별 (2026-09-15) */
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
const cs = await q<Record<string, unknown>>('customers', '*')
console.log(`고객 ${cs.length}명 · 컬럼에 담당/유형 축: ${Object.keys(cs[0] ?? {}).filter(k => /assign|type|active|region/.test(k)).join(', ')}`)
const active = cs.filter(c => c.is_active !== false)
const un = active.filter(c => !c.assigned_employee_id)
console.log(`\n활성 고객 ${active.length}명 중 **담당 미배정 ${un.length}명**`)
const by = new Map<string, { all: number; un: number }>()
for (const c of active) {
  const k = `${c.inspection_type ?? '?'} / ${c.inspection_sub_type ?? '-'}`
  const e = by.get(k) ?? { all: 0, un: 0 }
  e.all++; if (!c.assigned_employee_id) e.un++
  by.set(k, e)
}
console.log('\n점검유형 / 세부유형 별 (미배정 / 전체)')
for (const [k, v] of [...by].sort((x, y) => y[1].un - x[1].un)) {
  console.log(`   ${String(v.un).padStart(3)} / ${String(v.all).padStart(3)}   ${k}`)
}
const withRegion = un.filter(c => c.region_si || c.region_myeon)
console.log(`\n미배정 중 지역정보가 있는 고객: ${withRegion.length}명 (지역별 일괄 배정으로 바로 처리 가능)`)
