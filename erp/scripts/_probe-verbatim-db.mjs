// 편입 12건이 고시 원문과 **축자 일치**하는지 DB 실측 대조 (소방계획서_21 R5-7②, 133 적용 후)
// 실행: node scripts/_probe-verbatim-db.mjs
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

// ── 고시 원문 ──
const D = 'F:/AI/ERP/erp_goal/_doc01'
const f = readdirSync(D).find(x => x.startsWith('[별지 4]') && x.endsWith('.xml'))
const lines = readFileSync(join(D, f), 'utf8')
  .replace(/<\/P>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .split('\n').map(s => s.trim()).filter(Boolean)

const all = []
lines.forEach((l, i) => {
  const m = /^(\d{1,2})\.\s*(.+?)\s*점검표$/.exec(l)
  if (m) all.push({ no: Number(m[1]), at: i })
})
const last = new Map()
for (const h of all) last.set(h.no, h)
const heads = [...last.values()].sort((a, b) => a.at - b.at)
const secLines = no => {
  const i = heads.findIndex(h => h.no === no)
  return lines.slice(heads[i].at, i + 1 < heads.length ? heads[i + 1].at : lines.length)
    .map(l => l.replace(/^[●○]\s*/, '').replace(/\s+$/, ''))
}

// ── DB ──
const env = readFileSync('F:/AI/ERP/erp/.env.local', 'utf8')
const db = createClient(
  /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(env)[1].trim(),
  /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(env)[1].trim(),
  { auth: { persistSession: false } })

const CODES = ['2-H-018', '2-H-019', '2-H-021', '2-H-031',
  '3-K-022', '3-K-023', '3-K-031', '3-K-041', '3-L-001', '3-L-002',
  '13-G-031', '13-G-041']
const { data } = await db.from('inspection_sheet_items')
  .select('item_code, item_name').in('item_code', CODES)
const byCode = new Map(data.map(r => [r.item_code, r.item_name]))

const show = s => s.replace(/ /g, '·')
const norm = s => s.replace(/[\s"“”]/g, '')
let ok = 0, bad = 0, missing = 0

for (const code of CODES) {
  const name = byCode.get(code)
  if (!name) { console.log(`${code.padEnd(9)} ❌ DB에 없음`); missing++; continue }
  const no = Number(code.split('-')[0])
  const hit = secLines(no).find(l => norm(l) === norm(name))
  if (!hit) { console.log(`${code.padEnd(9)} ⚠ 원문에서 대응 문장을 못 찾음 — ${name.slice(0, 40)}`); bad++; continue }
  if (hit === name) { console.log(`${code.padEnd(9)} ✅ 축자 일치`); ok++ }
  else {
    console.log(`${code.padEnd(9)} ⚠ 표기 차이`)
    console.log(`   원문 : ${show(hit)}`)
    console.log(`   DB   : ${show(name)}`)
    bad++
  }
}
console.log(`\n축자 일치 ${ok} · 차이 ${bad} · 미편입 ${missing} / 총 ${CODES.length}`)
process.exit(bad + missing > 0 ? 1 : 0)
