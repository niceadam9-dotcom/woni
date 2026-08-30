/** 판정자 D — D1/D10 축: 서림사 실데이터 재측정 (읽기 전용, ASCII 술어만).
 *  구현자 주장: 응답 243건(O19·X3·N221) · 착지 182 · 시트 미동봉 27 · 자산 좌표 없음 34 · 중복 0 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const envTxt = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
const env = new Map<string, string>()
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m) env.set(m[1], m[2].replace(/^["']|["']$/g, ''))
}
const url = env.get('NEXT_PUBLIC_SUPABASE_URL')!
const key = env.get('SUPABASE_SERVICE_ROLE_KEY')!
const db = createClient(url, key, { auth: { persistSession: false } })

const OUT = path.resolve(process.cwd(), 'scripts/_out/_judgeD-D1db.txt')
const L: string[] = []
const say = (s: string) => L.push(s)
say(`SUPABASE ${url}`)

function chk(tag: string, r: { data: unknown; error: unknown; count?: number | null }) {
  if (r.error) say(`!! ERROR ${tag}: ${JSON.stringify(r.error)}`)
  return r
}

// ── 컬럼 실측 (한글 술어 금지 — 컬럼명은 ASCII)
const c1 = chk('customers*', await db.from('customers').select('*').limit(1))
say('customers columns: ' + Object.keys((c1.data as Record<string, unknown>[])?.[0] ?? {}).join(','))

// C330 찾기 — ASCII 술어
const cands = chk('cust C330', await db.from('customers').select('id, customer_code, customer_name').eq('customer_code', 'C330'))
say('C330 rows: ' + JSON.stringify(cands.data))
const cust = (cands.data as Array<{ id: string; customer_code: string; customer_name: string }>)?.[0]
if (!cust) { say('!! C330 not found — abort'); fs.writeFileSync(OUT, L.join('\n'), 'utf8'); process.exit(0) }
const cid = cust.id
say(`CUSTOMER ${cust.customer_code} ${JSON.stringify(cust.customer_name)} id=${cid}`)

// ── 점검 건
const insps = chk('inspections', await db.from('inspections')
  .select('id, year, inspection_type, status, created_at').eq('customer_id', cid).order('created_at'))
say('INSPECTIONS ' + ((insps.data as unknown[])?.length ?? 0))
for (const i of (insps.data as Array<Record<string, unknown>>) ?? []) say('  ' + JSON.stringify(i))

// ── 응답 (건별) — 1000행 상한 대비 페이징
async function pageAll<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const r = await q(from, from + 999)
    if (r.error) { say('!! page error ' + JSON.stringify(r.error)); break }
    const rows = (r.data as T[]) ?? []
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

const byInsp: Array<{ id: string; n: number; o: number; x: number; nn: number; other: number; dupCodes: number }> = []
for (const i of (insps.data as Array<{ id: string }>) ?? []) {
  const rows = await pageAll<{ item_code: string; result: string; month: number }>((f, t) =>
    db.from('inspection_sheet_responses').select('item_code, result, month').eq('inspection_id', i.id).range(f, t))
  const cnt = new Map<string, number>()
  for (const r of rows) cnt.set(r.item_code, (cnt.get(r.item_code) ?? 0) + 1)
  byInsp.push({
    id: i.id, n: rows.length,
    o: rows.filter(r => r.result === 'O').length,
    x: rows.filter(r => r.result === 'X').length,
    nn: rows.filter(r => r.result === 'N').length,
    other: rows.filter(r => !['O', 'X', 'N'].includes(r.result)).length,
    dupCodes: [...cnt.values()].filter(v => v > 1).length,
  })
}
say('')
say('RESPONSES per inspection: inspId | total | O | X | N | other | codes-with->1-row')
for (const b of byInsp) say(`  ${b.id} | ${b.n} | ${b.o} | ${b.x} | ${b.nn} | ${b.other} | ${b.dupCodes}`)

// ── 착지 시뮬레이션: itemmap 대조 (설치 설비 필터 없이 / 있이 두 축)
const itemmap = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/lib/xlsx-donor-itemmap.json'), 'utf8')) as
  { cells: Record<string, [string, string]>; resultCols: Record<string, string>; counts: Record<string, number> }
say('')
say(`ITEMMAP codes=${Object.keys(itemmap.cells).length} counts=${JSON.stringify(itemmap.counts)}`)

const big = byInsp.slice().sort((a, b) => b.n - a.n)[0]
if (big) {
  const rows = await pageAll<{ item_code: string; result: string; month: number }>((f, t) =>
    db.from('inspection_sheet_responses').select('item_code, result, month').eq('inspection_id', big.id).range(f, t))
  const byCode = new Map<string, typeof rows>()
  for (const r of rows) { const a = byCode.get(r.item_code) ?? []; a.push(r); byCode.set(r.item_code, a) }
  const noDonor = [...byCode.keys()].filter(c => !itemmap.cells[c])
  const hasDonor = [...byCode.keys()].filter(c => itemmap.cells[c])
  const dup = [...byCode.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k}(${v.length})`)
  say(`BIGGEST inspection ${big.id}: rows=${rows.length} uniqueCodes=${byCode.size}`)
  say(`  noDonorRow(자산 좌표 없음) = ${noDonor.length}  ${noDonor.slice(0, 40).join(' ')}`)
  say(`  hasDonor = ${hasDonor.length}`)
  say(`  duplicated codes = ${dup.length}  ${dup.slice(0, 20).join(' ')}`)
  const sheetsHit = new Map<string, number>()
  for (const c of hasDonor) { const s = itemmap.cells[c][0]; sheetsHit.set(s, (sheetsHit.get(s) ?? 0) + 1) }
  say('  donor sheets touched: ' + [...sheetsHit].map(([s, n]) => `${s}:${n}`).join(' '))
  // 결과열별 분해
  const byCol = new Map<string, number>()
  for (const c of hasDonor) { const col = itemmap.cells[c][1].replace(/\d+/, ''); byCol.set(col, (byCol.get(col) ?? 0) + 1) }
  say('  landing cells by column: ' + [...byCol].map(([c, n]) => `${c}:${n}`).join(' '))
}

// ── 건물 / 소방계획서 입력 축 (D10)
const b1 = chk('buildings*', await db.from('buildings').select('*').eq('customer_id', cid).eq('is_active', true).limit(1))
const bld = (b1.data as Array<Record<string, unknown>>)?.[0]
say('')
say('BUILDING(active,first): ' + (bld ? JSON.stringify({
  id: bld.id, stairs_count: bld.stairs_count, ramp_count: bld.ramp_count,
  elevator_count: bld.elevator_count, evac_elevator_count: bld.evac_elevator_count,
  emergency_elevator_count: bld.emergency_elevator_count,
  floors_above: bld.floors_above, floors_below: bld.floors_below, height: bld.height,
  households: bld.households, building_count: bld.building_count,
  total_area: bld.total_area, building_area: bld.building_area,
  main_structure: bld.main_structure, roof_structure: bld.roof_structure, parking_summary: bld.parking_summary,
}) : 'NONE'))

const ff = chk('fire_plan_forms', await db.from('fire_plan_forms').select('sections').eq('customer_id', cid).limit(1))
const sections = ((ff.data as Array<{ sections: Record<string, unknown> }>)?.[0]?.sections) ?? {}
say('')
say('fire_plan_forms.sections keys: ' + Object.keys(sections).join(','))
for (const k of Object.keys(sections)) {
  const v = JSON.stringify(sections[k])
  say(`  [${k}] len=${v.length} ${v.slice(0, 600)}`)
}

const specs = chk('specs', await db.from('customer_facility_specs').select('section_key, spec, building_id').eq('customer_id', cid))
say('')
say('customer_facility_specs: ' + ((specs.data as unknown[])?.length ?? 0))
for (const s of (specs.data as Array<Record<string, unknown>>) ?? []) {
  const j = JSON.stringify(s.spec)
  say(`  ${s.section_key} bld=${s.building_id} ${j.slice(0, 400)}`)
}

const facs = chk('fire_facilities', await db.from('fire_facilities').select('facility_code, installed').eq('building_id', String(bld?.id ?? '')))
say('')
say('fire_facilities: ' + ((facs.data as unknown[])?.length ?? 0) + ' installed=' + ((facs.data as Array<{ installed: boolean }>) ?? []).filter(f => f.installed).length)
say('  installed codes: ' + ((facs.data as Array<{ facility_code: string; installed: boolean }>) ?? []).filter(f => f.installed).map(f => f.facility_code).join(' '))

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, L.join('\n'), 'utf8')
console.log('wrote ' + OUT + ' lines=' + L.length)
