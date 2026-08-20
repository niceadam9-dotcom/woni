// '기타' 3항목(방화문·비상구·방염)이 왜 빈칸인지 — 실데이터 확인 (읽기 전용)
// 별지 9호 3쪽 1절 '기타'는 31번 기타사항 점검표(STD-31)의 4개 항목 응답에서만 채워진다.
// 판정: ① 매핑 코드가 틀렸나(시트엔 답이 있는데 다른 코드) ② 아무도 입력을 안 했나
// 실행: node scripts/_probe-etc31-data.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ETC = ['31-A-001', '31-A-002', '31-B-001', '31-B-002']

const { data: items } = await db.from('inspection_sheet_items')
  .select('item_code, sheet_id, item_name').in('item_code', ETC)
console.log(`매핑 대상 항목이 카탈로그에 있는가: ${(items ?? []).length}/4`)
for (const i of items ?? []) console.log(`  · ${i.item_code} — ${String(i.item_name).slice(0, 46)}`)

const sheetId = items?.[0]?.sheet_id
const { data: sheet } = await db.from('inspection_sheets').select('id, sheet_name, sheet_code, version').eq('id', sheetId).maybeSingle()
console.log(`\n소속 시트: ${sheet?.sheet_name} (code=${sheet?.sheet_code}, ver=${sheet?.version})`)

// 이 시트의 전체 항목과, 그 항목들에 달린 응답 — 매핑 오류라면 여기에 답이 있어야 한다
const { data: allItems } = await db.from('inspection_sheet_items')
  .select('item_code').eq('sheet_id', sheetId)
const codes = (allItems ?? []).map(r => r.item_code)
console.log(`시트 전체 항목: ${codes.length}개 (${codes.slice(0, 8).join(', ')}${codes.length > 8 ? ' …' : ''})`)

const { data: sheetResp } = await db.from('inspection_sheet_responses')
  .select('inspection_id, item_code, result').in('item_code', codes)
console.log(`이 시트에 달린 응답 총계: ${(sheetResp ?? []).length}건`)

const { data: mapped } = await db.from('inspection_sheet_responses')
  .select('inspection_id, item_code, result').in('item_code', ETC)
console.log(`그중 별지9호가 읽는 4개 항목 응답: ${(mapped ?? []).length}건`)

console.log('\n── 판정 ──')
if ((sheetResp ?? []).length === 0) {
  console.log('② 아무도 입력하지 않았다 — 시트 전체에 응답이 0건.')
  console.log('   매핑은 정상이고, 31번 기타사항 점검표를 채우면 3칸이 채워진다.')
} else if ((mapped ?? []).length === 0) {
  console.log('① 매핑 코드가 틀렸다 — 시트엔 응답이 있는데 별지9호가 읽는 코드에는 0건.')
  const seen = [...new Set((sheetResp ?? []).map(r => r.item_code))]
  console.log(`   실제 응답이 달린 코드: ${seen.join(', ')}`)
} else {
  console.log('매핑·입력 모두 정상 — 개별 점검 건의 입력 여부 문제')
}

// 참고: 자체점검 건 대비 비율
const { data: insps } = await db.from('inspections')
  .select('id').or('plan_type.is.null,plan_type.like.special_*')
const withEtc = new Set((mapped ?? []).map(r => r.inspection_id))
console.log(`\n자체점검 ${(insps ?? []).length}건 중 '기타' 3칸을 채울 수 있는 건: ${withEtc.size}건`)
