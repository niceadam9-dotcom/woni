/** [독립 판정 19] 스테이징 사전 정찰 2 — 읽기 전용 */
import { raw } from './_e2e-helpers.mjs'
const out = {}
{
  const { data } = await raw.from('inspections')
    .select('id, year, plan_type, inspection_type, sequence_num, status, inspection_start_date')
    .eq('plan_type', 'monthly').limit(2)
  out['monthly 샘플'] = data
}
{
  const { data } = await raw.from('inspections')
    .select('id, year, plan_type, inspection_type, sequence_num, status').eq('plan_type', 'special_작동').limit(2)
  out['special 샘플'] = data
}
{
  const { data, error } = await raw.from('inspection_sheet_responses').select('inspection_id, item_code, result, memo').limit(1)
  out['responses 컬럼'] = error ? error.message : data
}
{
  const { data } = await raw.from('inspection_defects').select('*').limit(1)
  out['defects 컬럼'] = data?.[0] ? Object.keys(data[0]) : []
}
{
  const { data } = await raw.from('inspection_sheets').select('id, sheet_name, version').ilike('sheet_name', '%기타%').limit(5)
  out['기타 시트'] = data
}
console.log(JSON.stringify(out, null, 2))
process.exit(0)
