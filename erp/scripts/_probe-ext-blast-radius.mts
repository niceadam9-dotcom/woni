/** EXT 시트 커버리지 공백(EXT-02·EXT-07)이 실제 인쇄물에 닿는가 — 영향 반경 실측. 읽기 전용.
 *
 *  가설: 닿지 않는다. report9-actions.ts:435-441의 유형 가드가
 *    별지 4/9/10/11호 = isSpecial(plan_type null 또는 special*) 전용
 *    외관점검표        = !isSpecial 전용
 *  로 배타 분할하고, EXT 응답은 !isSpecial 건에만 있기 때문.
 *  반증 조건: isSpecial=true 인 점검 건에 EXT 응답이 하나라도 있으면 가설은 깨진다. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env: Record<string, string> = {}
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const out: string[] = []
const say = (s: string) => out.push(s)

// 1288행 — 페이징 필수(1000행 상한)
const items: Array<{ item_code: string; sheet_id: string }> = []
for (let off = 0; ; off += 1000) {
  const { data, error } = await admin.from('inspection_sheet_items')
    .select('item_code, sheet_id').range(off, off + 999)
  if (error) { console.error(JSON.stringify(error)); process.exit(1) }
  items.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
const { data: sheets } = await admin.from('inspection_sheets').select('id, sheet_code, sheet_name')
const sheetById = new Map((sheets ?? []).map(s => [s.id, s]))

// EXT 시트의 item_code 접두 실측 — 'X*' 규약이 맞는가
const extCodes = items.filter(i => (sheetById.get(i.sheet_id)?.sheet_code ?? '').startsWith('EXT-'))
const prefixes = new Set(extCodes.map(i => i.item_code.charAt(0)))
say(`EXT 시트 항목 ${extCodes.length}개 · item_code 첫 글자 = {${[...prefixes].join(', ')}}`)
say(`  -> 외관 경로 .like('item_code','X%')가 잡는 비율 = ${extCodes.filter(i => i.item_code.startsWith('X')).length}/${extCodes.length}`)

const extItemSet = new Set(extCodes.map(i => i.item_code))

const { data: resp } = await admin.from('inspection_sheet_responses').select('inspection_id, item_code')
const { data: insps } = await admin.from('inspections').select('id, inspection_type, plan_type, status')
const inspById = new Map((insps ?? []).map(i => [i.id, i]))

const isSpecial = (p: string | null) => !p || p.startsWith('special')

say('\n=== EXT 응답을 가진 점검 건 ===')
const withExt = new Map<string, number>()
for (const r of resp ?? []) if (extItemSet.has(r.item_code)) withExt.set(r.inspection_id, (withExt.get(r.inspection_id) ?? 0) + 1)

let violation = 0
for (const [id, n] of withExt) {
  const i = inspById.get(id)
  const sp = isSpecial(i?.plan_type ?? null)
  if (sp) violation++
  say(`  ${id} type=${i?.inspection_type} plan_type=${i?.plan_type ?? 'NULL'} isSpecial=${sp} extResponses=${n}${sp ? '   <== 반증! 이 건은 별지 9호를 만들 수 있다' : ''}`)
}
if (withExt.size === 0) say('  (없음)')

say('\n=== 역방향: 별지 9호 대상(isSpecial) 건이 EXT 응답을 갖는가 ===')
let specialWithExt = 0
for (const i of insps ?? []) {
  if (!isSpecial(i.plan_type)) continue
  const n = (resp ?? []).filter(r => r.inspection_id === i.id && extItemSet.has(r.item_code)).length
  if (n > 0) { specialWithExt++; say(`  ${i.id} plan_type=${i.plan_type ?? 'NULL'} extResponses=${n}  <== 반증!`) }
}
if (specialWithExt === 0) say('  0건 — 별지 9호 대상 건에 EXT 응답 없음')

say(`\nRESULT: ${violation === 0 && specialWithExt === 0
  ? '가설 유지 — EXT 커버리지 공백은 현재 인쇄물에 닿지 않는다'
  : `가설 반증 — ${Math.max(violation, specialWithExt)}건이 별지 9호 경로에 EXT 응답을 흘린다`}`)

writeFileSync('scripts/_out/ext-blast-radius.txt', out.join('\n'), 'utf8')
console.log(out.join('\n'))
