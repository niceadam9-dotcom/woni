// 운영 company_profile 정정 (2026-08-20 사용자 확정)
//   representative : null      → 김흥준        (공문·위임장 대표자 이름 칸이 비어 있었다)
//   company_name   : 승진소방이엔지 → 승진소방ENG  (레터헤드·표지·위임장이 함께 읽는 값)
//
// ⚠ 한글은 PowerShell 명령줄로 넘기지 않는다(CP949 모지바케). 값은 이 파일 안에 둔다.
// ⚠ 바꾸기 전 값을 찍고, 바꾼 뒤 읽어서 대조한다 — '썼다'와 '들어갔다'는 다르다.
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
config({ path: '.env.local.prod-backup', override: true })

const NAME = '승진소방ENG'
const REP = '김흥준'
const EXPECT_OLD_NAME = '승진소방이엔지'   // 이 값일 때만 바꾼다 — 그새 누가 고쳤으면 멈춘다

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })
console.log('DB:', process.env.NEXT_PUBLIC_SUPABASE_URL)

const { data: before, error: e1 } = await db.from('company_profile')
  .select('id, company_name, representative, official_sender_name, official_rep_title').limit(1).maybeSingle()
if (e1 || !before) { console.error('조회 실패:', e1?.message ?? '행 없음'); process.exit(1) }
console.log('before:', JSON.stringify(before))

if (before.company_name !== EXPECT_OLD_NAME) {
  console.error(`중단 — company_name이 예상('${EXPECT_OLD_NAME}')과 다르다: '${before.company_name}'`)
  process.exit(1)
}
if (before.representative && before.representative !== REP) {
  console.error(`중단 — representative에 이미 다른 이름이 있다: '${before.representative}'`)
  process.exit(1)
}

const { error: e2 } = await db.from('company_profile')
  .update({ company_name: NAME, representative: REP }).eq('id', before.id)
if (e2) { console.error('갱신 실패:', e2.code, e2.message); process.exit(1) }

const { data: after } = await db.from('company_profile')
  .select('company_name, representative, official_sender_name, official_rep_title').eq('id', before.id).maybeSingle()
console.log('after :', JSON.stringify(after))
const ok = after?.company_name === NAME && after?.representative === REP
console.log(ok ? '✅ 반영 확인(읽어서 대조)' : '❌ 값이 기대와 다르다')
console.log(ok ? `공문 명의: ${after.official_sender_name} / ${after.official_rep_title} ${after.representative}(직인생략)` : '')
process.exit(ok ? 0 : 1)
