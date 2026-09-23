/** 스테이징 — fire_plan_forms.sections 키별로 「화면이 기대하는 필드가 빠진」 저장값을 센다 (읽기 전용, 2026-09-23)
 *  3장(evacPlan.routes)·1.11(training.headcount) 크래시가 같은 부류(부분 저장값)라 전 섹션 모양을 한 번에 본다. */
// @ts-expect-error mjs
import { raw } from './_e2e-helpers.mjs'
const rows: Array<{ customer_id: string; sections: Record<string, unknown> | null }> = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await raw.from('fire_plan_forms').select('customer_id, sections').range(from, from + 999)
  if (error) throw error
  rows.push(...(data ?? [])); if (!data || data.length < 1000) break
}
// 섹션별로 화면이 .map/.속성으로 바로 읽는 필드 — 없으면 크래시 후보
const EXPECT: Record<string, Array<[string, 'array' | 'object' | 'string']>> = {
  training: [['headcount', 'object'], ['eduMonths', 'array'], ['drillMonths', 'array'], ['details', 'array'], ['records', 'array']],
  evacPlan: [['routes', 'array']],
  vulnerable: [['plans', 'array'], ['counts', 'object']],
}
const keyCount: Record<string, number> = {}
const bad: Record<string, { n: number; sample: string[] }> = {}
for (const r of rows) for (const [k, v] of Object.entries(r.sections ?? {})) {
  keyCount[k] = (keyCount[k] ?? 0) + 1
  for (const [f, t] of EXPECT[k] ?? []) {
    const x = (v as Record<string, unknown> | null)?.[f]
    const ok = t === 'array' ? Array.isArray(x) : t === 'object' ? !!x && typeof x === 'object' && !Array.isArray(x) : typeof x === 'string'
    if (!ok) { const b = (bad[`${k}.${f}`] ??= { n: 0, sample: [] }); b.n++; if (b.sample.length < 3) b.sample.push(`${r.customer_id.slice(0, 8)} keys=${Object.keys(v as object ?? {}).join(',')}`) }
  }
}
console.log('forms', rows.length, 'section keys:', JSON.stringify(keyCount))
console.log(JSON.stringify(bad, null, 1))
