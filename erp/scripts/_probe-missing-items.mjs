// 엑셀 전용 12개 코드의 정체를 **고시 원문에서 복원** — 편입안 근거 (소방계획서_21 R5-6 선행)
//
// 방법: 법정 별지 4호서식 XML을 설비별 점검표로 쪼개고, 각 설비의 점검항목 문장을 순서대로 뽑는다.
// 그 문장 집합과 DB(inspection_sheet_items)의 같은 설비 항목명을 대조해 **원문에는 있는데 DB에 없는 문장**을
// 찾는다. 엑셀 전용 코드가 붙은 면과 대조하면 코드↔문장이 맞물린다.
//
// 실행: node scripts/_probe-missing-items.mjs
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const DOC_DIR = 'F:/AI/ERP/erp_goal/_doc01'
const xmlName = readdirSync(DOC_DIR).find(f => f.startsWith('[별지 4]') && f.endsWith('.xml'))
if (!xmlName) throw new Error('별지 4호 원문 XML을 찾지 못했습니다')
const raw = readFileSync(join(DOC_DIR, xmlName), 'utf8')

// ⚠ 태그를 전부 개행으로 바꾸면 한 문장이 run 단위로 쪼개진다("의 유효수량 적정 여부" 같은 조각).
// HWPML은 문단이 <P>…</P>이므로 **문단 경계에서만 자르고** 안쪽 인라인 태그는 지워서 문장을 복원한다.
const lines = raw
  .replace(/<\/P>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)

// "2. 옥내소화전설비 점검표" 같은 머리줄로 설비 구간을 나눈다.
// ⚠ 같은 문구가 앞쪽 **목차**에도 연달아 나온다(489~) — 목차는 머리줄이 연속으로 붙어 있으므로
//    설비 번호별로 **마지막 출현**을 본문 머리로 본다.
const all = []
lines.forEach((l, i) => {
  const m = /^(\d{1,2})\.\s*(.+?)\s*점검표$/.exec(l)
  if (m) all.push({ no: Number(m[1]), name: m[2], at: i })
})
const lastOf = new Map()
for (const h of all) lastOf.set(h.no, h)          // 뒤로 갈수록 덮어씀 = 본문
const heads = [...lastOf.values()].sort((a, b) => a.at - b.at)
const sectionOf = no => {
  const idx = heads.findIndex(h => h.no === no)
  if (idx < 0) return null
  const start = heads[idx].at
  const end = idx + 1 < heads.length ? heads[idx + 1].at : lines.length
  return { ...heads[idx], lines: lines.slice(start, end) }
}

/** 점검항목 문장 — 글머리 문자는 서식마다 다르므로(●·○·ㅇ·- 등) 실제 등장하는 것을 모아 쓴다.
 *  '~ 여부'·'~ 적정'으로 끝나는 서술이 점검항목의 형태다. */
const BULLET = /^[●○◦∙•·ㅇ\-*]\s*/
const itemsOf = sec => sec.lines
  .map(l => l.replace(BULLET, '').replace(/\s+/g, ' ').trim())
  .filter(l => l.length > 6 && /(여부|적정|것)$/.test(l))

// ── DB 항목 ──
const { createClient } = await import('@supabase/supabase-js')
const env = readFileSync('F:/AI/ERP/erp/.env.local', 'utf8')
const url = /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(env)?.[1].trim()
const key = /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(env)?.[1].trim()
const db = createClient(url, key, { auth: { persistSession: false } })

const dbItems = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('inspection_sheet_items')
    .select('item_code, item_name').range(from, from + 999)
  if (error) throw new Error(error.message)
  dbItems.push(...data)
  if (data.length < 1000) break
}

/** 문장 비교용 정규화 — 공백·괄호 안 여백·문장부호 차이를 흡수 */
const norm = s => s.replace(/\s+/g, '').replace(/[·・.,]/g, '').toLowerCase()

console.log(`원문 설비 점검표 ${heads.length}개 · DB 항목 ${dbItems.length}개\n`)

// 엑셀 전용 12건이 붙은 설비만 본다
const TARGETS = [
  { no: 2, codes: ['2-H-018', '2-H-019', '2-H-021', '2-H-031'] },
  { no: 3, codes: ['3-K-022', '3-K-023', '3-K-031', '3-K-041', '3-L-001', '3-L-002'] },
  { no: 13, codes: ['13-G-031', '13-G-041'] },
]

for (const t of TARGETS) {
  const sec = sectionOf(t.no)
  if (!sec) { console.log(`## 설비 ${t.no} — 원문 구간을 못 찾음\n`); continue }
  const formItems = itemsOf(sec)
  const dbOfSheet = dbItems.filter(d => d.item_code.startsWith(`${t.no}-`))
  const dbNorm = new Set(dbOfSheet.map(d => norm(d.item_name)))
  const missing = formItems.filter(f => !dbNorm.has(norm(f)))

  console.log(`## ${t.no}. ${sec.name} — 원문 항목 ${formItems.length} / DB ${dbOfSheet.length} / 엑셀 전용 코드 ${t.codes.length}`)
  console.log(`   원문에는 있고 DB에 없는 문장: ${missing.length}건`)
  for (const m of missing) console.log(`   - ${m}`)
  console.log()
}
