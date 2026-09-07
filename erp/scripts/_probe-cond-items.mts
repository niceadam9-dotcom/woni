// 조건부 항목 전수 조사 — 「…의 경우」 꼴 항목이 어느 시트에 몇 개인지 (2026-09-07, 자동 ／ 설계 재료)
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'

const { data: sheets } = await raw.from('inspection_sheets').select('id, sheet_code, sheet_name')
const byId = new Map((sheets ?? []).map((s: { id: string; sheet_code: string; sheet_name: string }) => [s.id, s]))

type It = { sheet_id: string; item_code: string; item_name: string; group_code: string | null; group_name: string | null }
// ⚠ 1000행 상한(risk_supabase_1000row_cap) — 페이징 없이 재면 뒤쪽 시트가 통째로 사라진다
const all: It[] = []
for (let from = 0; ; from += 1000) {
  const { data } = await raw.from('inspection_sheet_items')
    .select('sheet_id, item_code, item_name, group_code, group_name').order('item_code').range(from, from + 999)
  const page = (data ?? []) as It[]
  all.push(...page)
  if (page.length < 1000) break
}
console.log(`전체 항목 ${all.length}개 / 시트 ${(sheets ?? []).length}개`)

// 괄호 안에 조건 표현이 든 항목 — '경우'가 핵심 신호
const cond = all.filter(i => /경우/.test(i.item_name))
console.log(`\n=== 「경우」 포함 항목 ${cond.length}개 ===`)
const bySheet = new Map<string, It[]>()
for (const i of cond) {
  const k = byId.get(i.sheet_id)?.sheet_code ?? '?'
  if (!bySheet.has(k)) bySheet.set(k, [])
  bySheet.get(k)!.push(i)
}
for (const [code, list] of [...bySheet.entries()].sort()) {
  const s = (sheets ?? []).find((x: { sheet_code: string }) => x.sheet_code === code)
  console.log(`\n[${code}] ${s?.sheet_name} — ${list.length}건`)
  for (const i of list) console.log(`  ${i.item_code} | ${i.item_name}`)
}

// 괄호 표현 전수(경우 없이도 조건일 수 있다) — 빈도순 상위
console.log('\n=== 괄호 조각 빈도(상위 40) ===')
const freq = new Map<string, number>()
for (const i of all) {
  for (const m of i.item_name.matchAll(/[（(]([^)）]+)[)）]/g)) {
    const t = m[1].trim()
    freq.set(t, (freq.get(t) ?? 0) + 1)
  }
}
for (const [t, n] of [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(`  ${String(n).padStart(3)}  ${t}`)
}
process.exit(0)
