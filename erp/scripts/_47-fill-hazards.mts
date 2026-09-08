/** 서식 1.2.2 화재취약장소를 강순기 문서에서 뽑아 **ERP에 넣는다** (`fire_plan_forms.sections.hazards`).
 *
 *  사용자 지시(2026-09-08): 「보일러실·주방 등은 **ERP에 있는 값 근거로** 양식에 입력한다」.
 *  그런데 ERP에 hazards가 0행이라 양식이 빈 채로 나간다 → 문서 값을 근거로 ERP를 채운다.
 *  값 출처는 납품된 강순기 문서다 — 지어내지 않는다.
 *
 *  ⚠ `sections`는 JSONB 한 덩어리다. **통째로 덮으면 다른 서식 입력이 날아간다**
 *    (photos·location·routeMeta·fireAccess·reportCover가 이미 들어 있다) → 읽어서 병합한다.
 *  실행: npx tsx scripts/_47-fill-hazards.mts [--apply]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { parseTables } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset } from './hwp5-read.mts'

config({ path: '.env.local' })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const APPLY = process.argv.includes('--apply')
const TARGET = '강순기 건물_2'
console.log(APPLY ? '=== 실제 적용 ===' : '=== 미리보기 — 넣으려면 --apply ===')

/* 1) 강순기 문서의 1.2.2 표 뽑기 */
const HERE = dirname(fileURLToPath(import.meta.url))
const zf = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const form = parseTables(await zf.file('Contents/section0.xml')!.async('string'))
const { bytes } = readSectionStream(readFileSync(resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')))
const rec = walkRecords(bytes)
const cal = calibrateCellOffset(rec, form.map(t => t.cells.map(c => ({ row: c.row, col: c.col }))))!
const fills = extractTables(rec, cal.offset)

/* 매니페스트가 1.2.2 = 표 8이라 했지만 **라벨로 다시 찾는다**(인덱스로 세지 않는다) */
const ti = form.findIndex(t => t.cells.some(c => c.text.replace(/\s/g, '').includes('화재취약장소'))
  && t.cells.some(c => c.text.replace(/\s/g, '').includes('화재위험요소')))
if (ti < 0) throw new Error('1.2.2 표를 못 찾았다')
const X = fills[ti]
console.log(`1.2.2 = 표#${ti} (${X.rowCnt}행×${X.colCnt}열)\n`)

const txt = (r: number, c: number) => X.cells.find(x => x.row === r && x.col === c)?.text.replace(/\s+/g, ' ').trim() ?? ''
const CHECKED = /^\s*[■▣☑☒✔]/

/* 행 구조: 장소 | 위치 | 위험요소 체크들. 체크된 것만 모은다 */
type Hazard = { place: string; loc: string; risks: string[] }
const hazards: Hazard[] = []
for (let r = 0; r < X.rowCnt; r++) {
  const place = txt(r, 0), loc = txt(r, 1)
  if (!place || place.includes('화재취약장소') || place.includes('인명피해')) continue
  const risks: string[] = []
  for (const c of X.cells.filter(x => x.row !== null && x.row >= r && x.row < r + 4 && (x.col ?? 0) >= 2)) {
    const v = c.text.replace(/\s+/g, ' ').trim()
    if (CHECKED.test(v)) risks.push(v.replace(/^[■▣☑☒✔]\s*/, '').trim())
  }
  hazards.push({ place, loc, risks: [...new Set(risks)] })
}
console.log(`문서에서 읽은 화재취약장소 ${hazards.length}곳:`)
for (const h of hazards) console.log(`  · «${h.place}» / «${h.loc}» / [${h.risks.join(', ') || '(체크 없음)'}]`)

/* 2) ERP에 병합 저장 */
const { data: cust } = await db.from('customers').select('id').eq('customer_name', TARGET).single()
if (!cust) { console.log(`\n${TARGET}를 못 찾음`); process.exit(1) }
const { data: row } = await db.from('fire_plan_forms').select('sections').eq('customer_id', cust.id as string).maybeSingle()
const sections = { ...((row?.sections ?? {}) as Record<string, unknown>) }
console.log(`\n기존 sections 키: ${Object.keys(sections).join(', ') || '(없음)'}`)
if ((sections.hazards as unknown[] | undefined)?.length) {
  console.log('⚠ 이미 hazards가 있다 — 덮지 않는다'); process.exit(0)
}
sections.hazards = hazards
console.log(`병합 후 키: ${Object.keys(sections).join(', ')}`)

if (!APPLY) { console.log('\n(미리보기 — 적용하려면 --apply)'); process.exit(0) }
const { error } = row
  ? await db.from('fire_plan_forms').update({ sections }).eq('customer_id', cust.id as string)
  : await db.from('fire_plan_forms').insert({ customer_id: cust.id, sections })
console.log(error ? `❌ 저장 실패: ${error.message}` : `✅ hazards ${hazards.length}곳 저장 (다른 서식 입력은 보존)`)
