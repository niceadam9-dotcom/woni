/** 중분류 롤업 전환의 **영향 범위 실측**(읽기 전용) — 응답이 있는 전 회차에서
 *  '시트 단위(옛)' vs '중분류(현)' 결과칸을 나란히 계산해 달라지는 칸을 전수로 센다.
 *  가드를 켤 때는 막히는/바뀌는 건수를 먼저 세는 게 이 저장소의 규약이다.
 *  실행: $env:NODE_OPTIONS='--conditions=react-server'; node node_modules/tsx/dist/cli.mjs scripts/_probe-group-axis-blast.mts [.env파일]
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { foldSheetGroupStats, legacySheetOnlyStats, rollUpForm3Results, foldSheetResult, type SheetStat } from '../src/lib/sheet-facility-map'
import { FORM3_ITEMS } from '../src/lib/doc-templates/report9'
import { sheetItemGroupRef } from '../src/lib/sheet-scope'
import { resultMark } from '../src/lib/doc-templates/base'

const envFile = process.argv[2] ?? '.env.local'
const env: Record<string, string> = {}
for (const line of readFileSync(new URL(`../${envFile}`, import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
console.log(`env=${envFile} url=${env.NEXT_PUBLIC_SUPABASE_URL}`)

const all = async (t: string, sel: string, tweak?: (q: any) => any) => {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    let q: any = db.from(t).select(sel).range(from, from + 999)
    if (tweak) q = tweak(q)
    const { data, error } = await q
    if (error) throw new Error(`${t}: ${error.message}`)
    out.push(...(data as any[]))
    if ((data as any[]).length < 1000) break
  }
  return out
}

const sheets = await all('inspection_sheets', 'id, sheet_name')
const items = await all('inspection_sheet_items', 'item_code, sheet_id, group_code, group_name, facility_type')
const nameById = new Map(sheets.map((s: any) => [s.id, s.sheet_name]))
const sheetByItem = new Map(items.map((i: any) => [i.item_code, nameById.get(i.sheet_id) ?? '']))
const groupByItem = new Map(items.map((i: any) => [i.item_code, sheetItemGroupRef(i).code]))

const resp = await all('inspection_sheet_responses', 'inspection_id, item_code, result')
const insps = await all('inspections', 'id, customer_id, inspection_type, status')
const custs = await all('customers', 'id, customer_name')
const custName = new Map(custs.map((c: any) => [c.id, c.customer_name]))
const inspById = new Map(insps.map((i: any) => [i.id, i]))

const byInsp = new Map<string, any[]>()
for (const r of resp) byInsp.set(r.inspection_id, [...(byInsp.get(r.inspection_id) ?? []), r])

// 대장(대표 1동) — report9-assemble과 같은 축
const blds = await all('buildings', 'id, customer_id, is_active')
const facs = await all('fire_facilities', 'building_id, facility_code, installed')
const facByBld = new Map<string, string[]>()
for (const f of facs) {
  if (!f.installed) continue
  facByBld.set(f.building_id, [...(facByBld.get(f.building_id) ?? []), f.facility_code])
}

let inspCount = 0, changed = 0
const rows: string[] = []
for (const [id, rs] of byInsp) {
  const insp = inspById.get(id)
  if (!insp) continue
  inspCount++
  const b = blds.find((x: any) => x.customer_id === insp.customer_id && x.is_active !== false)
  const codes = b ? (facByBld.get(b.id) ?? []) : []

  const folded = rs.map(r => ({
    sheet: sheetByItem.get(r.item_code) ?? '',
    group: groupByItem.get(r.item_code) ?? null,
    result: r.result,
  }))
  const now = rollUpForm3Results(foldSheetGroupStats(folded), FORM3_ITEMS, codes).resultMarks

  const old = new Map<string, SheetStat>()
  for (const f of folded) { if (f.sheet) old.set(f.sheet, foldSheetResult(old.get(f.sheet), f.result)) }
  const before = rollUpForm3Results(legacySheetOnlyStats(old), FORM3_ITEMS, codes).resultMarks

  for (const it of FORM3_ITEMS) {
    if (before[it] === now[it]) continue
    changed++
    rows.push(`  ${custName.get(insp.customer_id) ?? '?'} [${insp.inspection_type}/${insp.status}] `
      + `${it}: "${resultMark(before[it]) || '공란'}" → "${resultMark(now[it]) || '공란'}"`)
  }
}

console.log(`\n응답 있는 회차 ${inspCount}건 · FORM3 ${FORM3_ITEMS.length}항목 = 판정칸 ${inspCount * FORM3_ITEMS.length}개`)
console.log(`달라지는 칸: ${changed}개\n`)
console.log(rows.join('\n') || '  (없음)')
