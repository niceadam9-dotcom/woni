/** 기본 담당자 — 지금 설정으로 무엇이 바뀌는가 (쓰기 없음, 미리보기만) */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { defaultAssigneeTargets, assigneeLabel } from '../src/lib/default-assignee.ts'
config({ path: '.env.local', quiet: true })
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: cp } = await a.from('company_profile').select('default_assignee_id').limit(1).maybeSingle()
const def = (cp as { default_assignee_id: string | null } | null)?.default_assignee_id ?? null
const { data: pf } = await a.from('profiles').select('id, name')
const nameOf = new Map((pf ?? []).map(p => [p.id as string, p.name as string]))
console.log(`기본 담당자 설정: ${def ? nameOf.get(def) ?? def : '(미설정)'}`)
const { data: cs, error } = await a.from('customers')
  .select('id, customer_name, inspection_type, assigned_employee_id, assigned_source, is_active')
if (error) throw new Error(error.message)
const act = (cs ?? []).filter(c => c.is_active !== false)
const t = defaultAssigneeTargets(act, def)
console.log(`\n일괄 적용 대상 ${t.length}명:`)
for (const c of t) console.log(`   ${c.customer_name} (${c.inspection_type})`)
console.log(`\n현재 「일반관리」 전건의 표시:`)
for (const c of act.filter(c => c.inspection_type === '일반관리')) {
  const nm = c.assigned_employee_id ? nameOf.get(c.assigned_employee_id as string) ?? '?' : null
  console.log(`   ${String(c.customer_name).padEnd(16)} → ${assigneeLabel(nm, c.assigned_source as string | null)}`)
}
