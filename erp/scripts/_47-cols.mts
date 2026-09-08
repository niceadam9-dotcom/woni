/** customers·buildings의 **실제 컬럼 이름만** 뽑는다 (값은 안 찍는다).
 *  select 목록을 추측으로 짜면 없는 컬럼 하나가 조용한 0행이 된다(feedback_supabase_check_error). */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: process.argv[2] ?? '.env.local' })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

for (const t of ['customers', 'buildings']) {
  const { data, error } = await db.from(t).select('*').limit(1)
  if (error) { console.log(`${t}: 조회 실패 — ${error.message}`); continue }
  const cols = data?.length ? Object.keys(data[0] as object) : []
  console.log(`\n── ${t} (${cols.length}컬럼) ──\n${cols.join(', ')}`)
}
