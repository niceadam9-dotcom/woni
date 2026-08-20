// 읽기 전용 — 옛 상호('승진소방이엔지')가 다른 데이터에 박혀 있는지 훑는다.
// company_profile만 고치고 끝내면 문서·문구에 옛 표기가 남아 반쪽 개명이 된다.
//
// ⚠ 열 이름을 추측하지 않는다. 한 행을 읽어 **실제 키**를 얻은 뒤 문자열 열만 훑는다.
//   추측하면 42703('열 없음')이 나오는데, 그걸 '없음'으로 읽으면 훑지도 않고 깨끗하다고 말하게 된다.
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
config({ path: process.argv[2] ?? '.env.local.prod-backup', override: true })

const OLD = '승진소방이엔지'
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })
console.log('DB:', process.env.NEXT_PUBLIC_SUPABASE_URL)

const TABLES = ['company_profile', 'message_templates', 'plan_text_library', 'fire_plan_forms',
  'app_settings', 'sms_send_log', 'generated_documents']

let scanned = 0, missing = []
for (const t of TABLES) {
  const { data, error } = await db.from(t).select('*').limit(1)
  if (error) { missing.push(`${t}(${error.code})`); continue }
  const row = data?.[0]
  if (!row) { console.log(`  · ${t}: 행이 없어 훑을 것이 없다`); continue }
  const cols = Object.keys(row).filter(k => typeof row[k] === 'string' || row[k] === null)
  for (const c of cols) {
    const r = await db.from(t).select('id').ilike(c, `%${OLD}%`).limit(5)
    if (r.error) continue                      // json/uuid 등 ilike 불가 열은 건너뛴다
    scanned++
    if ((r.data ?? []).length) console.log(`  ⚠ ${t}.${c}: ${r.data.length}건 — ${JSON.stringify(r.data)}`)
  }
}
console.log(`\n훑은 열 ${scanned}개 — 위에 ⚠가 없으면 옛 상호가 남은 곳이 없다`)
if (missing.length) console.log('접근 불가(존재하지 않거나 권한):', missing.join(', '))
