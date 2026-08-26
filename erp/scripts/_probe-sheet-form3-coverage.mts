/** 시트 47종 → 별지 3쪽 FORM3 항목 커버리지 전수 대조 (읽기 전용).
 *  '어느 시트를 채우면 어느 결과칸이 켜지는가'를 한 장으로 만들어 공백·오검을 드러낸다. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { form3ItemsForSheet, SHEET_FACILITY_MAP } from '../src/lib/sheet-facility-map'
import { FORM3_ITEMS } from '../src/lib/doc-templates/report9'

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

const { data: sheets, error } = await admin
  .from('inspection_sheets').select('sheet_code, sheet_name').order('sheet_code')
if (error) { console.error(JSON.stringify(error)); process.exit(1) }

const norm = (s: string) => s.replace(/\s+/g, '')
const explicit = new Set(Object.keys(SHEET_FACILITY_MAP).map(norm))

say(`FORM3_ITEMS = ${FORM3_ITEMS.length}종 · sheets = ${sheets!.length}종`)
say(`SHEET_FACILITY_MAP 명시 등재 = ${Object.keys(SHEET_FACILITY_MAP).length}건\n`)

const covered = new Set<string>()
const zero: Array<{ code: string; name: string }> = []

say('=== 시트별 커버 항목 ===')
for (const s of sheets!) {
  const items = form3ItemsForSheet(s.sheet_name, FORM3_ITEMS as unknown as string[])
  items.forEach(i => covered.add(i))
  const how = explicit.has(norm(s.sheet_name)) ? '명시' : '퍼지'
  const flag = items.length === 0 ? '  <== 0개' : ''
  say(`${s.sheet_code} [${how}] ${s.sheet_name}`)
  say(`    -> ${items.length}개 ${items.length ? '[' + items.join(', ') + ']' : ''}${flag}`)
  if (items.length === 0) zero.push({ code: s.sheet_code, name: s.sheet_name })
}

say('\n=== 커버 0개 시트 ===')
for (const z of zero) say(`  ${z.code} ${z.name}`)

say('\n=== 어느 시트로도 못 켜지는 FORM3 항목 ===')
const orphan = (FORM3_ITEMS as unknown as string[]).filter(i => !covered.has(i))
if (orphan.length === 0) say('  (없음)')
for (const o of orphan) say(`  ${o}`)

// STD 축만으로 다시 — EXT/MU를 빼면 공백이 생기는가(= EXT가 진짜로 필요한 축인가)
say('\n=== STD 시트만으로 커버되는가 ===')
const stdCovered = new Set<string>()
for (const s of sheets!.filter(x => x.sheet_code.startsWith('STD-'))) {
  form3ItemsForSheet(s.sheet_name, FORM3_ITEMS as unknown as string[]).forEach(i => stdCovered.add(i))
}
const stdOrphan = (FORM3_ITEMS as unknown as string[]).filter(i => !stdCovered.has(i))
say(`  STD가 커버하는 항목 = ${stdCovered.size}/${FORM3_ITEMS.length}`)
say(`  STD로 못 켜는 항목 = ${stdOrphan.length ? stdOrphan.join(', ') : '(없음)'}`)

// 실제 데이터: 어떤 점검 유형이 어떤 시트족에 응답을 남기는가
say('\n=== 실데이터: 점검유형 × 시트족 ===')
// ⚠ 1288행이다 — 페이징 없이 읽으면 Supabase 1000행 상한에 조용히 잘려 192건이 '?'로 샌다
const items: Array<{ item_code: string; sheet_id: string }> = []
for (let off = 0; ; off += 1000) {
  const { data, error: e } = await admin.from('inspection_sheet_items')
    .select('item_code, sheet_id').range(off, off + 999)
  if (e) { console.error('items page error', JSON.stringify(e)); process.exit(1) }
  items.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
say(`  (item 카탈로그 ${items.length}행 페이징 조회)`)
const { data: shRows } = await admin.from('inspection_sheets').select('id, sheet_code')
const codeById = new Map((shRows ?? []).map(s => [s.id, s.sheet_code]))
const familyByItem = new Map(items.map(i => [i.item_code, (codeById.get(i.sheet_id) ?? '?').split('-')[0]]))
const { data: resp } = await admin.from('inspection_sheet_responses').select('inspection_id, item_code')
const { data: insps } = await admin.from('inspections').select('id, inspection_type')
const typeById = new Map((insps ?? []).map(i => [i.id, i.inspection_type]))
const cross = new Map<string, number>()
for (const r of resp ?? []) {
  const key = `${typeById.get(r.inspection_id) ?? '?'} × ${familyByItem.get(r.item_code) ?? '?'}`
  cross.set(key, (cross.get(key) ?? 0) + 1)
}
for (const [k, v] of [...cross].sort()) say(`  ${k} : ${v}건`)

writeFileSync('scripts/_out/sheet-form3-coverage.txt', out.join('\n'), 'utf8')
console.log('wrote scripts/_out/sheet-form3-coverage.txt, lines =', out.length)
