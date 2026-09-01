/** D-7 — 1.4 대장 배지(화면)와 별지·갑지(문서)가 **같은 마크**를 내는가, 중분류 축 전환 후에도.
 *  화면은 buildSheetOverviews(withGroups) → 클라이언트 접기, 문서는 응답 원본 → foldSheetGroupStats.
 *  두 경로를 각각 굴려 FORM3 40항목을 전수 대조한다(읽기 전용).
 *  실행: $env:NODE_OPTIONS='--conditions=react-server'; node node_modules/tsx/dist/cli.mjs scripts/_probe-badge-doc-parity.mts
 */
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
}
const { createAdminClient } = await import('../src/lib/supabase/admin.ts')
const { buildSheetOverviews } = await import('../src/lib/sheet-overview.ts')
const { foldSheetGroupStats, rollUpForm3Results } = await import('../src/lib/sheet-facility-map.ts')
const { sheetItemGroupRef, sheetScope } = await import('../src/lib/sheet-scope.ts')
const { FORM3_ITEMS } = await import('../src/lib/doc-templates/report9.ts')
const { resultMark } = await import('../src/lib/doc-templates/base.ts')

let pass = 0, fail = 0
const check = (n: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${n}${ok || !extra ? '' : `\n       ${extra}`}`); ok ? pass++ : fail++
}

const admin = createAdminClient()
// ⚠ PostgREST는 요청당 1,000행에서 **조용히 자른다**. 카탈로그 항목·응답은 그보다 많다 —
//    페이징 없이 읽으면 시트 매핑이 뭉텅이로 비어 '문서 공란'이 되고, 그게 제품 결함처럼 보인다(실측 오탐 8칸).
const all = async (t: string, sel: string) => {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(t).select(sel).range(from, from + 999)
    if (error) throw new Error(`${t}: ${error.message}`)
    out.push(...(data as any[]))
    if ((data as any[]).length < 1000) break
  }
  return out
}
const insps = await all('inspections', 'id, customer_id, assigned_employee_id, plan_type')
const resp = await all('inspection_sheet_responses', 'inspection_id, item_code, result')
const withResp = [...new Set(resp.map((r: any) => r.inspection_id))]
// 자체점검 회차만 — 별지 9호는 isSpecial 전용이고 외관(monthly/event)은 별지 6호로 간다
// (report9-actions.ts:435-441 배타 분할). 외관 회차를 끼우면 '문서 경로'가 **만들어지지도 않는 문서**를
// 계산하게 되어, 화면과 갈라진 것처럼 보인다(실측 오탐 2칸 — 행복마을아파트 monthly 회차).
const targets = insps
  .filter((i: any) => withResp.includes(i.id) && sheetScope(i.plan_type, null).isSpecial)
  .slice(0, 8)
console.log(`대상 회차 ${targets.length}건 (응답 있는 전건)`)
check('대조할 회차가 실제로 있다', targets.length > 0, `${targets.length}건`)

const items = await all('inspection_sheet_items', 'item_code, sheet_id, group_code, group_name, facility_type')
const sheets = await all('inspection_sheets', 'id, sheet_name')
const nameById = new Map(sheets.map((s: any) => [s.id, s.sheet_name]))
const sheetByItem = new Map(items.map((i: any) => [i.item_code, nameById.get(i.sheet_id) ?? '']))
const groupByItem = new Map(items.map((i: any) => [i.item_code, sheetItemGroupRef(i).code]))
check(`카탈로그를 전량 읽었다 (항목 ${items.length}건 · 응답 ${resp.length}건)`,
  items.length > 1000 && resp.length > 0, `items=${items.length} resp=${resp.length}`)

const { overviews } = await buildSheetOverviews(admin, targets.map((t: any) => t.id),
  { id: '00000000-0000-0000-0000-000000000000', role: 'admin' as never }, { withGroups: true })

let groupsSeen = 0, cells = 0, mismatch = 0, mismatchOld = 0
for (const t of targets) {
  const ov = overviews?.[t.id]
  if (!ov) continue
  const { data: blds } = await admin.from('buildings').select('id').eq('customer_id', t.customer_id).limit(1)
  const { data: facs } = await admin.from('fire_facilities')
    .select('facility_code, installed').eq('building_id', blds?.[0]?.id ?? '')
  const codes = ((facs ?? []) as any[]).filter(f => f.installed).map(f => f.facility_code)

  // ① 화면 경로 — plan-form14.tsx가 하는 접기 그대로
  const screen = ov.sheets.filter(s => s.responded > 0).flatMap(s => s.groups
    ? s.groups.filter(g => g.responded > 0).map(g => ({
      sheet: s.sheetName, group: g.groupCode, stat: { any: true, x: g.x > 0, o: g.o > 0 } }))
    : [{ sheet: s.sheetName, group: null, stat: { any: true, x: s.counts.X > 0, o: s.counts.O > 0 } }])
  groupsSeen += ov.sheets.reduce((n, s) => n + (s.groups?.length ?? 0), 0)
  const screenMarks = rollUpForm3Results(screen, FORM3_ITEMS, codes).resultMarks

  // ② 문서 경로 — report9-assemble.ts 그대로
  const rs = resp.filter((r: any) => r.inspection_id === t.id)
  const doc = foldSheetGroupStats(rs.map((r: any) => ({
    sheet: sheetByItem.get(r.item_code) ?? '', group: groupByItem.get(r.item_code) ?? null, result: r.result })))
  const docMarks = rollUpForm3Results(doc, FORM3_ITEMS, codes).resultMarks

  // ⭐ 대조군 — **옛 축(시트 단위)에서도** 두 경로가 갈렸는가. 이 수가 0이 아니면 불일치는
  //    이번 전환 탓이 아니라 원래 있던 것이다(있다면 그대로 보고한다 — 숨기지 않는다).
  const screenOld = ov.sheets.filter(s => s.responded > 0)
    .map(s => ({ sheet: s.sheetName, group: null, stat: { any: true, x: s.counts.X > 0, o: s.counts.O > 0 } }))
  const docOld = foldSheetGroupStats(rs.map((r: any) => ({
    sheet: sheetByItem.get(r.item_code) ?? '', group: null, result: r.result })))
  const sOld = rollUpForm3Results(screenOld, FORM3_ITEMS, codes).resultMarks
  const dOld = rollUpForm3Results(docOld, FORM3_ITEMS, codes).resultMarks
  for (const it of FORM3_ITEMS) if (sOld[it] !== dOld[it]) mismatchOld++

  for (const it of FORM3_ITEMS) {
    cells++
    if (screenMarks[it] !== docMarks[it]) {
      mismatch++
      console.log(`     ✗ ${it}: 화면 "${resultMark(screenMarks[it])}" ≠ 문서 "${resultMark(docMarks[it])}" (${t.id})`)
    }
  }
}
// 분모 먼저 — 0칸을 대조하고 '일치'라 말하면 공허 통과다
check(`중분류가 실제로 실려 온다 (groups ${groupsSeen}개)`, groupsSeen > 20, `groupsSeen=${groupsSeen}`)
check(`대조한 판정칸 ${cells}개`, cells >= 160, `cells=${cells}`)   // 자체점검 4회차 × FORM3 40항목
console.log(`  [대조군] 옛 축(시트 단위)에서의 화면↔문서 불일치: ${mismatchOld}칸`)
check('화면 마크 == 문서 마크 (전수)', mismatch === 0, `불일치 ${mismatch}칸`)
check('이번 전환이 새 불일치를 만들지 않았다', mismatch <= mismatchOld, `현 ${mismatch} vs 옛 ${mismatchOld}`)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
