/** 판정자 C — 픽스처 잔여 0건 확인. ASCII 술어로만 조회한다(한글 술어는 조용히 0건을 준다).
 *  실행: npx tsx scripts/_judgeD-C-cleanup.mts */
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'

const { data: prof, error: pErr } = await raw.from('profiles').select('id, email').eq('email', 'd11-live@erp-test.com')
console.log(`profiles.email = 'd11-live@erp-test.com' → ${pErr ? 'ERR ' + pErr.message : `${(prof ?? []).length}rows`}`)
let authHit = 0
for (let page = 1; page <= 20; page++) {
  const { data: ex } = await raw.auth.admin.listUsers({ page, perPage: 1000 })
  const users = ex?.users ?? []
  for (const u of users) if (u.email === 'd11-live@erp-test.com') authHit++
  if (users.length < 1000) break
}
console.log(`auth users email = 'd11-live@erp-test.com' → ${authHit}rows`)
// 서림사 응답이 읽기만 됐는지(건수·분포가 착수 시점과 같은가)
const { data: rs, error } = await raw.from('inspection_sheet_responses')
  .select('item_code, result').eq('inspection_id', '98e3a13b-881d-4e20-9e42-b68c7c3b88f4').limit(2000)
if (error) console.log('ERR ' + error.message)
else {
  const r = rs as Array<{ result: string }>
  console.log(`inspection_sheet_responses(C330 1st) = ${r.length} rows · O ${r.filter(x => x.result === 'O').length} · X ${r.filter(x => x.result === 'X').length} · N ${r.filter(x => x.result === 'N').length}`)
}
