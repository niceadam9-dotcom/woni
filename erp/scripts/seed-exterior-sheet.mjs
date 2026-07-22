// 외관점검표(별지 6호) 시트 시딩 — 외관점검표-manifest.json → inspection_sheets(EXT-01~14) + items(X{섹션}-{행})
// manifest는 seed-exterior-placeholders.py가 서식 원본에서 추출 — placeholder 좌표와 항목코드가 항상 일치.
// 실행: node scripts/seed-exterior-sheet.mjs                    (dry-run)
//       node scripts/seed-exterior-sheet.mjs --execute          (스테이징 .env.local)
//       node scripts/seed-exterior-sheet.mjs --execute --prod   (운영 .env.local.prod-backup)
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const VERSION = 'v2022' // 고시 2022-71 (2022-12-01 개정)
const execute = process.argv.includes('--execute')
const prod = process.argv.includes('--prod')

const manifest = JSON.parse(readFileSync('F:/AI/ERP/erp_goal/_form/외관점검표-manifest.json', 'utf8'))
const total = manifest.sections.reduce((s, x) => s + x.items.length, 0)
console.log(`외관점검표 섹션 ${manifest.sections.length}종 · 항목 ${total} (${manifest.source})`)
for (const s of manifest.sections) console.log(`  EXT-${String(s.sec).padStart(2, '0')} ${s.title.slice(0, 34)} — ${s.items.length}항목`)

if (!execute) { console.log('\n[dry-run] --execute 로 반영 (--prod = 운영)'); process.exit(0) }

const envFile = prod ? '../.env.local.prod-backup' : '../.env.local'
const env = Object.fromEntries(
  readFileSync(new URL(envFile, import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
console.log('대상 DB:', env.NEXT_PUBLIC_SUPABASE_URL)

let sheetN = 0, itemN = 0
for (const s of manifest.sections) {
  const sheet_code = `EXT-${String(s.sec).padStart(2, '0')}`
  const { data: existing } = await admin.from('inspection_sheets').select('id').eq('sheet_code', sheet_code).eq('version', VERSION).maybeSingle()
  if (existing) await admin.from('inspection_sheets').delete().eq('id', existing.id)
  const { data: sheet, error: se } = await admin.from('inspection_sheets')
    .insert({ sheet_code, sheet_name: s.title, version: VERSION, description: `외관점검표(별지 6호) ${s.sec}. ${s.title} — ${manifest.source}` })
    .select('id').single()
  if (se) { console.error(`시트 실패 ${sheet_code}:`, se.message); process.exit(1) }
  sheetN++
  const items = s.items.map((it, i) => ({
    sheet_id: sheet.id, item_code: it.code, item_name: it.content,
    facility_type: it.category ?? s.title, order_num: i + 1,
  }))
  const { error: ie } = await admin.from('inspection_sheet_items').insert(items)
  if (ie) { console.error(`항목 실패 ${sheet_code}:`, ie.message); process.exit(1) }
  itemN += items.length
}
console.log(`✅ 시트 ${sheetN} · 항목 ${itemN} 반영 완료`)
