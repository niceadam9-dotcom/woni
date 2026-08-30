/** 독립 판정 B 보조 — month 축(125)이 실제로 코드당 복수 행을 만드는가, 그리고 그때
 *  planDonorInjection의 `total`(=고유 코드 수)이 주석의 '응답 수'와 어긋나는가.
 *  실행: npx tsx --conditions=react-server scripts/_judgeD-B-month.mts  (읽기 전용) */
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'
import { planDonorInjection, donorInjectSummary } from '../src/lib/xlsx-donor-inject'

const { data, error } = await raw.from('inspection_sheet_responses')
  .select('inspection_id, item_code, result, month').gt('month', 0).limit(2000)
if (error) throw new Error(error.message)
const rows = (data ?? []) as Array<{ inspection_id: string; item_code: string; result: 'O' | 'X' | 'N'; month: number }>
console.log(`month>0 응답 ${rows.length}행`)
const byInsp = new Map<string, typeof rows>()
for (const r of rows) (byInsp.get(r.inspection_id) ?? byInsp.set(r.inspection_id, []).get(r.inspection_id)!).push(r)
for (const [insp, rs] of [...byInsp].slice(0, 5)) {
  const uniq = new Set(rs.map(r => r.item_code)).size
  console.log(`  ${insp}: ${rs.length}행 / 고유코드 ${uniq} / 접두 ${[...new Set(rs.map(r => r.item_code.replace(/-\d+$/, '')))].join(',')}`)
}
// 합성 — 같은 코드 12개월치가 들어오면 total은 몇으로 세는가
const twelve = Array.from({ length: 12 }, (_, i) => ({ item_code: 'X-A-001', result: 'O' as const, month: i + 1 }))
const p = planDonorInjection(twelve, new Set<string>())
console.log(`합성: 12행 입력 → total=${p.total} (주석은 '응답 수'라 말한다) · 요약 «${donorInjectSummary(p)}»`)
