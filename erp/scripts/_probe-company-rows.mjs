// company_profile 행 수·sms_lead_rules 확인 (소방계획서_24 배너 줄 수 불일치 조사)
//
// 배경: '단일 행' 전제였으나 스테이징에 2행이 있었다. ORDER BY 없는 .limit(1)이
// 저장 때와 조회 때 서로 다른 행을 잡아, 시점을 저장해도 배너가 옛 값을 읽었다.
// 코드는 정렬을 고정해 해소했고(COMPANY_PROFILE_ORDER), 이 프로브는 상태 확인용으로 남긴다.
//
// 실행: node scripts/_probe-company-rows.mjs          — 조회만
//       node scripts/_probe-company-rows.mjs --align  — 모든 행의 sms_lead_rules를 첫 행 값으로 통일
import { raw } from './_e2e-helpers.mjs'

const { data, error } = await raw.from('company_profile')
  .select('id, company_name, sms_lead_rules').order('id', { ascending: true })
if (error) { console.error(error.message); process.exit(1) }

console.log(`company_profile rows: ${(data ?? []).length}`)
for (const r of data ?? []) console.log(` - ${r.id} | ${r.company_name} | sms_lead_rules=${JSON.stringify(r.sms_lead_rules)}`)

if ((data ?? []).length > 1) {
  console.log('\n⚠ 행이 둘 이상입니다 — 코드는 id 오름차순 첫 행을 봅니다(정렬 고정).')
  console.log('  값이 행마다 다르면 다른 화면이 다른 값을 읽을 수 있으니 행 정리는 별도 과제로 남깁니다.')
}

if (process.argv.includes('--align') && (data ?? []).length > 1) {
  const target = data[0].sms_lead_rules
  for (const r of data.slice(1)) {
    await raw.from('company_profile').update({ sms_lead_rules: target }).eq('id', r.id)
    console.log(`  통일: ${r.id} → ${JSON.stringify(target)}`)
  }
}
