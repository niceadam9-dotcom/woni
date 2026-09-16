/** 실데이터 인쇄 대조 — 서식 1.1과 별지 9호가 **같은 말을 하는가** (2026-09-16)
 *
 *  이번 작업이 고치려던 결함은 화면이 아니라 **인쇄물**에 있었다:
 *    송학떡집·별그리다 — 서식 1.1엔 특별피난계단이 ■인데 별지 9호 2쪽은 공란.
 *  그래서 픽스처가 아니라 **스테이징 실데이터**로 두 산출물을 뽑아 나란히 본다.
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-stairs-print.mts
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: 'F:/AI/ERP-facility/erp/.env.local', quiet: true })

const { assembleFirePlan } = await import('../src/lib/fire-plan-generate.ts')
const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values.ts')
const { assembleReport9 } = await import('../src/lib/report9-assemble.ts')
const { renderReport9 } = await import('../src/lib/doc-templates/report9.ts')

const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: cs, error } = await a.from('customers').select('id, customer_name')
  .in('customer_name', ['송학떡집', '별그리다(추모공원)', '서림사', '지평리56', '강순기 건물_2'])
if (error) throw new Error(`고객 조회 실패: ${error.message}`)

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`    ✅ ${n}${d ? ' — ' + d : ''}`) }
  else { fail++; console.log(`    ❌ ${n}${d ? ' — ' + d : ''}`) }
}
const on = (s: string) => /■/.test(s)

for (const c of (cs ?? []) as Array<{ id: string; customer_name: string }>) {
  console.log(`\n● ${c.customer_name}`)
  // 조립기는 admin 클라이언트를 **인자로** 받는다(server-only 모듈이라 자기가 안 만든다)
  /* ⚠ `assembleFirePlan`은 `{ data, images, assets, missing }`을 돌려준다 — 껍데기를 그대로
   *   넘기면 `d.stairCounts`가 `undefined`라 **전 상자가 조용히 꺼진 채** 초록처럼 보인다.
   *   (실제로 한 번 그렇게 「전원 ☐」를 보고 제품을 의심할 뻔했다 — 프로브가 틀렸었다.) */
  const gen = (await assembleFirePlan(a as never, c.id, 2026)).data
  // 전제: 조립기가 계단 값을 싣고 왔는가. 안 싣고 왔으면 아래 상자 단언은 무의미하다
  if (c.customer_name === '별그리다(추모공원)') {
    check('전제: 조립기가 계단 4종을 싣는다(공허 통과 방지)',
      JSON.stringify(gen.stairCounts) !== undefined && !!gen.stairCounts, JSON.stringify(gen.stairCounts))
  }
  const v = buildFirePlanValues(gen)
  const f11 = {
    special: String(v.get('stair_special') ?? ''), direct: String(v.get('stair_direct') ?? ''),
    escape: String(v.get('stair_escape') ?? ''), outdoor: String(v.get('stair_outdoor') ?? ''),
  }
  console.log(`   서식1.1  특별=${on(f11.special) ? '■' : '☐'} 직통=${on(f11.direct) ? '■' : '☐'} 피난=${on(f11.escape) ? '■' : '☐'} 옥외=${on(f11.outdoor) ? '■' : '☐'}`)

  /* 별지 9호는 **점검 회차**에 매달린 서식이다 — 회차가 없는 고객은 그 축을 못 뽑는다.
   *   ⚠ 그 경우 조용히 초록으로 넘기지 않는다. 「못 쟀다」고 말하고 단언을 건너뛴다. */
  const { data: insp } = await a.from('inspections').select('id').eq('customer_id', c.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!insp) { console.log('   별지9호  (점검 회차 없음 — 이 축은 못 쟀다)'); continue }
  const r9res = await assembleReport9(a as never, c.id, (insp as { id: string }).id)
  const r9 = renderReport9(r9res.data)
  const row = (r9.match(/<th>계단<\/th>[\s\S]*?<\/tr>/) ?? [''])[0].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  console.log(`   별지9호  ${row}`)

  /* 🎯 핵심 단언 — 두 서식이 특별피난계단에 대해 **같은 말**을 하는가.
   *   별지 9호는 `[√]특별피난계단 ( N 개소)` 꼴로 찍는다(개소가 비면 공란). */
  const r9Special = /\[√\][^(]*특별피난계단/.test(row) || /특별피난계단\s*\(\s*\d/.test(row)
  check('서식1.1과 별지9호의 특별피난계단이 일치', on(f11.special) === r9Special,
    `1.1=${on(f11.special)} / 9호=${r9Special}`)

  if (c.customer_name === '송학떡집') {
    check('★ 송학떡집 특별피난계단이 이제 두 서식 모두 켜짐', on(f11.special) && r9Special)
    check("★ 송학떡집 옥외계단은 꺼짐(개소 '0' — 종전엔 ■였다)", !on(f11.outdoor), f11.outdoor)
  }
  if (c.customer_name === '별그리다(추모공원)') {
    check('★ 별그리다 네 상자가 모두 켜짐', on(f11.special) && on(f11.direct) && on(f11.escape) && on(f11.outdoor))
    check('★ 별그리다 별지9호 합계는 2개소(직통1+피난1)', /직통\(또는 피난계단\)\s*\(\s*2/.test(row), row.slice(0, 70))
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 인쇄 대조: ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
