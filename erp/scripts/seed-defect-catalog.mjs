// 불량 표준 사전 시딩 (P2-1) — 1.전체.xlsx 점검결과 시트 → defect_catalog
// 실행: node scripts/seed-defect-catalog.mjs        (기본 dry-run, 파싱 결과만)
//       node scripts/seed-defect-catalog.mjs --execute   (.env.local DB에 upsert)
// 주의: .env.local이 현재 스테이징 DB를 가리킴 (운영 반영은 별도 지시 후)
import xlsx from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SRC = 'F:/AI/ERP/erp_goal/_doc01/1. 전체.xlsx'
const execute = process.argv.includes('--execute')

// ── 파싱 + 정규화 ──
function normalizeCode(raw) {
  const m = String(raw).replace(/\s/g, '').match(/^0?(\d{1,2})-([A-Z])-(\d{1,3})$/)
  if (!m) return null
  return `${parseInt(m[1], 10)}-${m[2]}-${m[3].padStart(3, '0')}`
}

const wb = xlsx.readFile(SRC)
const rows = xlsx.utils.sheet_to_json(wb.Sheets['점검결과'], { header: 1, defval: '', blankrows: false })
let curEquip = ''
const byCode = new Map()
let order = 0
for (const r of rows) {
  const c = r.map(v => String(v).trim())
  if (c[0] === '번호' || c[0].includes('작동점검결과')) continue
  if (c[1]) curEquip = c[1].replace(/[\r\n]+/g, '').trim()
  const code = normalizeCode(c[2])
  const desc = (c[4] || c[3] || c[5] || '').trim()
  if (!code || !desc) continue
  if (!byCode.has(code)) byCode.set(code, { code, equipment: curEquip, description: desc, sort_order: ++order })
}
const list = [...byCode.values()]
console.log(`파싱: ${list.length}건 (중복 제거 후)`)
console.log('샘플:', JSON.stringify(list.slice(0, 5).map(x => `${x.code} ${x.equipment} ${x.description}`), null, 1))

if (!execute) { console.log('\n[dry-run] --execute 로 스테이징 DB 반영'); process.exit(0) }

// ── DB upsert (.env.local) ──
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
console.log('대상 DB:', env.NEXT_PUBLIC_SUPABASE_URL)

const { error } = await admin.from('defect_catalog').upsert(list, { onConflict: 'code' })
if (error) { console.error('시딩 실패:', error.message); process.exit(1) }
const { count } = await admin.from('defect_catalog').select('*', { count: 'exact', head: true })
console.log(`시딩 완료 — defect_catalog 총 ${count}건`)
