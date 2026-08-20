// STD-31(기타사항) 점검표가 왜 한 번도 채워지지 않았나 — 데이터 쪽 실측 (읽기 전용)
// 가설 ① 화면에 아예 안 뜬다  ② 뜨는데 사람들이 건너뛴다  ③ 시트/항목 카탈로그가 회차 버전과 어긋난다
// 실행: node scripts/_probe-std31-reach.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function all(table, sel, tweak = q => q) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tweak(db.from(table).select(sel).range(from, from + 999))
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  return out
}

const sheets = await all('inspection_sheets', 'id, sheet_code, sheet_name, version')
const items = await all('inspection_sheet_items', 'item_code, sheet_id')
const resp = await all('inspection_sheet_responses', 'inspection_id, item_code')

const sheetById = new Map(sheets.map(s => [s.id, s]))
const sheetOfItem = new Map(items.map(i => [i.item_code, i.sheet_id]))
const itemsPerSheet = new Map()
for (const i of items) itemsPerSheet.set(i.sheet_id, (itemsPerSheet.get(i.sheet_id) ?? 0) + 1)

// 시트별 응답 건수·응답이 달린 점검 건 수
const respPerSheet = new Map()
const inspPerSheet = new Map()
for (const r of resp) {
  const sid = sheetOfItem.get(r.item_code)
  if (!sid) continue
  respPerSheet.set(sid, (respPerSheet.get(sid) ?? 0) + 1)
  if (!inspPerSheet.has(sid)) inspPerSheet.set(sid, new Set())
  inspPerSheet.get(sid).add(r.inspection_id)
}

console.log(`시트 ${sheets.length}종 · 항목 ${items.length}개 · 응답 ${resp.length}건\n`)
console.log('시트별 응답 현황 (응답 0건인 시트가 STD-31뿐인지 본다)')
const rows = sheets
  .map(s => ({
    code: s.sheet_code, name: s.sheet_name, ver: s.version,
    items: itemsPerSheet.get(s.id) ?? 0,
    resp: respPerSheet.get(s.id) ?? 0,
    insps: (inspPerSheet.get(s.id) ?? new Set()).size,
  }))
  .sort((a, b) => a.resp - b.resp || String(a.code).localeCompare(String(b.code)))

const zero = rows.filter(r => r.resp === 0)
const nonzero = rows.filter(r => r.resp > 0)
console.log(`\n  응답 0건 시트: ${zero.length}종`)
for (const r of zero) console.log(`    · ${String(r.code).padEnd(8)} ${String(r.name).slice(0, 22).padEnd(24)} ver=${r.ver} 항목 ${r.items}`)
console.log(`\n  응답 있는 시트: ${nonzero.length}종 (상위 8)`)
for (const r of nonzero.slice(-8).reverse()) {
  console.log(`    · ${String(r.code).padEnd(8)} ${String(r.name).slice(0, 22).padEnd(24)} ver=${r.ver} 응답 ${r.resp} · 점검 ${r.insps}건`)
}

// 버전 축 — 응답이 달린 시트의 version 분포 vs STD-31의 version
const verOfResponded = new Set(nonzero.map(r => r.ver))
const std31 = rows.filter(r => r.code === 'STD-31')
console.log(`\n── 버전 축 ──`)
console.log(`  응답이 달린 시트의 version: ${[...verOfResponded].join(', ')}`)
for (const r of std31) console.log(`  STD-31 version=${r.ver} · 항목 ${r.items} · 응답 ${r.resp}`)
console.log(std31.every(r => verOfResponded.has(r.ver))
  ? '  → 버전은 같다. 버전 불일치 가설(③)은 아니다.'
  : '  → ③ 버전 불일치 의심 — STD-31만 다른 version이다.')
