// 점검표 표준항목 시딩 (P2-2) — 전체 보고서.xls → inspection_sheets + inspection_sheet_items
// 실행: node scripts/seed-inspection-sheets.mjs           (dry-run)
//       node scripts/seed-inspection-sheets.mjs --execute (.env.local DB)
// 설비마다 여러 '면' 시트로 분할 → 항목코드 앞 번호(설비번호)로 그룹핑.
// item_name 앞의 ○/● = 작동공통/종합전용 마커 → comprehensive_only.
import xlsx from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SRC = 'F:/AI/ERP/erp_goal/_doc01/전체 보고서.xls'
const VERSION = 'v2025'
const execute = process.argv.includes('--execute')
const CODE = /^\d{1,2}-[A-Z]-\d{1,3}$/
const TITLE = /^(\d{1,2})\.\s*(.+?)\s*점검표/

function normCode(raw) {
  const m = String(raw).replace(/\s/g, '').match(/^(\d{1,2})-([A-Z])-(\d{1,3})$/)
  return m ? `${parseInt(m[1], 10)}-${m[2]}-${m[3].padStart(3, '0')}` : null
}

const wb = xlsx.readFile(SRC)
const facilities = new Map() // num → { num, name, items: [] }
for (const sn of wb.SheetNames) {
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', blankrows: false })
  // 시트 제목에서 설비명 등록
  for (const r of rows) {
    const t = String(r[0] ?? '').trim()
    const tm = t.match(TITLE)
    if (tm) { const n = parseInt(tm[1], 10); if (!facilities.has(n)) facilities.set(n, { num: n, name: tm[2].trim(), items: [] }); break }
  }
  // 항목 추출
  for (const r of rows) {
    const code = normCode(r[0])
    if (!code) continue
    const num = parseInt(code.split('-')[0], 10)
    let text = String(r[1] ?? '').replace(/[\r\n]+/g, ' ').trim()
    const comp = text.startsWith('●')
    text = text.replace(/^[○●]\s*/, '').trim()
    if (!text) continue
    if (!facilities.has(num)) facilities.set(num, { num, name: `설비${num}`, items: [] })
    facilities.get(num).items.push({ code, name: text, comprehensive_only: comp })
  }
}

const facList = [...facilities.values()].sort((a, b) => a.num - b.num).filter(f => f.items.length)
const totalItems = facList.reduce((s, f) => s + f.items.length, 0)
console.log(`설비 ${facList.length}종 · 총 항목 ${totalItems}`)
for (const f of facList) {
  const comp = f.items.filter(i => i.comprehensive_only).length
  console.log(`  ${String(f.num).padStart(2)} ${f.name.slice(0, 28)} — ${f.items.length}항목 (종합전용 ${comp})`)
}

if (!execute) { console.log('\n[dry-run] --execute 로 스테이징 반영'); process.exit(0) }

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
console.log('대상 DB:', env.NEXT_PUBLIC_SUPABASE_URL)

let sheetN = 0, itemN = 0
for (const f of facList) {
  const sheet_code = `STD-${String(f.num).padStart(2, '0')}`
  // 기존 동일 (sheet_code, version) 제거 후 재삽입 (멱등)
  const { data: existing } = await admin.from('inspection_sheets').select('id').eq('sheet_code', sheet_code).eq('version', VERSION).maybeSingle()
  if (existing) await admin.from('inspection_sheets').delete().eq('id', existing.id)
  const { data: sheet, error: se } = await admin.from('inspection_sheets')
    .insert({ sheet_code, sheet_name: f.name, version: VERSION, description: `${f.num}. ${f.name} 표준 점검표 (전체 보고서.xls)` })
    .select('id').single()
  if (se) { console.error(`시트 실패 ${sheet_code}:`, se.message); process.exit(1) }
  sheetN++
  const items = f.items.map((it, i) => ({
    sheet_id: sheet.id, item_code: it.code, item_name: it.name,
    facility_type: f.name, comprehensive_only: it.comprehensive_only, order_num: i + 1,
  }))
  const { error: ie } = await admin.from('inspection_sheet_items').insert(items)
  if (ie) { console.error(`항목 실패 ${sheet_code}:`, ie.message); process.exit(1) }
  itemN += items.length
}
console.log(`시딩 완료 — 점검표 ${sheetN}종 / 항목 ${itemN}`)
