/** 신규등록 순서 — 고객별 탭 완성도 실측 (2026-09-15)
 *
 *  판정식은 **화면의 ⚠ 배지와 같은 것**을 쓴다(customers/[id]/page.tsx tabDefs).
 *  화면이 ⚠라 말하는데 이동 규칙이 다른 답을 내면, 사용자는 어느 쪽을 믿어야 할지 모른다.
 */
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
type C = { id: string; customer_name: string; is_active: boolean | null; created_at: string
  plan_anchor_date: string | null; assigned_employee_id: string | null }
type B = { customer_id: string; is_active: boolean | null; purpose: string | null; total_area: number | null }
type K = { customer_id: string; role: string | null }

const cs = await q<C>('customers', 'id, customer_name, is_active, created_at, plan_anchor_date, assigned_employee_id')
const bs = await q<B>('buildings', 'customer_id, is_active, purpose, total_area')
const ks = await q<K>('customer_contacts', 'customer_id, role')
const active = cs.filter(c => c.is_active !== false)
console.log(`활성 고객 ${active.length}명 · 건물 ${bs.length}행 · 관계인 ${ks.length}행\n`)

const byB = new Map<string, B[]>(); for (const b of bs) { const v = byB.get(b.customer_id) ?? []; v.push(b); byB.set(b.customer_id, v) }
const byK = new Map<string, K[]>(); for (const k of ks) { const v = byK.get(k.customer_id) ?? []; v.push(k); byK.set(k.customer_id, v) }

// ── 화면 tabDefs와 **글자 그대로 같은** 술어 ──
const infoWarn = (c: C) => !c.plan_anchor_date || !c.assigned_employee_id
const bldWarn = (c: C) => { const ab = (byB.get(c.id) ?? []).filter(b => b.is_active)
  return !(ab.length > 0 && ab.some(b => b.purpose && b.total_area != null)) }
const conWarn = (c: C) => !(byK.get(c.id) ?? []).some(k => k.role === '대표')

let n0 = 0, nB = 0, nC = 0, nBC = 0, nOk = 0
const detail: string[] = []
for (const c of active) {
  const i = infoWarn(c), b = bldWarn(c), k = conWarn(c)
  if (i) n0++
  if (b && k) nBC++; else if (b) nB++; else if (k) nC++; else nOk++
  if (b || k) detail.push(`${c.customer_name}\t${i ? '기본⚠' : '기본✓'}\t${b ? '건물⚠' : '건물✓'}\t${k ? '관계인⚠' : '관계인✓'}`)
}
console.log('── 「소방계획서로 바로 가도 되는가」 (건물·관계인 기준)')
console.log(`  ✅ 둘 다 채움 → 소방계획서 직행 가능 : ${nOk}명 (${(nOk / active.length * 100).toFixed(1)}%)`)
console.log(`  ⚠ 건물만 미완                        : ${nB}명`)
console.log(`  ⚠ 관계인만 미완                      : ${nC}명`)
console.log(`  ⚠ 둘 다 미완                         : ${nBC}명`)
console.log(`  (참고) 기본정보 미완                 : ${n0}명 — 담당 미배정·점검일자 없음`)
console.log(`\n→ 순서대로 보내야 할 고객 = ${nB + nC + nBC}명 / ${active.length}명 (${((nB + nC + nBC) / active.length * 100).toFixed(1)}%)`)

// 최근 등록 20명 — 「등록 직후」에 실제로 어느 상태로 태어나는가
const recent = [...active].sort((x, y) => (y.created_at ?? '').localeCompare(x.created_at ?? '')).slice(0, 20)
let rb = 0, rk = 0
console.log('\n── 최근 등록 20명 (등록 직후 상태의 대리 관측)')
for (const c of recent) { if (bldWarn(c)) rb++; if (conWarn(c)) rk++ }
console.log(`  건물 미완 ${rb}/20 · 관계인 미완 ${rk}/20`)
console.log(`  → 등록 폼이 건물 용도·연면적을 ${rb === 0 ? '사실상 늘 채운다(대장 자동)' : `${rb}건 비운 채 만든다`}`)

if (detail.length) {
  console.log('\n── 미완 고객 (앞 25건)')
  console.log(detail.slice(0, 25).join('\n'))
  if (detail.length > 25) console.log(`  … 외 ${detail.length - 25}명`)
}
