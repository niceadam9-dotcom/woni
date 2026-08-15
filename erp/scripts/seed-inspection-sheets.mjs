// 점검표 표준항목 시딩 (P2-2) — 전체 보고서.xls → inspection_sheets + inspection_sheet_items
// 실행: node scripts/seed-inspection-sheets.mjs           (dry-run — DB 조회만, 마이그레이션 134 대조 단언 포함)
//       node scripts/seed-inspection-sheets.mjs --execute (.env.local DB)
// 설비마다 여러 '면' 시트로 분할 → 항목코드 앞 번호(설비번호)로 그룹핑.
// item_name 앞의 ○/● = 작동공통/종합전용 마커 → comprehensive_only.
//
// 그룹 축(소방계획서_23 S3A — 재발 방지 R-9): 마이그레이션 134가 적재한 group_*/subgroup_* 5컬럼을
// seed도 똑같이 채운다. 이걸 안 하면 seed 재실행 한 방에 134가 통째로 NULL로 원복된다(P-1 재발).
// 원천은 xls 하나로 자급자족(실측 2026-08-14: 중분류 제목 행 132건 = DB 130종 + 32-A·B, 소제목 58건).
//  · 중분류 제목 행 `1-A. 소화기구(…)` — 이름은 제목에서, group_code는 **다음 항목코드의 접두**에서
//    취한다(원천에 접두 오타 이력 — 추출본 988행 '3-C.' 다음이 4-C-001. 제목 접두를 믿지 않는다).
//  · 대괄호 소제목 `[주거용 주방 자동소화장치]` — col1 52건 + col2 6건으로 흩어져 있어 **열 고정 금지**.
//    단독 행이며 다음 항목부터 적용, **면 시트 경계를 넘어 이어진다**(옥2 [감시제어반] → 옥3 2-H-011~).
//    빈 [ ]·[√] 등 비한글은 제외.
import xlsx from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SRC = 'F:/AI/ERP/erp_goal/_doc01/전체 보고서.xls'
const VERSION = 'v2025'
const execute = process.argv.includes('--execute')
const CODE = /^\d{1,2}-[A-Z]-\d{1,3}$/
const TITLE = /^(\d{1,2})\.\s*(.+?)\s*점검표/
const GROUP_TITLE = /^(\d{1,2})-([A-Z])\.\s*(\S.*)$/
const BRACKET = /^\[([^\]]+)\]$/

function normCode(raw) {
  const m = String(raw).replace(/\s/g, '').match(/^(\d{1,2})-([A-Z])-(\d{1,3})$/)
  return m ? `${parseInt(m[1], 10)}-${m[2]}-${m[3].padStart(3, '0')}` : null
}
const cell = (r, c) => String(r[c] ?? '').replace(/\s+/g, ' ').trim()

// xls 제목이 법정 원천과 다른 곳의 축자 보정 — 법정(추출본 :3573 + 고시 XML 교차 diff 0)이 이긴다.
// 마이그레이션 134 ③(추출본 VALUES)이 적재한 DB 값과 seed가 어긋나면 dry-run 대조가 잡는다(2026-08-15 실측 4행).
const GROUP_NAME_FIXES = new Map([
  ['29-D', '증폭기 및 무선중계기'],   // xls '증폭기 및 무선이동중계기' — 법정 서식에 '이동' 없음
])

const wb = xlsx.readFile(SRC)
const facilities = new Map() // num → { num, name, items: [] }

// 그룹 문맥 — 면 시트 경계를 넘어 유지한다 (통계는 dry-run 단언용)
const groupNameByPrefix = new Map()   // '1-A' → '소화기구(…)'
const subSeqByPrefix = new Map()      // '1-B' → 소제목 인스턴스 순번(마지막 발급값)
let pendingGroupName = null           // 제목 행 이름 — 다음 항목코드 접두에 귀속
let curSub = null                     // { name, order } — order는 첫 항목에서 접두 확정 후 발급
let prevPrefix = null
let titleRows = 0, bracketRows = 0

for (const sn of wb.SheetNames) {
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', blankrows: false })
  // 시트 제목에서 설비명 등록
  for (const r of rows) {
    const t = String(r[0] ?? '').trim()
    const tm = t.match(TITLE)
    if (tm) { const n = parseInt(tm[1], 10); if (!facilities.has(n)) facilities.set(n, { num: n, name: tm[2].trim(), items: [] }); break }
  }
  // 항목 + 그룹 축 추출 — 같은 순회에서 문맥(제목·소제목)을 함께 읽는다
  for (const r of rows) {
    const code = normCode(r[0])
    if (!code) {
      // 중분류 제목 행 — col0 (실측 132건 전부 col0)
      const gt = cell(r, 0).match(GROUP_TITLE)
      if (gt) { pendingGroupName = gt[3].trim(); curSub = null; titleRows++; continue }
      // 대괄호 소제목 — col1/col2 (열 고정 금지: col1 52 + col2 6). 항목 없는 단독 행이다
      for (const c of [1, 2]) {
        const bm = cell(r, c).match(BRACKET)
        if (bm && /[가-힣]/.test(bm[1])) { curSub = { name: bm[1].trim(), order: null }; bracketRows++; break }
      }
      continue
    }
    const num = parseInt(code.split('-')[0], 10)
    const prefix = code.replace(/-\d+$/, '')
    // 제목 이름 귀속 — 접두는 제목이 아니라 첫 항목코드에서 (988행류 접두 오타 방어)
    if (pendingGroupName !== null) {
      if (!groupNameByPrefix.has(prefix)) groupNameByPrefix.set(prefix, pendingGroupName)
      pendingGroupName = null
    }
    // 접두가 바뀌었는데 제목 행 없이 넘어온 경우 — 이미 발급된 소제목은 이월 금지(안전망).
    // 발급 전(order=null)이면 새 그룹의 첫 소제목이 접두 전환과 겹친 것이므로 유지한다
    if (prefix !== prevPrefix && curSub && curSub.order !== null) curSub = null
    if (curSub && curSub.order === null) {
      curSub.order = (subSeqByPrefix.get(prefix) ?? 0) + 1
      subSeqByPrefix.set(prefix, curSub.order)
    }
    // 항목명 — 통상 col1, 일부 '3면' 시트(옥3·스4·옥외3 등)는 병합 셀 시프트로 col2에 있다.
    // 종전 seed가 col1만 읽어 12건을 흘렸고 그 공백을 마이그레이션 132가 편입으로 메웠다 — 이제 원천에서 직접 잡는다
    let text = String(r[1] ?? '').replace(/[\r\n]+/g, ' ').trim() || String(r[2] ?? '').replace(/[\r\n]+/g, ' ').trim()
    const comp = text.startsWith('●')
    text = text.replace(/^[○●]\s*/, '').trim()
    if (!text) continue
    if (!facilities.has(num)) facilities.set(num, { num, name: `설비${num}`, items: [] })
    facilities.get(num).items.push({
      code, name: text, comprehensive_only: comp,
      group_code: prefix,
      subgroup_name: curSub?.name ?? null,
      subgroup_order: curSub?.order ?? null,
    })
    prevPrefix = prefix
  }
}

const facList = [...facilities.values()].sort((a, b) => a.num - b.num).filter(f => f.items.length)
const totalItems = facList.reduce((s, f) => s + f.items.length, 0)

// group_name·group_order 확정 — 순서는 설비 안 첫 등장 순 (마이그레이션 134 ③과 동일 규칙)
for (const f of facList) {
  const orderByPrefix = new Map()
  for (const it of f.items) {
    if (!orderByPrefix.has(it.group_code)) orderByPrefix.set(it.group_code, orderByPrefix.size + 1)
    it.group_order = orderByPrefix.get(it.group_code)
    it.group_name = GROUP_NAME_FIXES.get(it.group_code) ?? groupNameByPrefix.get(it.group_code) ?? null
  }
}

console.log(`설비 ${facList.length}종 · 총 항목 ${totalItems}`)
for (const f of facList) {
  const comp = f.items.filter(i => i.comprehensive_only).length
  const subs = new Set(f.items.filter(i => i.subgroup_name).map(i => `${i.group_code}:${i.subgroup_order}`)).size
  console.log(`  ${String(f.num).padStart(2)} ${f.name.slice(0, 28)} — ${f.items.length}항목 (종합전용 ${comp}${subs ? ` · 소제목 ${subs}` : ''})`)
}

// ── 그룹 축 자기 단언 (S3A-3) ──────────────────────────────────
const allItems = facList.flatMap(f => f.items)
const noName = [...new Set(allItems.filter(i => !i.group_name).map(i => i.group_code))]
const subInstances = new Set(allItems.filter(i => i.subgroup_name).map(i => `${i.group_code}:${i.subgroup_order}`)).size
const subItems = allItems.filter(i => i.subgroup_name).length
let fail = 0
const chk = (okCond, msg) => { console.log(`  ${okCond ? '✅' : '❌'} ${msg}`); if (!okCond) fail++ }
console.log(`\n그룹 축 — 제목 행 ${titleRows}건(32-A·B는 항목 없음 — 소방계획서_22 S9-3), 소제목 행 ${bracketRows}건`)
chk(titleRows === 132, `제목 행 132건 (실측 기준) — ${titleRows}`)
chk(bracketRows === 58, `소제목 행 58건 (실측 기준) — ${bracketRows}`)
chk(subInstances === 58, `소제목 인스턴스 58 — ${subInstances}`)
// 210 = 추출본 귀속 206 + 면 경계 연속 4건(2-H-018·019, 3-K-022·023 — 추출본은 면 경계에서
// 소제목 연속을 잃지만 xls·법정 서식은 [감시제어반]이 다음 면으로 이어진다. 134 ⑤ 주석 참조)
chk(subItems === 210, `소제목 귀속 항목 210 — ${subItems}`)
chk(noName.length === 0, `group_name 없는 접두 0 — ${noName.length}${noName.length ? ` (${noName.join(', ')})` : ''}`)

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
// persistSession/autoRefresh 끔 — 백그라운드 타이머가 남으면 Windows node가 process.exit에서 크래시(0xC0000409)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } })

if (!execute) {
  // ── dry-run DB 대조 단언 (S3A-3) — seed 산출값과 DB 현재값(134·135 적용 후)이 어긋난 채
  //    방치되는 것을 막는다. 조회만 하고 어떤 쓰기도 하지 않는다.
  console.log(`\n[dry-run] DB 대조 — ${env.NEXT_PUBLIC_SUPABASE_URL}`)
  const dbRows = []
  let colMissing = false
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('inspection_sheet_items')
      .select('item_code, group_code, group_name, group_order, subgroup_name, subgroup_order')
      .range(from, from + 999)
    if (error) {
      if (error.code === '42703' || /column .* does not exist/.test(error.message)) { colMissing = true; break }
      console.error('  DB 조회 실패:', error.message); process.exit(1)
    }
    dbRows.push(...data)
    if (data.length < 1000) break
  }
  if (colMissing) {
    console.log('  ⚠ group_* 컬럼 없음 — 마이그레이션 134 미적용 DB. 대조 생략(적용 후 다시 dry-run으로 단언할 것)')
  } else {
    const byCode = new Map(allItems.map(i => [i.code, i]))
    const diffs = []
    for (const d of dbRows) {
      const s = byCode.get(d.item_code)
      if (!s) continue   // EXT·MU 등 이 seed 밖의 항목
      for (const k of ['group_code', 'group_name', 'group_order', 'subgroup_name', 'subgroup_order']) {
        const sv = s[k] ?? null, dv = d[k] ?? null
        if (sv !== dv) diffs.push(`${d.item_code}.${k}: seed=${JSON.stringify(sv)} db=${JSON.stringify(dv)}`)
      }
    }
    chk(diffs.length === 0, `seed ↔ DB 그룹 축 diff 0 — ${diffs.length}건`)
    diffs.slice(0, 10).forEach(d => console.log(`     ${d}`))
  }
  console.log(`\n[dry-run] --execute 로 스테이징 반영${fail ? ` — ❌ 단언 실패 ${fail}건` : ''}`)
  process.exit(fail ? 1 : 0)
}

if (fail) { console.error(`❌ 그룹 축 단언 실패 ${fail}건 — 반영 중단`); process.exit(1) }
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
    group_code: it.group_code, group_name: it.group_name, group_order: it.group_order,
    subgroup_name: it.subgroup_name, subgroup_order: it.subgroup_order,
  }))
  const { error: ie } = await admin.from('inspection_sheet_items').insert(items)
  if (ie) { console.error(`항목 실패 ${sheet_code}:`, ie.message); process.exit(1) }
  itemN += items.length
}
console.log(`시딩 완료 — 점검표 ${sheetN}종 / 항목 ${itemN}`)
