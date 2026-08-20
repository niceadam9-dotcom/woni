// 147 공문 발신 명의 값 채우기 (2026-08-20 사용자 지시).
//   node scripts/_apply-147-sender.mjs .env.local            → 스테이징
//   node scripts/_apply-147-sender.mjs .env.local.prod-backup → 운영
//
// ⚠ 한글은 PowerShell 명령줄로 넘기지 않는다(CP949 모지바케). 값은 이 파일 안에 둔다.
// ⚠ 조건부로 쓴다 — 이미 사람이 넣어 둔 값이 있으면 덮지 않는다.
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const envPath = process.argv[2]
if (!envPath) { console.error('사용법: node scripts/_apply-147-sender.mjs <env파일>'); process.exit(2) }
config({ path: envPath, override: true })

const SENDER = '주식회사 승진소방ENG'
const TITLE = '대표이사'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })
console.log(`DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL}  (${envPath})`)

const { data: before, error: e1 } = await db.from('company_profile')
  .select('id, company_name, representative, official_sender_name, official_rep_title').limit(1).maybeSingle()
if (e1) { console.error('조회 실패:', e1.code, e1.message); process.exit(1) }
if (!before) { console.error('company_profile 행이 없다 — 넣을 대상이 없다'); process.exit(1) }
console.log('before:', JSON.stringify(before, null, 0))

// 대표자 이름은 기존 칸을 그대로 쓴다(147 주석) — 비어 있으면 명의 줄이 반쪽이 되므로 알린다
if (!before.representative) console.log('⚠ representative가 비어 있다 — 명의 둘째 줄의 대표자 이름이 빈다')

if (before.official_sender_name || before.official_rep_title) {
  console.log('→ 이미 값이 있다. 덮지 않는다(사용자가 설정 화면에서 바꾼 값일 수 있다).')
  process.exit(0)
}

const { error: e2 } = await db.from('company_profile')
  .update({ official_sender_name: SENDER, official_rep_title: TITLE }).eq('id', before.id)
if (e2) { console.error('갱신 실패:', e2.code, e2.message); process.exit(1) }

const { data: after } = await db.from('company_profile')
  .select('company_name, representative, official_sender_name, official_rep_title').eq('id', before.id).maybeSingle()
console.log('after :', JSON.stringify(after, null, 0))
const ok = after?.official_sender_name === SENDER && after?.official_rep_title === TITLE
console.log(ok ? '✅ 반영 확인(읽어서 대조)' : '❌ 값이 기대와 다르다')
process.exit(ok ? 0 : 1)
