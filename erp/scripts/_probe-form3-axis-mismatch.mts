/** 별지 9호 3쪽 1절 — 설치(√) 축과 점검결과(○/×) 축의 어긋남 실측. 읽기 전용(DB 무변경).
 *
 *  증상(2026-08-20 사용자):
 *    ① [√]인데 점검결과 공란 — 물분무소화설비
 *    ② [ ]인데 ○        — 할로겐화합물 및 불활성기체 소화설비 · 화재알림설비
 *
 *  ②는 '설치 안 한 설비를 점검해 양호'라 서식상 성립하지 않는 조합이다. 원인은 두 갈래고,
 *  처방이 정반대라 **섞어서 세면 안 된다**:
 *    (a) 시트 귀속 과잉 — 한 시트가 FORM3 여러 항목을 덮는데 응답이 전부로 번졌다 → ／가 정답
 *    (b) 대장 누락    — 그 항목을 겨눈 응답이 실제로 있다 → 결과를 지우면 실점검이 사라진다
 *  2026-08-21 `rollUpForm3Results`의 귀속 규칙이 (a)만 막는다. 이 프로브가 그 경계를 상시 계량한다.
 *
 *  실행: npx tsx scripts/_probe-form3-axis-mismatch.mts */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { rollUpForm3Results, legacySheetOnlyStats, form3ItemsForSheet, form3ItemMatchesFacility } from '../src/lib/sheet-facility-map.ts'
import r9mod from '../src/lib/doc-templates/report9.ts'

const { FORM3_ITEMS } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')

/** 2026-08-21 이전 규칙 — 시트 응답을 덮는 항목 **전부**에 전개(설치 여부 무시). 전후 비교 기준선. */
function rollUpLegacy(
  sheetStat: Array<[string, { any: boolean; x: boolean }]>,
  form3Items: string[],
  installedCodes: string[],
) {
  const facilityChecks = form3Items.filter(it => installedCodes.some(c => form3ItemMatchesFacility(it, c)))
  const statByItem = new Map<string, { any: boolean; x: boolean }>()
  for (const [sheetName, st] of sheetStat) {
    for (const it of form3ItemsForSheet(sheetName, form3Items)) {
      const cur = statByItem.get(it) ?? { any: false, x: false }
      statByItem.set(it, { any: cur.any || st.any, x: cur.x || st.x })
    }
  }
  const resultMarks: Record<string, 'O' | 'X' | 'N'> = {}
  for (const it of form3Items) {
    const st = statByItem.get(it)
    if (st?.any) resultMarks[it] = st.x ? 'X' : 'O'
    else if (!facilityChecks.includes(it)) resultMarks[it] = 'N'
  }
  return { facilityChecks, resultMarks }
}

for (const line of readFileSync(path.join(import.meta.dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// ── 1. 한 시트가 여러 FORM3 항목을 덮는 구조 (번짐의 전제) ──
console.log('=== A. 시트 → FORM3 귀속 (다대일 매핑 = 번짐이 생길 수 있는 자리)')
const { data: sheetRows } = await admin.from('inspection_sheets').select('sheet_code, sheet_name')
const sheets = (sheetRows ?? []) as Array<{ sheet_code: string; sheet_name: string }>
let multi = 0
for (const s of sheets) {
  const items = form3ItemsForSheet(s.sheet_name, FORM3_ITEMS)
  if (items.length > 1) { multi++; console.log(`  · '${s.sheet_name}' → ${items.length}항목 [${items.join(', ')}]`) }
}
console.log(`  2개 이상 항목을 덮는 시트: ${multi}건 — 여기서만 번짐이 생긴다`)

// ── 2. 실 점검 건에서 두 축 어긋남 계량 (전후 비교) ──
console.log('\n=== B. 점검별 축 어긋남 — 종전 규칙 vs 현행 규칙')
// status 필터를 걸었다가 0건이 나왔다 — 응답이 있는 건은 진행 중일 수도 있어 **전 점검**을 본다.
// (0건을 '어긋남 없음'으로 읽으면 조용한 거짓 안심이 된다)
const { data: insps } = await admin.from('inspections').select('id, customer_id, year')
const rows = (insps ?? []) as Array<{ id: string; customer_id: string; year: number }>

// item_code → 시트명 (중첩 조인이 비어 나와서 두 번에 나눠 읽는다)
const { data: itemRows } = await admin.from('inspection_sheet_items').select('item_code, sheet_id')
const { data: shRows } = await admin.from('inspection_sheets').select('id, sheet_name')
const sheetNameById = new Map(((shRows ?? []) as Array<{ id: string; sheet_name: string }>).map(s => [s.id, s.sheet_name]))
const sheetOfItem = new Map<string, string>()
for (const it of ((itemRows ?? []) as Array<{ item_code: string; sheet_id: string }>)) {
  const nm = sheetNameById.get(it.sheet_id)
  if (nm) sheetOfItem.set(it.item_code, nm)
}
console.log(`  (item_code→시트 ${sheetOfItem.size}개 · 점검 ${rows.length}건)`)
const { data: custs } = await admin.from('customers').select('id, customer_name')
const nameOf = new Map(((custs ?? []) as Array<{ id: string; customer_name: string }>).map(c => [c.id, c.customer_name]))

let blank = 0, legacyMarked = 0, nowSuppressed = 0, nowKept = 0, seen = 0, changedCases = 0, naFixed = 0
const detail: string[] = []
for (const i of rows) {
  const [{ data: resp }, { data: blds }] = await Promise.all([
    admin.from('inspection_sheet_responses').select('item_code, result').eq('inspection_id', i.id),
    admin.from('buildings').select('id').eq('customer_id', i.customer_id).eq('is_active', true),
  ])
  const rs = (resp ?? []) as Array<{ item_code: string; result: string }>
  if (rs.length === 0) continue
  seen++
  const stat = new Map<string, { any: boolean; x: boolean; o: boolean }>()
  for (const r of rs) {
    const nm = sheetOfItem.get(r.item_code)
    if (!nm) continue
    const cur = stat.get(nm) ?? { any: false, x: false, o: false }
    stat.set(nm, { any: true, x: cur.x || r.result === 'X', o: cur.o || r.result === 'O' })
  }
  const bIds = ((blds ?? []) as Array<{ id: string }>).map(b => b.id)
  const { data: facs } = bIds.length
    ? await admin.from('fire_facilities').select('facility_code').in('building_id', bIds).eq('installed', true)
    : { data: [] }
  const installed = ((facs ?? []) as Array<{ facility_code: string }>).map(f => f.facility_code)

  const pairs = [...stat] as Array<[string, { any: boolean; x: boolean }]>
  const before = rollUpLegacy(pairs, FORM3_ITEMS, installed)
  const { facilityChecks, resultMarks, axisWarnings } = rollUpForm3Results(legacySheetOnlyStats(stat), FORM3_ITEMS, installed)

  const checkedBlank = FORM3_ITEMS.filter(it => facilityChecks.includes(it) && !resultMarks[it])
  const wasMarked = FORM3_ITEMS.filter(it => !facilityChecks.includes(it)
    && (before.resultMarks[it] === 'O' || before.resultMarks[it] === 'X'))
  blank += checkedBlank.length
  legacyMarked += wasMarked.length
  nowSuppressed += axisWarnings.spillSuppressed.length
  nowKept += axisWarnings.respondedNotInstalled.length

  if (checkedBlank.length || wasMarked.length) {
    changedCases++
    detail.push(`  ${nameOf.get(i.customer_id) ?? i.customer_id} ${i.year}`
      + (checkedBlank.length ? `\n    ① [√]인데 공란 ${checkedBlank.length}: ${checkedBlank.join(', ')}` : '')
      + (axisWarnings.spillSuppressed.length
        ? `\n    ②a 번짐 차단(○→／) ${axisWarnings.spillSuppressed.length}: ${axisWarnings.spillSuppressed.join(', ')}` : '')
      + (axisWarnings.respondedNotInstalled.length
        ? `\n    ②b 대장 누락 의심(○ 유지) ${axisWarnings.respondedNotInstalled.length}: ${axisWarnings.respondedNotInstalled.join(', ')}` : ''))
  }
  // 설치 항목의 마크는 규칙 변경으로 달라지면 안 된다 — 단 하나의 예외: 소방계획서_26 S1의
  // '전부 ／ 시트 → ／'는 **의도된 변화**다(종전엔 ○로 둔갑). O→N만 허용하고 그 외는 실점검 유실로 판정.
  for (const it of facilityChecks) {
    if (before.resultMarks[it] === resultMarks[it]) continue
    if (before.resultMarks[it] === 'O' && resultMarks[it] === 'N') {
      naFixed++
      continue
    }
    console.log(`  ❌ 설치 항목의 결과가 바뀌었다: ${nameOf.get(i.customer_id)} ${i.year} ${it} `
      + `${before.resultMarks[it]} → ${resultMarks[it]}`)
    process.exitCode = 1
  }
}
console.log(detail.slice(0, 10).join('\n') || '  (어긋남 없음)')
console.log(`\n응답 있는 점검 ${seen}건 · 어긋남 있는 건 ${changedCases}건`)
console.log(`  ① [√]인데 공란            ${blank}칸  (규약상 정상 — missing 경고로 표면화)`)
console.log(`  ② 종전 [ ]인데 ○/×        ${legacyMarked}칸`)
console.log(`     ├ ②a 번짐 → ／로 정정   ${nowSuppressed}칸  (설치된 형제 시트의 응답이 번지던 것)`)
console.log(`     └ ②b 대장 누락 의심 유지 ${nowKept}칸  (실점검일 수 있어 지우지 않는다)`)
console.log(`  ③ 전부 ／ 시트 정정(○→／)    ${naFixed}칸  (소방계획서_26 S1 — 해당없음이 양호로 둔갑하던 것)`)
