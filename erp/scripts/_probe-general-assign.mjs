// 읽기 전용 — 「일반관리 고객의 담당 배정 실태」 실측 (제안 근거용)
// 실행: node scripts/_probe-general-assign.mjs [.env.local|.env.production]
import { readFileSync } from 'node:fs'
const envFile = process.argv[2] ?? '.env.local'
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
console.log(`DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL} (${envFile})`)

async function fetchAll(builder) {
  const out = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await builder().order('id').range(i, i + 999)
    if (error) { console.log('ERR', error.message); process.exit(2) }
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

// ── 1) 고객: 점검유형 × 배정여부 교차표 ──
const custs = await fetchAll(() => admin.from('customers')
  .select('id, customer_name, inspection_type, assigned_employee_id, is_active, created_at'))
const act = custs.filter(c => c.is_active !== false)
const cross = new Map()
for (const c of act) {
  const t = c.inspection_type ?? '(null)'
  const e = cross.get(t) ?? { total: 0, un: 0 }
  e.total++; if (!c.assigned_employee_id) e.un++
  cross.set(t, e)
}
console.log(`\n[고객] active=${act.length}`)
for (const [t, v] of [...cross.entries()].sort())
  console.log(`  ${t}: total=${v.total} 미배정=${v.un} (${(v.un / v.total * 100).toFixed(1)}%)`)

// ── 2) 최근 1년 신규 등록만 (현재 등록 습관) ──
const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString()
const recent = act.filter(c => (c.created_at ?? '') >= yearAgo)
const rcross = new Map()
for (const c of recent) {
  const t = c.inspection_type ?? '(null)'
  const e = rcross.get(t) ?? { total: 0, un: 0 }
  e.total++; if (!c.assigned_employee_id) e.un++
  rcross.set(t, e)
}
console.log(`\n[고객·최근1년 등록] ${recent.length}건`)
for (const [t, v] of [...rcross.entries()].sort())
  console.log(`  ${t}: total=${v.total} 미배정=${v.un} (${(v.un / v.total * 100).toFixed(1)}%)`)

// ── 3) 일반관리 미배정 고객이 낳은 계획 항목 (크론이 건너뛰는 모집단) ──
const genUn = new Set(act.filter(c => c.inspection_type === '일반관리' && !c.assigned_employee_id).map(c => c.id))
const genAll = new Set(act.filter(c => c.inspection_type === '일반관리').map(c => c.id))
const items = await fetchAll(() => admin.from('inspection_plan_items')
  .select('id, customer_id, plan_type, status, scheduled_date, assigned_employee_id, inspection_id'))
const open = items.filter(i => !i.inspection_id && i.status !== 'canceled')
const genOpen = open.filter(i => genAll.has(i.customer_id))
const genOpenUn = genOpen.filter(i => !i.assigned_employee_id)
console.log(`\n[계획] 일반관리 고객의 미시작 항목 = ${genOpen.length}, 그중 미배정 = ${genOpenUn.length}`)
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const conf = genOpenUn.filter(i => i.status === 'confirmed')
console.log(`  그중 status=confirmed(크론 대상) = ${conf.length}`)
console.log(`  그중 예정일 경과 = ${conf.filter(i => (i.scheduled_date ?? '9999') < today).length}  <= 크론이 건너뛴 채 방치된 건`)
console.log(`  (미배정 일반관리 고객 ${genUn.size}명 / 전체 일반관리 ${genAll.size}명)`)

// ── 4) 직원 명부에 「일반관리」류 계정이 실재하는가 ──
const profs = await fetchAll(() => admin.from('profiles').select('id, name, role, is_active'))
console.log(`\n[직원] total=${profs.length}`)
const suspicious = profs.filter(p => /일반|관리|공용|미배정|팀/.test(p.name ?? ''))
console.log(`  이름에 일반/관리/공용/미배정/팀 포함 = ${suspicious.length}`)
for (const p of suspicious.slice(0, 15)) console.log(`   - ${p.name} (role=${p.role}, active=${p.is_active})`)
