// 137 적용 검증(읽기 전용) — STD-32 44항목 순서·불릿·그룹 축 + 32-A 선두 18행 축자 표본
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fail++
}

const { data: sheet } = await sb.from('inspection_sheets').select('id').eq('sheet_code', 'STD-32').single()
const { data: items } = await sb.from('inspection_sheet_items')
  .select('item_code, item_name, order_num, comprehensive_only, group_code, group_name, group_order')
  .eq('sheet_id', sheet.id).order('order_num')

check('44항목', items.length === 44, String(items.length))
check('order_num 1~44 연속', items.every((it, i) => it.order_num === i + 1))
check('선두 32-A-001', items[0]?.item_code === '32-A-001' && items[0]?.item_name === '설치수량(구획된 실 등) 및 설치거리(보행거리) 적정 여부')
check('18번째 32-C-001(●)', items[17]?.item_code === '32-C-001' && items[17]?.comprehensive_only === true)
check('19번째 32-C-002(기존 행 시프트)', items[18]?.item_code === '32-C-002')
const comp = items.filter(i => i.comprehensive_only).map(i => i.item_code)
const expComp = ['32-A-015', '32-A-016', '32-A-017', '32-A-018', '32-B-011', '32-C-001']
check('신규 18행 중 ● 6건 정확', expComp.every(c => comp.includes(c)) && !comp.slice(0, 18).some(c => c.startsWith('32-A-00')),
  comp.filter(c => c < '32-C-002').join(','))
check('group_name 백필(소화설비·경보설비·피난구조설비)',
  items[0]?.group_name === '소화설비' && items[13]?.group_name === '경보설비' && items[17]?.group_name === '피난구조설비')
check('전 행 group_code 존재', items.every(i => i.group_code))

// 그룹 헤더 축 — STD-01 표본(134 백필이 인쇄 조립에 흘러들 값)
const { data: s01 } = await sb.from('inspection_sheets').select('id').eq('sheet_code', 'STD-01').single()
const { data: i01 } = await sb.from('inspection_sheet_items')
  .select('item_code, group_name, subgroup_name').eq('sheet_id', s01.id).in('item_code', ['1-A-001', '1-B-031'])
const a = i01.find(x => x.item_code === '1-A-001')
const b = i01.find(x => x.item_code === '1-B-031')
check('STD-01 1-A group_name', a?.group_name === '소화기구(소화기, 자동확산소화기, 간이소화용구)')
check('STD-01 1-B-031 subgroup', b?.subgroup_name === '가스·분말·고체에어로졸 자동소화장치')

console.log(fail === 0 ? '\n전건 통과' : `\n실패 ${fail}건`)
process.exit(fail === 0 ? 0 : 1)
