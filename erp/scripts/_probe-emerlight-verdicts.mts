/** 읽기 전용: 실데이터 + 실코드로 「현황」 결과칸 전 행 재현 (image-29 대조).
 *  실행: $env:NODE_OPTIONS='--conditions=react-server'; node node_modules/tsx/dist/cli.mjs scripts/_probe-emerlight-verdicts.mts <inspection_id> [.env파일]
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { foldSheetGroupStats, rollUpForm3Results } from '../src/lib/sheet-facility-map'
import { sheetItemGroupRef } from '../src/lib/sheet-scope'
import { FORM3_ITEMS } from '../src/lib/doc-templates/report9'
import { FORM4_ROWS, form4VerdictMarks, isForm4Installed, form4Form3Item } from '../src/lib/xlsx-form4'
import { resultMark, ck } from '../src/lib/doc-templates/base'

const inspectionId = process.argv[2]
const envFile = process.argv[3] ?? '.env.local'
const env: Record<string, string> = {}
for (const line of readFileSync(new URL(`../${envFile}`, import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

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

const sheets = await all('inspection_sheets', 'id, sheet_code, sheet_name')
const items = await all('inspection_sheet_items', 'item_code, sheet_id, group_code, group_name, facility_type')
const nameById = new Map(sheets.map((s: any) => [s.id, s.sheet_name]))
const sheetByItem = new Map(items.map((i: any) => [i.item_code, nameById.get(i.sheet_id) ?? '']))
const groupByItem = new Map(items.map((i: any) => [i.item_code, sheetItemGroupRef(i).code]))

const resp = await all('inspection_sheet_responses', 'item_code, result', q => q.eq('inspection_id', inspectionId))
const insp = (await db.from('inspections').select('id, customer_id, inspection_type, status').eq('id', inspectionId).single()).data as any
const cust = (await db.from('customers').select('customer_name').eq('id', insp.customer_id).single()).data as any
const blds = (await db.from('buildings').select('id, building_name').eq('customer_id', insp.customer_id)).data as any[]
const b = blds?.[0]
const fac = (await db.from('fire_facilities').select('facility_code, installed').eq('building_id', b?.id)).data as any[]
const codes = (fac ?? []).filter(f => f.installed).map(f => f.facility_code)

// report9-assemble.ts:206-213과 **같은 구성** — 여기서 다르게 접으면 프로브가 제품을 안 보는 셈이 된다
const sheetStat = foldSheetGroupStats(resp.map((r: any) => ({
  sheet: sheetByItem.get(r.item_code) ?? '',
  group: groupByItem.get(r.item_code) ?? null,
  result: r.result,
})))

const { resultMarks } = rollUpForm3Results(sheetStat, FORM3_ITEMS, codes)
const verdicts = form4VerdictMarks(resultMarks as any, codes, [])

console.log(`고객 ${cust?.customer_name} / 회차 ${insp.inspection_type} ${insp.status} / 응답 ${resp.length}건 / 설치 ${codes.length}종\n`)
console.log('셀    설치  결과  설비')
for (const r of FORM4_ROWS) {
  if (!r.verdictCell) continue
  const on = isForm4Installed(r, codes, [])
  const m = verdicts.get(r.verdictCell)
  const printed = m ? resultMark(m) : (on ? '(공란)' : '/')
  console.log(`${r.verdictCell.padEnd(5)} ${ck(on)}  ${String(printed).padEnd(6)} ${r.label}   [FORM3=${form4Form3Item(r) ?? '-'}]`)
}
