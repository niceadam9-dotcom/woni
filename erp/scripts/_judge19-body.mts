/** [독립 판정] 소방계획서_19 B-5 — 본문(소방계획서) 조립 실주행: M-9 · M-13 · M-12
 *  실행: npx tsx --conditions=react-server scripts/_judge19-body.mts
 *  방식: _judge-soban15-body.mts 관례 복제 — 스테이징에 테스트 고객 생성 → assembleFirePlan(실코드)
 *        → buildFirePlanHtml → 단언 → 삭제. 실데이터(company_profile 등) 미변경.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
for (const [k, val] of Object.entries(env)) if (!process.env[k]) process.env[k] = val as string
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

let customerId = '', buildingId = ''
const YEAR = 2026

try {
  const { data: anyProf } = await raw.from('profiles').select('id').limit(1).single()
  const uid = (anyProf as { id: string }).id
  const { data: cust, error: cErr } = await raw.from('customers').insert({
    created_by: uid, customer_code: `TEST-J19-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: 'JUDGE19본문빌딩', inspection_type: '작동',
    inspection_category: '소방안전관리', inspection_sub_type: '작동',
    plan_anchor_date: `${YEAR}-09-10`, address: '경기 양평군 판정로 19', is_active: true,
    fire_station: '양평소방서',
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  customerId = (cust as { id: string }).id
  await raw.from('customer_contacts').insert({ customer_id: customerId, role: '대표', name: '홍대표', phone: '010-1111-2222' })
  const { data: bld, error: bErr } = await raw.from('buildings').insert({
    customer_id: customerId, building_name: '본관', is_active: true, created_by: uid, purpose: '업무시설', total_area: 1234,
  }).select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  buildingId = (bld as { id: string }).id

  const setSections = async (patch: Record<string, unknown>) => {
    const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
    const cur = ((data as { sections?: Record<string, unknown> } | null)?.sections) ?? {}
    const { error } = await raw.from('fire_plan_forms').upsert(
      { customer_id: customerId, sections: { ...cur, ...patch }, updated_at: new Date().toISOString() },
      { onConflict: 'customer_id' })
    if (error) throw new Error(`sections 저장 실패: ${error.message}`)
  }
  // 1.7 선임자(대표와 다른 사람) · 1.10.1 최초점검(종합월 없음) · 1.3 자동 조회 캐시
  await setSections({
    managers: [{ role: '관리자', affiliation: '자체', name: '김선임', selectedAt: `${YEAR}-01-02`, eduAt: '', duty: '총괄' }],
    inspection: { opMonth: `${YEAR}년 9월`, opInspector: '외주', isInitial: true, initialMonth: `${YEAR}년 3월`, compMonth: '', comp2Month: '', compInspector: '외주' },
    routeMeta: { distanceM: 2430, durationMs: 402000 },   // 2.4km · 7분
  })
  // M-13 폴백 경로 — 120(fire_plan_revisions) 행이 없고 fire_plans만 있는 상태
  {
    const { error } = await raw.from('fire_plans').insert({
      customer_id: customerId, year: YEAR, revision: 1, note: null,
      title: `${YEAR}년 소방계획서`, uploaded_by: uid,
    })
    if (error) throw new Error(`fire_plans 시드 실패: ${error.message}`)
  }

  const { assembleFirePlan } = await import('../src/lib/fire-plan-generate.ts')
  const { buildFirePlanHtml } = await import('../src/lib/fire-plan-template.ts')
  type AdminArg = Parameters<typeof assembleFirePlan>[0]
  const run = async () => {
    const a = await assembleFirePlan(raw as unknown as AdminArg, customerId, YEAR)
    return { a, html: buildFirePlanHtml(a.data, []) }
  }

  console.log('\n— B-5a(M-9): 최초점검이 종합점검월 블록에서 분리')
  {
    const { html } = await run()
    check(`종합 판정 공백인데 최초점검 독립 행 출력`, html.includes(`■ 최초점검 — 점검시기: ${YEAR}년 3월`),
      (html.match(/자체점검[\s\S]{0,400}/) ?? [''])[0].replace(/\s+/g, ' ').slice(0, 300))
    check('작동점검 행도 유지', html.includes(`${YEAR}년 9월`))
    await setSections({ inspection: { opMonth: '', opInspector: '외주', isInitial: true, initialMonth: `${YEAR}년 3월`, compMonth: `${YEAR}년 5월`, comp2Month: '', compInspector: '외주' } })
    const withComp = (await run()).html
    check('종합월 있으면 종전대로 병기(중복 행 없음)',
      withComp.includes(`(최초점검: ${YEAR}년 3월)`) && !withComp.includes('■ 최초점검 —'))
    await setSections({ inspection: { opMonth: `${YEAR}년 9월`, opInspector: '외주', isInitial: false, initialMonth: '', compMonth: '', comp2Month: '', compInspector: '외주' } })
    const noInit = (await run()).html
    check('최초점검 아님 → 행 미생성(허위 표기 없음)', !noInit.includes('■ 최초점검 —'))
    await setSections({ inspection: { opMonth: `${YEAR}년 9월`, opInspector: '외주', isInitial: true, initialMonth: `${YEAR}년 3월`, compMonth: '', comp2Month: '', compInspector: '외주' } })
  }

  console.log('\n— B-5b(M-13): 120 행 없을 때 폴백 개정이력 작성자')
  {
    const { a, html } = await run()
    const rev = a.data.revisions ?? []
    check('폴백 경로 작성자 = 소방안전관리자(1.7 선임자 김선임)',
      rev.length > 0 && rev.every(r => r.author === '김선임'), JSON.stringify(rev))
    check('검토·승인은 공란 유지(수기 서명 운용)', rev.every(r => !r.reviewer && !r.approver))
    check('HTML 개정이력 표에 작성자 인쇄', html.includes('김선임'))
    // 120 행이 있으면 그쪽이 단일 원천 — 폴백 미사용
    const { error } = await raw.from('fire_plan_revisions').insert({
      customer_id: customerId, year: YEAR, seq: 1, revised_on: `${YEAR}-02-01`,
      content: '판정용 개정', author_name: '이작성', reviewer_name: '박검토', approver_name: '최승인',
    })
    if (error) console.log('   (120 시드 실패 — 스킵:', error.message, ')')
    else {
      const r2 = (await run()).a.data.revisions ?? []
      check('120 행 존재 시 그 값이 우선(폴백 미적용)',
        r2.length === 1 && r2[0].author === '이작성' && r2[0].reviewer === '박검토', JSON.stringify(r2))
      await raw.from('fire_plan_revisions').delete().eq('customer_id', customerId)
    }
  }

  console.log('\n— B-5d(M-12): 1.3 거리·도착 캐시 폴백 + 자동 채움 표시')
  {
    const { a, html } = await run()
    check('routeMeta(2430m·402000ms) → 2.4km·7분', a.data.stationDistance === '2.4' && a.data.stationEta === '7',
      `${a.data.stationDistance}/${a.data.stationEta}`)
    check('autoFilled에 station 포함', (a.data.autoFilled ?? []).includes('station' as never), JSON.stringify(a.data.autoFilled))
    check('HTML 1.3 값 인쇄 + autofill 표시', /class="autofill">2\.4 km/.test(html) && html.includes('7 분'))
    check('배너에 1.3 라벨', html.includes('소방서 최단거리·도착시간(1.3 자동조회 캐시)'))
    // 서식 1.3 입력이 있으면 그 값 우선 · 자동 채움 표시 없음
    await setSections({ location: { distance: '1.2', eta: '4' } })
    const s = await run()
    check('서식 1.3 입력 우선(1.2km·4분)', s.html.includes('1.2 km') && s.html.includes('4 분'))
    check('입력이 있으면 autoFilled station 제외', !(s.a.data.autoFilled ?? []).includes('station' as never),
      JSON.stringify(s.a.data.autoFilled))
    await setSections({ location: {} })
    // 캐시도 입력도 없으면 종전대로 빈칸(허위 채움 없음)
    await setSections({ routeMeta: null })
    const z = await run()
    check('캐시·입력 모두 없으면 빈칸 유지', z.a.data.stationDistance === '' && z.a.data.stationEta === ''
      && !(z.a.data.autoFilled ?? []).includes('station' as never))
  }
} catch (e) {
  fail++
  console.error('\n❌ 프로브 중단:', e)
} finally {
  if (customerId) {
    await raw.from('fire_plan_revisions').delete().eq('customer_id', customerId)
    await raw.from('fire_plans').delete().eq('customer_id', customerId)
    if (buildingId) await raw.from('fire_facilities').delete().eq('building_id', buildingId)
    await raw.from('buildings').delete().eq('customer_id', customerId)
    await raw.from('fire_plan_forms').delete().eq('customer_id', customerId)
    await raw.from('customer_contacts').delete().eq('customer_id', customerId)
    await raw.from('activity_logs').delete().eq('entity_id', customerId)
    await raw.from('customers').delete().eq('id', customerId)
    const { data: left } = await raw.from('customers').select('id').like('customer_name', 'JUDGE19%')
    console.log(`[정리] 테스트 고객 삭제 — 잔존 ${(left ?? []).length}건`)
  }
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
