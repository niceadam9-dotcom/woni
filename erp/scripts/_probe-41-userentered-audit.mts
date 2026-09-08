/** 소방계획서_41 실측(읽기 전용·판정용) — userEntered 스탬프의 **정오**를 센다.
 *
 *  41은 「사람이 아무것도 안 적은 그룹은 「결과참조」로 접는다」가 목적이다. 그런데 쓰기 경로
 *  (sheet-actions.ts:721-724 nameOf)가 메모 없는 X행에도 카탈로그 문구·항목명을 defect_name으로
 *  굳히고, 조립(report9-assemble.ts:474)은 「이름≠코드」만 보므로 그 행이 userEntered=true가 된다.
 *  → 실제로 몇 건이 그 경로인지 센다. 분류:
 *    memo      : 메모와 이름이 같다(진짜 사람 입력)
 *    catalog   : 이름 = defect_catalog.description (자동 폴백)
 *    itemname  : 이름 = 점검표 항목명 (자동 폴백 — 질문문이 불량내용으로 찍히는 그 경로)
 *    code      : 이름 = 코드 (구 유물)
 *    manual    : defect_code 없음(수기 등록 폼)
 *    other     : 위 어디에도 안 맞음(사람이 고쳐 쓴 것으로 추정)
 *  실행: npx tsx --conditions=react-server scripts/_probe-41-userentered-audit.mts */
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const { isUserEnteredDefectName } = await import('../src/lib/report9-assemble.ts')
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)
console.log(`DB: ${url}`)

const { data: defs } = await admin.from('inspection_defects')
  .select('id, inspection_id, defect_code, defect_name').limit(2000)
const rows = (defs ?? []) as Array<{ id: string; inspection_id: string; defect_code: string | null; defect_name: string | null }>
console.log(`inspection_defects: ${rows.length}행`)
if (!rows.length) { console.log('표본 0건 — 판정 불가(환경 축)'); process.exit(2) }

const codes = [...new Set(rows.map(r => r.defect_code).filter(Boolean))] as string[]
const { data: cat } = await admin.from('defect_catalog').select('code, description').in('code', codes)
const catMap = new Map(((cat ?? []) as Array<{ code: string; description: string }>).map(c => [c.code, c.description]))

// 점검표 항목명 — getAllSheetItems와 같은 원천을 직접 읽는다(캐시 우회)
const { data: items } = await admin.from('inspection_sheet_items').select('item_code, item_name').limit(5000)
const itemMap = new Map(((items ?? []) as Array<{ item_code: string; item_name: string }>).map(i => [i.item_code, i.item_name]))

// 메모 — 회차별 X 응답
const inspIds = [...new Set(rows.map(r => r.inspection_id))]
const memo = new Map<string, string | null>()
for (let i = 0; i < inspIds.length; i += 50) {
  const { data: resp } = await admin.from('inspection_sheet_responses')
    .select('inspection_id, item_code, memo').in('inspection_id', inspIds.slice(i, i + 50)).eq('result', 'X')
  for (const r of (resp ?? []) as Array<{ inspection_id: string; item_code: string; memo: string | null }>) {
    memo.set(`${r.inspection_id}|${r.item_code}`, r.memo)
  }
}

const tally = new Map<string, number>()
const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1)
const samples: Record<string, string[]> = {}
for (const r of rows) {
  const nm = r.defect_name ?? ''
  let kind: string
  if (!r.defect_code) kind = 'manual'
  else if (nm === r.defect_code) kind = 'code'
  else {
    const m = memo.get(`${r.inspection_id}|${r.defect_code}`)?.trim()
    if (m && m === nm) kind = 'memo'
    else if (catMap.get(r.defect_code) === nm) kind = 'catalog'
    else if (itemMap.get(r.defect_code) === nm) kind = 'itemname'
    else kind = 'other'
  }
  bump(kind)
  // 구 규칙(이름≠코드) vs 신 규칙(isUserEnteredDefectName) — 델타가 곧 「결과참조」로 접히게 된 행 수
  bump(`old=${nm !== '' && nm !== r.defect_code}`)
  bump(`new=${isUserEnteredDefectName(r.defect_name, r.defect_code ?? '', r.defect_code ? itemMap.get(r.defect_code) : undefined)}`)
  ;(samples[kind] ??= []).push(nm.slice(0, 40))
}

console.log('\n[이름의 출처]')
for (const k of ['memo', 'catalog', 'itemname', 'code', 'manual', 'other']) {
  const n = tally.get(k) ?? 0
  if (!n) continue
  console.log(`  ${k.padEnd(9)} ${String(n).padStart(4)}건   예: ${(samples[k] ?? []).slice(0, 2).join(' / ')}`)
}
console.log('\n[userEntered 스탬프 — 구 규칙 vs 신 규칙]')
console.log(`  구(이름≠코드)          true ${tally.get('old=true') ?? 0} / false ${tally.get('old=false') ?? 0}`)
console.log(`  신(항목명·코드만 자동)  true ${tally.get('new=true') ?? 0} / false ${tally.get('new=false') ?? 0}`)
console.log(`  → 「결과참조」로 접히게 된 행: ${(tally.get('old=true') ?? 0) - (tally.get('new=true') ?? 0)}건 (항목명 폴백 ${tally.get('itemname') ?? 0}건)`)
