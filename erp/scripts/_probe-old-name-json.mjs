// 읽기 전용 — jsonb 열은 ilike로 못 훑는다(건너뛰면 '깨끗하다'는 거짓 결론이 된다).
// 행을 받아 클라이언트에서 문자열화해 옛 상호를 찾는다.
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
config({ path: process.argv[2] ?? '.env.local.prod-backup', override: true })

const OLD = '승진소방이엔지'
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })
console.log('DB:', process.env.NEXT_PUBLIC_SUPABASE_URL)

for (const t of ['fire_plan_forms', 'inspection_annex_overrides', 'message_templates']) {
  const { data, error } = await db.from(t).select('*').limit(1000)
  if (error) { console.log(`  - ${t}: 조회 불가 (${error.code} ${error.message})`); continue }
  const hits = (data ?? []).filter(r => JSON.stringify(r).includes(OLD))
  console.log(hits.length
    ? `  ⚠ ${t}: ${hits.length}/${data.length}행에 옛 상호 — id ${hits.slice(0, 5).map(h => h.id).join(', ')}`
    : `  ✅ ${t}: ${data.length}행 훑음, 없음`)
}
