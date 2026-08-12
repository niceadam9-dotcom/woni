// [독립 판정] EX-4 — 테스트 데이터 잔존 0건 · 실데이터 무변경 최종 확인 (읽기 전용)
import { raw } from './_e2e-helpers.mjs'

const out = {}
const { data: cust } = await raw.from('customers').select('id, customer_name').or('customer_name.like.JUDGEEX4%,customer_name.like.JUDGE19%')
out.잔존_판정고객 = (cust ?? []).length
const { data: users } = await raw.auth.admin.listUsers()
out.잔존_판정계정 = (users?.users ?? []).filter(u => /judge-ex4/i.test(u.email ?? '')).length
const { data: profs } = await raw.from('profiles').select('id').like('employee_id', 'JUDGE-EX4%')
out.잔존_프로필 = (profs ?? []).length
const { data: xr } = await raw.from('inspection_sheet_responses').select('id, month').like('item_code', 'X%')
out.실데이터_외관응답 = `${(xr ?? []).length}행 (기준 26) / month 분포 ${JSON.stringify([...new Set((xr ?? []).map(r => r.month))])}`
const { data: all } = await raw.from('inspection_sheet_responses').select('id')
out.응답_전체 = `${(all ?? []).length}행 (기준 170 = 외관26 + 일반144)`
const { data: cp } = await raw.from('company_profile').select('id, updated_at')
out.company_profile = JSON.stringify(cp)
console.log(JSON.stringify(out, null, 1))
process.exit(0)
