/** 스테이징 — 저장된 3장 피난계획(sections.evacPlan)·약자(vulnerable) 모양 전수 (읽기 전용, 2026-09-23)
 *  plan-ch3.tsx:218 `plan.routes.map` 크래시의 영향 범위를 센다. */
// @ts-expect-error mjs
import { raw } from './_e2e-helpers.mjs'
const rows: Array<{ customer_id: string; sections: Record<string, unknown> | null }> = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await raw.from('fire_plan_forms').select('customer_id, sections').range(from, from + 999)
  if (error) throw error
  rows.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
let withPlan = 0, noRoutes = 0, withVul = 0, vulNoPlans = 0, vulNoCounts = 0
const samples: string[] = []
for (const r of rows) {
  const p = r.sections?.evacPlan as Record<string, unknown> | undefined
  if (p) { withPlan++; if (!Array.isArray(p.routes)) { noRoutes++; if (samples.length < 5) samples.push(`${r.customer_id} keys=${Object.keys(p).join(',')}`) } }
  const v = r.sections?.vulnerable as Record<string, unknown> | undefined
  if (v) { withVul++; if (!Array.isArray(v.plans)) vulNoPlans++; if (!v.counts || typeof v.counts !== 'object') vulNoCounts++ }
}
console.log({ forms: rows.length, withPlan, noRoutes, withVul, vulNoPlans, vulNoCounts })
console.log(samples.join('\n'))
