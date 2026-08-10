/** 개정이력 인쇄 연동 프로브 (소방계획서_17.md §4 A-3)
 *  조립(assembleFirePlan) → 렌더(buildFirePlanHtml)를 직접 태워 개정이력 표를 검증한다 — 브라우저 불필요.
 *  실행: npx tsx --conditions=react-server scripts/_probe-revision-print.mts
 *        (스테이징 DB, 마이그레이션 120 적용 필요 · server-only 모듈이라 react-server 조건 필수 — _h12-snapshot 관례)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import gen from '../src/lib/fire-plan-generate.ts'
import tpl from '../src/lib/fire-plan-template.ts'

const { assembleFirePlan } = gen as unknown as typeof import('../src/lib/fire-plan-generate.ts')
const { buildFirePlanHtml } = tpl as unknown as typeof import('../src/lib/fire-plan-template.ts')

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

let custId = ''
try {
  const { data: anyProfile } = await raw.from('profiles').select('id').limit(1).single()
  const { data: cust, error } = await raw.from('customers').insert({
    customer_code: `TEST-REVP-${Math.random().toString(36).slice(2, 7)}`,
    customer_name: '프로브개정인쇄', address: '경기 양평군 테스트로 31',
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    contract_date: '2026-01-05', is_active: true,
    created_by: (anyProfile as { id: string }).id,
  }).select('id').single()
  if (error) throw new Error(`고객 생성 실패: ${error.message}`)
  custId = (cust as { id: string }).id

  // 두 연도 · 총 3행 — 검토·승인까지 채운 행을 섞는다
  await raw.from('fire_plan_revisions').insert([
    { customer_id: custId, year: 2025, seq: 1, revised_on: '2025-03-02', content: '2025년 소방계획서 작성', author_name: '작성일', source: 'generated' },
    { customer_id: custId, year: 2026, seq: 1, revised_on: '2026-02-10', content: '2026년 소방계획서 작성', author_name: '작성이', reviewer_name: '검토이', approver_name: '승인이', source: 'generated' },
    { customer_id: custId, year: 2026, seq: 2, revised_on: '2026-08-01', content: '설비 교체로 1.4 수정', author_name: '작성삼', source: 'manual' },
  ])

  const { data } = await assembleFirePlan(raw as never, custId, 2026)
  const html = buildFirePlanHtml(data, [])

  const start = html.indexOf('소방계획서 개정이력')
  const table = html.slice(start, html.indexOf('</table>', start))
  const rowsHtml = table.split('<tr>').slice(2)   // [0]=제목 앞, [1]=열 제목 행

  check('A-3a 조립이 fire_plan_revisions를 읽는다 — 3행 + 예약 7행 = 10',
    rowsHtml.length === 10, `실제 ${rowsHtml.length}행`)
  check('A-3d 전 연도 시계열 통합 — 2025가 2026보다 먼저',
    table.indexOf('2025-03-02') < table.indexOf('2026-02-10'), '순서 뒤바뀜')
  check('A-3a 작성자 실값 인쇄 (K-4 해소)',
    table.includes('작성이') && table.includes('작성삼'), '작성자 누락')
  check('A-3b 검토·승인 실값 인쇄 (Q-2)',
    table.includes('검토이') && table.includes('승인이'), '검토·승인 누락')
  check('A-3c 현 작성분 이중 행 없음',
    (table.match(/설비 교체로 1\.4 수정/g) ?? []).length === 1,
    `${(table.match(/설비 교체로 1\.4 수정/g) ?? []).length}회 등장`)

  const seqs = rowsHtml.map(r => { const m = r.match(/<td>(\d+)<\/td>/); return m ? Number(m[1]) : -1 })
  check('K-5 순번 연속 (1..10, 중복·역행 없음)', seqs.every((n, i) => n === i + 1), JSON.stringify(seqs))

  check('표지 작성일 = 최신 개정일(2026-08-01)', data.revisionDate === '2026-08-01', `실제 ${data.revisionDate}`)

  // 폴백 — 이력 행이 0이어도 조립이 실패하지 않는다(백필 전 안전망)
  await raw.from('fire_plan_revisions').delete().eq('customer_id', custId)
  const { data: d2 } = await assembleFirePlan(raw as never, custId, 2026)
  check('A-1 폴백 — 이력 0행이어도 조립 성공', Array.isArray(d2.revisions), JSON.stringify(d2.revisions))
} catch (e) {
  check('예외 없음', false, String(e).slice(0, 400))
} finally {
  if (custId) {
    await raw.from('fire_plan_revisions').delete().eq('customer_id', custId)
    await raw.from('customers').delete().eq('id', custId)
  }
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
