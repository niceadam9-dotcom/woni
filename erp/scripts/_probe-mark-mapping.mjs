// 원문 글머리(●/○)와 DB comprehensive_only의 대응 확인 + 편입 위치(order_num) 산출
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('F:/AI/ERP/erp/.env.local', 'utf8')
const db = createClient(
  /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(env)[1].trim(),
  /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(env)[1].trim(),
  { auth: { persistSession: false } })

// 원문에서 (코드, 글머리, 문장) 뽑기 — 코드 줄들이 먼저 나오고 문장 줄들이 이어지는 배치
const D = 'F:/AI/ERP/erp_goal/_doc01'
const f = readdirSync(D).find(x => x.startsWith('[별지 4]') && x.endsWith('.xml'))
const lines = readFileSync(join(D, f), 'utf8')
  .replace(/<\/P>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)

// 문장 → 글머리 맵 (같은 문장이 여러 설비에 나오므로 설비 구분 없이 모아 둔다)
const markOf = new Map()
for (const l of lines) {
  const m = /^([●○])\s*(.+)$/.exec(l)
  if (m) markOf.set(m[2].replace(/\s+/g, ''), m[1])
}

const rows = []
for (let from = 0; ; from += 1000) {
  const { data } = await db.from('inspection_sheet_items')
    .select('item_code, item_name, comprehensive_only, order_num, sheet_id').range(from, from + 999)
  rows.push(...data)
  if (data.length < 1000) break
}

// ① ●/○ ↔ comprehensive_only 대응 — 기존 항목으로 검증
let agree = 0, disagree = 0, unknown = 0
for (const r of rows) {
  const mk = markOf.get(r.item_name.replace(/\s+/g, ''))
  if (!mk) { unknown++; continue }
  const expect = mk === '●'
  if (expect === r.comprehensive_only) agree++
  else { disagree++; if (disagree <= 5) console.log(`  불일치 ${r.item_code} ${mk} vs comprehensive_only=${r.comprehensive_only} — ${r.item_name.slice(0, 40)}`) }
}
console.log(`●/○ ↔ comprehensive_only : 일치 ${agree} · 불일치 ${disagree} · 원문 문장 미발견 ${unknown}\n`)

// ② 편입 위치 — 대상 시트의 현재 최대 order_num
const { data: sheets } = await db.from('inspection_sheets').select('id, sheet_code, sheet_name').in('sheet_code', ['STD-02', 'STD-03', 'STD-13'])
for (const s of sheets) {
  const mine = rows.filter(r => r.sheet_id === s.id)
  const max = Math.max(...mine.map(r => r.order_num ?? 0))
  console.log(`${s.sheet_code} ${s.sheet_name} — 항목 ${mine.length}개, order_num 최대 ${max}`)
}

// ③ 편입 후보 12건의 원문 글머리
console.log('\n편입 후보 글머리:')
const CAND = [
  ['2-H-018', '감시제어반 전용실 적정 설치 및 관리 여부'],
  ['2-H-019', '기계·기구 또는 시설 등 제어 및 감시설비 외 설치 여부'],
  ['2-H-021', '앞면은 적색으로 하고,“옥내소화전설비용 동력제어반” 표지 설치 여부'],
  ['2-H-031', '소방전원보존형발전기는 이를 식별할 수 있는 표지 설치 여부'],
  ['3-K-022', '일제개방밸브 사용 설비 화재감지기 회로별 화재표시 적정 여부'],
  ['3-K-023', '감시제어반과 수신기 간 상호 연동 여부(별도로 설치된 경우)'],
  ['3-K-031', '앞면은 적색으로 하고, “스프링클러설비용 동력제어반” 표지 설치 여부'],
  ['3-K-041', '소방전원보존형발전기는 이를 식별할 수 있는 표지 설치 여부'],
  ['3-L-001', '헤드 설치 제외 적정 여부(설치 제외된 경우)'],
  ['3-L-002', '드렌처설비 설치 적정 여부'],
  ['13-G-031', '앞면은 적색으로 하고,“옥외소화전설비용 동력제어반”표지 설치 여부'],
  ['13-G-041', '소방전원보존형발전기는 이를 식별할 수 있는 표지 설치 여부'],
]
for (const [code, name] of CAND) {
  const mk = markOf.get(name.replace(/\s+/g, '')) ?? '?'
  console.log(`  ${code.padEnd(9)} ${mk}  ${mk === '●' ? '종합점검만' : mk === '○' ? '작동+종합' : '원문에서 못 찾음'}`)
}
