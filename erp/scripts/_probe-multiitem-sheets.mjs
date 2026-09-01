/** 읽기 전용: FORM3 항목을 2개 이상 덮는 시트 + 그 시트의 중분류(group) 축 실측.
 *  '시트 단위 롤업'이 몇 개 시트에서 항목을 뭉개는지, 중분류로 가를 수 있는지 판정.
 *  실행: node scripts/_probe-multiitem-sheets.mjs [.env파일]
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = process.argv[2] ?? '.env.local'
const env = {}
for (const line of readFileSync(new URL(`../${envFile}`, import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MAP = {
  '비상경보설비 및 단독경보형감지기': ['비상경보설비', '단독경보형감지기'],
  '자동화재탐지설비 및 시각경보장치': ['자동화재탐지설비 및 시각경보기', '화재알림설비'],
  '자동화재속보설비 및 통합감시시설': ['자동화재속보설비', '통합감시시설'],
  '피난기구 및 인명구조기구': ['피난기구', '인명구조기구'],
  '유도등 및 유도표지': ['유도등', '유도표지', '피난유도선'],
  '비상조명등 및 휴대용비상조명등': ['비상조명등', '휴대용비상조명등'],
  '소화용수설비': ['상수도소화용수설비', '소화수조 및 저수조'],
}

const sheets = (await db.from('inspection_sheets').select('id, sheet_code, sheet_name')).data
const out = []
for (const s of sheets) {
  if (!MAP[s.sheet_name]) continue
  const { data: items } = await db.from('inspection_sheet_items')
    .select('item_code, group_code, group_name').eq('sheet_id', s.id).order('item_code')
  const groups = new Map()
  for (const i of items) {
    if (!groups.has(i.group_code)) groups.set(i.group_code, { name: i.group_name, n: 0 })
    groups.get(i.group_code).n++
  }
  console.log(`\n${s.sheet_code} "${s.sheet_name}"  → FORM3 ${MAP[s.sheet_name].length}항목: ${MAP[s.sheet_name].join(' / ')}`)
  for (const [gc, g] of [...groups].sort()) console.log(`    ${gc}  "${g.name}"  ${g.n}문항`)
}
