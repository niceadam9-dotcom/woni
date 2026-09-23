/** 보고서 준비도 실측 (2026-09-23) — 라우트와 같은 계산을 **서버 없이** 스테이징에 직접 돌린다.
 *  실행: npx tsx scripts/_probe-report-gaps.mts [N]
 *  묻는 것: 탭별 빈칸 분포(기능이 할 일이 있나) · 한 번 계산에 드는 시간(탭 이동마다 부를 만한가) */
import { readFileSync } from 'node:fs'
const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
for (const l of txt.split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim() }

const { createAdminClient } = await import('../src/lib/supabase/admin.ts')
const { assembleOfficial, assembleDelegation } = await import('../src/lib/annex-cover-official.ts')
const { assembleReport9 } = await import('../src/lib/report9-assemble.ts')
const { groupReportGaps, REPORT_INPUT_TABS } = await import('../src/lib/workbook-notice.ts')

const admin = createAdminClient()
const N = Number(process.argv[2] ?? 12)
const y = new Date().getFullYear()
const { data: insps } = await admin.from('inspections')
  .select('id, customer_id, plan_type, year, customers!inner(customer_name, is_active)')
  .eq('year', y).eq('customers.is_active', true).limit(400)
const self = (insps ?? []).filter(i => !i.plan_type || String(i.plan_type).startsWith('special'))
const pick = self.sort(() => 0.5 - Math.random()).slice(0, N)
console.log(`표본 ${pick.length} / 올해 자체점검 ${self.length}`)

const tally: Record<string, Map<string, number>> = Object.fromEntries(REPORT_INPUT_TABS.map(k => [k, new Map()]))
const ms: number[] = []
let zero = 0
for (const i of pick) {
  const t0 = performance.now()
  const [o, d, r] = await Promise.all([
    assembleOfficial(admin, i.customer_id, i.id), assembleDelegation(admin, i.customer_id, i.id), assembleReport9(admin, i.customer_id, i.id),
  ])
  const g = groupReportGaps([...o.missing, ...d.missing, ...r.missing])
  ms.push(performance.now() - t0)
  const counts = REPORT_INPUT_TABS.map(k => g[k].length)
  if (counts.every(c => c === 0)) zero++
  for (const k of REPORT_INPUT_TABS) for (const x of g[k]) tally[k].set(x.short, (tally[k].get(x.short) ?? 0) + 1)
  const name = (i as unknown as { customers: { customer_name: string } }).customers.customer_name
  console.log(`  ${name.padEnd(14)} ${REPORT_INPUT_TABS.map((k, j) => `${k}:${counts[j]}`).join(' ')}  ${Math.round(ms.at(-1)!)}ms`)
}
console.log(`\n빈칸 0인 회차 ${zero}/${pick.length}`)
for (const k of REPORT_INPUT_TABS) {
  console.log(`[${k}] ` + [...tally[k].entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · '))
}
ms.sort((a, b) => a - b)
console.log(`\n시간 중앙 ${Math.round(ms[Math.floor(ms.length / 2)])}ms · 최대 ${Math.round(ms.at(-1)!)}ms (첫 건은 캐시 예열 포함)`)
