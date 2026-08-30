/** 판정자 D — D3 확장축: 별지4호 「현황」 판정칸의 dv 어휘 ↔ 주입 어휘 대조 + 서림사 착지 182 재계산 */
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { resultMark } from '../src/lib/doc-templates/base.ts'
import { ANCHORS } from '../src/lib/xlsx-anchors.ts'
import { donorGroupsToKeep } from '../src/lib/xlsx-donors.ts'
import { sheetMatchesFacilities } from '../src/lib/sheet-facility-map.ts'
import { createClient } from '@supabase/supabase-js'

const OUT = path.resolve(process.cwd(), 'scripts/_out/_judgeD-D3b.txt')
const L: string[] = []
const say = (s: string) => L.push(s)

const cp = (s: string) => [...s].map(c => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ')
say('=== resultMark 어휘 코드포인트 ===')
for (const r of ['O', 'X', 'N'] as const) say(`  resultMark('${r}') = ${JSON.stringify(resultMark(r))} ${cp(resultMark(r))}`)

// ── 현황 시트 인라인 dv sqref ∩ f4v_ 앵커 좌표
const zip = await JSZip.loadAsync(fs.readFileSync(path.resolve(process.cwd(), 'templates/report-workbook-full.xlsx')))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rel = new Map<string, string>()
for (const m of relsXml.matchAll(/<Relationship\s([^>]*)\/>/g)) {
  const id = /Id="([^"]+)"/.exec(m[1])?.[1]; const t = /Target="([^"]+)"/.exec(m[1])?.[1]
  if (id && t) rel.set(id, t.replace(/^\/?xl\//, '').replace(/^\.\.\//, ''))
}
let hyunFile = ''
for (const m of wbXml.matchAll(/<sheet\s([^>]*?)\/>/g)) {
  const nm = /name="([^"]*)"/.exec(m[1])?.[1]
  if (nm === '현황') hyunFile = 'xl/' + rel.get(/r:id="([^"]+)"/.exec(m[1])?.[1] ?? '')
}
const hx = await zip.file(hyunFile)!.async('string')
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
const colName = (n: number) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26 } return s }
const expand = (sq: string) => { const o = new Set<string>(); for (const p of sq.trim().split(/\s+/)) { const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(p); if (!m) continue; if (!m[3]) { o.add(m[1] + m[2]); continue } for (let c = colNum(m[1]); c <= colNum(m[3]); c++) for (let r = +m[2]; r <= +m[4]; r++) o.add(colName(c) + r) } return o }

say('')
say('=== 현황 dataValidation ↔ f4v_(판정)·f4i_(설치) 앵커 좌표 ===')
const f4v = ANCHORS.filter(a => a.field.startsWith('f4v_')).map(a => a.cell)
const f4i = ANCHORS.filter(a => a.field.startsWith('f4i_')).map(a => a.cell)
for (const d of hx.matchAll(/<dataValidation\s([^>]*?)(\/>|>([\s\S]*?)<\/dataValidation>)/g)) {
  const a = d[1], body = d[3] ?? ''
  if (!/\btype="list"/.test(a)) continue
  const sq = /sqref="([^"]*)"/.exec(a)?.[1] ?? ''
  const f1 = (/<formula1>([\s\S]*?)<\/formula1>/.exec(body)?.[1] ?? '').replace(/&quot;/g, '"')
  const cells = expand(sq)
  const hitV = f4v.filter(c => cells.has(c))
  const hitI = f4i.filter(c => cells.has(c))
  say(`  f1=${JSON.stringify(f1)} showError=${/showErrorMessage="([^"]*)"/.exec(a)?.[1]} errorStyle=${/errorStyle="([^"]*)"/.exec(a)?.[1]}`)
  say(`    dv셀 ${cells.size} · f4v(판정) 교집합 ${hitV.length} · f4i(설치) 교집합 ${hitI.length}`)
  // 목록 항목 코드포인트
  const opts = f1.replace(/^"|"$/g, '').split(',')
  say(`    목록 항목: ${opts.map(o => `${JSON.stringify(o)}[${cp(o)}]`).join('  ')}`)
  const injected = f1.includes('○') ? (['O', 'X', 'N'] as const).map(r => resultMark(r)) : ['[√]', '[  ]']
  const bad = injected.filter(v => !opts.includes(v))
  say(`    주입 어휘 ${injected.map(v => JSON.stringify(v)).join(' ')} → 목록에 없는 값: ${bad.length ? bad.map(v => `${JSON.stringify(v)}[${cp(v)}]`).join(' ') : '없음'}`)
}

// ── 서림사 착지 재계산 (라우트와 같은 함수로 keptSheets 도출)
const envTxt = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
const env = new Map<string, string>()
for (const line of envTxt.split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) env.set(m[1], m[2]) }
const db = createClient(env.get('NEXT_PUBLIC_SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const { data: cRows } = await db.from('customers').select('id').eq('customer_code', 'C330')
const cid = (cRows as Array<{ id: string }>)[0].id
const { data: bRows } = await db.from('buildings').select('id').eq('customer_id', cid).eq('is_active', true)
const bids = (bRows as Array<{ id: string }>).map(b => b.id)
const { data: fRows, error: fErr } = await db.from('fire_facilities').select('facility_code').in('building_id', bids).eq('installed', true)
if (fErr) say('!! fac err ' + JSON.stringify(fErr))
const installed = [...new Set((fRows as Array<{ facility_code: string }>).map(f => f.facility_code))]
const { data: ff } = await db.from('fire_plan_forms').select('sections').eq('customer_id', cid).limit(1)
const mu = ((ff as Array<{ sections: Record<string, unknown> }>)?.[0]?.sections?.['multiUse'] ?? null) as { applicable?: boolean; categories?: Record<string, string> } | null
const hasMU = !!mu && !!mu.applicable && Object.values(mu.categories ?? {}).some(c => String(c ?? '').trim())
const kept = donorGroupsToKeep(k => sheetMatchesFacilities(k, installed), hasMU)
const keptSheets = new Set(kept.flatMap(g => g.sheets))
say('')
say(`=== 서림사 착지 재계산 ===`)
say(`installed ${installed.length} · hasMultiUse ${hasMU} · keptGroups ${kept.length} · keptSheets ${keptSheets.size}`)
say(`keptSheets: ${[...keptSheets].join(' ')}`)

const itemmap = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/lib/xlsx-donor-itemmap.json'), 'utf8')) as { cells: Record<string, [string, string]> }
const { data: iRows } = await db.from('inspections').select('id').eq('customer_id', cid)
const iid = (iRows as Array<{ id: string }>)[0].id
const resp: Array<{ item_code: string; result: string; month: number }> = []
for (let f = 0; ; f += 1000) {
  const { data, error } = await db.from('inspection_sheet_responses').select('item_code, result, month').eq('inspection_id', iid).range(f, f + 999)
  if (error) { say('!! ' + JSON.stringify(error)); break }
  const rows = (data ?? []) as typeof resp
  resp.push(...rows); if (rows.length < 1000) break
}
const codes = [...new Set(resp.map(r => r.item_code))]
let landed = 0; const removed: string[] = []; const noRow: string[] = []
const markTally = new Map<string, number>()
for (const c of codes) {
  const loc = itemmap.cells[c]
  if (!loc) { noRow.push(c); continue }
  if (!keptSheets.has(loc[0])) { removed.push(c); continue }
  landed++
  const r = resp.find(x => x.item_code === c)!.result as 'O' | 'X' | 'N'
  const m = resultMark(r)
  markTally.set(m, (markTally.get(m) ?? 0) + 1)
}
say(`분모(고유코드) ${codes.length} · 착지 ${landed} · 시트 미동봉 ${removed.length} · 자산 좌표 없음 ${noRow.length}`)
say('착지 마크 분포: ' + [...markTally].map(([k, v]) => `${JSON.stringify(k)}[${cp(k)}]:${v}`).join(' '))
say('시트 미동봉 코드: ' + removed.join(' '))

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, L.join('\n'), 'utf8')
console.log('wrote ' + OUT + ' lines=' + L.length)
