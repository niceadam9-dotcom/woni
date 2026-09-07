/** 소방계획서_44 실측(읽기 전용) — 별지 9호 ③수기 확정값의 '축'을 잰다.
 *  ① annex_inputs(report9)에 2쪽 6키(eduDone/drillDone/prevOpDone/prevCompDone/
 *     firePlanWritten/firePlanStored)가 실제로 몇 건이나 들어 있나 = 이관 대상 규모
 *  ② 같은 (고객, 연도)에 점검 건이 2건 이상인 경우가 몇 건인가 = 같은 사실을 두 번 입력해야 하는 축
 *  ③ 그 중 두 건의 확정값이 서로 다른 '충돌'이 실재하는가 = 고객 단위 승격 시 사람 판단이 필요한 수
 *  실행: npx tsx --conditions=react-server scripts/_probe-44-annex-scope.mts
 *  출력은 전부 ASCII (PS 5.1 한글 뭉갬 회피) */
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.log('ENV MISSING - cannot measure'); process.exit(2) }
const admin = createClient(url, key)

const KEYS = ['eduDone', 'drillDone', 'prevOpDone', 'prevCompDone', 'firePlanWritten', 'firePlanStored'] as const

// (1) annex_inputs report9
const ai = await admin.from('annex_inputs').select('inspection_id, fields').eq('annex_no', 'report9')
if (ai.error) { console.log('annex_inputs ERROR: ' + ai.error.message); process.exit(2) }
const aiRows = (ai.data ?? []) as Array<{ inspection_id: string; fields: Record<string, unknown> | null }>
console.log('[1] annex_inputs(report9) rows = ' + aiRows.length)
const perKey: Record<string, number> = {}
const withAny = new Map<string, Record<string, string>>()
for (const r of aiRows) {
  const f = (r.fields ?? {}) as Record<string, unknown>
  const picked: Record<string, string> = {}
  for (const k of KEYS) {
    const v = typeof f[k] === 'string' ? (f[k] as string).trim() : ''
    if (v) { perKey[k] = (perKey[k] ?? 0) + 1; picked[k] = v }
  }
  if (Object.keys(picked).length) withAny.set(r.inspection_id, picked)
}
for (const k of KEYS) console.log('    ' + k + ' = ' + (perKey[k] ?? 0))
console.log('    rows with at least one of the 6 = ' + withAny.size)

// (2) inspections per (customer, year)
const insp = await admin.from('inspections').select('id, customer_id, year, inspection_type, status')
if (insp.error) { console.log('inspections ERROR: ' + insp.error.message); process.exit(2) }
const iRows = (insp.data ?? []) as Array<{ id: string; customer_id: string; year: number | null; inspection_type: string | null; status: string }>
console.log('[2] inspections rows = ' + iRows.length)
const byCY = new Map<string, string[]>()
for (const r of iRows) {
  if (!r.customer_id || r.year == null) continue
  const k = r.customer_id + '|' + r.year
  byCY.set(k, [...(byCY.get(k) ?? []), r.id])
}
const multi = [...byCY.entries()].filter(([, ids]) => ids.length > 1)
console.log('    distinct (customer,year) = ' + byCY.size)
console.log('    (customer,year) with >=2 inspections = ' + multi.length)
const maxN = multi.reduce((m, [, ids]) => Math.max(m, ids.length), 0)
console.log('    max inspections in one (customer,year) = ' + maxN)

// (3) conflicts: same (customer,year), two inspections, different confirmed value
let pairsWithAny = 0, conflicts = 0
const conflictDetail: string[] = []
for (const [k, ids] of multi) {
  const present = ids.filter(id => withAny.has(id))
  if (present.length >= 1) pairsWithAny++
  if (present.length < 2) continue
  for (const key of KEYS) {
    const vals = new Set(present.map(id => withAny.get(id)![key] ?? ''))
    vals.delete('')
    if (vals.size > 1) { conflicts++; conflictDetail.push(k + ' ' + key + ' -> ' + [...vals].join('/')) }
  }
}
console.log('[3] (customer,year) groups where >=1 inspection has a confirmed value = ' + pairsWithAny)
console.log('    conflicting key instances across siblings = ' + conflicts)
for (const d of conflictDetail.slice(0, 20)) console.log('    ' + d)
