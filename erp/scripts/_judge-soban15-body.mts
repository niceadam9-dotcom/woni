/** 소방계획서_15 독립 판정 프로브(본문 경로) — M-2·M-3·M-4·M-6·M-10·M-15
 *  실행: npx tsx --conditions=react-server scripts/_judge-soban15-body.mts
 *  방식: _probe-soban15-p1.mts 관례 복제 — 스테이징 DB에 테스트 고객·건물 생성 →
 *        assembleFirePlan(실코드) → buildFirePlanHtml → 단언 → 삭제.
 *  company_profile(실데이터 싱글톤·현재 2행, 해당 필드 전부 null 확인됨)은 임시 값 주입 후 원복.
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

let customerId = ''
let buildingId = ''
type CompanyBackup = { id: string; representative: string | null; business_number: string | null }
let companyBackup: CompanyBackup[] = []

try {
  // ── 셋업 ──
  const { data: anyProf } = await raw.from('profiles').select('id').limit(1).single()
  const { data: cust, error: cErr } = await raw.from('customers').insert({
    created_by: (anyProf as { id: string }).id,
    customer_code: `TEST-J15-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: 'JUDGE-S15-본문빌딩', inspection_type: '작동',
    inspection_category: '소방안전관리', inspection_sub_type: '작동',
    plan_anchor_date: '2026-09-10', address: '경기 양평군 판정로 15', is_active: true,
    rep_role: '소유자', manager_license_grade: '2급', manager_edu_date: '2025-05-20',
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  customerId = (cust as { id: string }).id
  await raw.from('customer_contacts').insert({ customer_id: customerId, role: '대표', name: '홍대표', phone: '010-1111-2222' })

  // M-2·M-10 — 전부 buildings 컬럼(교정 주장 검증 지점)
  const { data: bld, error: bErr } = await raw.from('buildings').insert({
    customer_id: customerId, building_name: '본관', is_active: true,
    created_by: (anyProf as { id: string }).id,
    purpose: '업무시설', total_area: 1234,
    stairs_count: 3, ramp_count: 1, evac_elevator_count: 2,
    elevator_count: 4, emergency_elevator_count: 1,
  }).select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  buildingId = (bld as { id: string }).id

  // M-4 — 설비 대장 항목별 비고
  const { error: fErr } = await raw.from('fire_facilities').insert({
    building_id: buildingId, category: '소화설비', facility_code: '소화기구 및 자동소화장치',
    installed: true, detail: { note: '축압식 분말 10개(판정용)' },
  })
  if (fErr) throw new Error(`시설 생성 실패: ${fErr.message}`)

  // M-15 — brigade·evacPlan·zones 미입력(자동 채움 대상), hazards만 실입력(비폴백 확인)
  const { error: sErr } = await raw.from('fire_plan_forms').upsert({
    customer_id: customerId,
    sections: { hazards: [{ place: '보일러실', loc: '지하1층', risks: ['전기'] }] },
  }, { onConflict: 'customer_id' })
  if (sErr) throw new Error(`서식 저장 실패: ${sErr.message}`)

  // M-6 — company_profile 임시 값(현재 전 행 null 확인) — finally에서 원복
  const { data: comps } = await raw.from('company_profile').select('id, representative, business_number')
  companyBackup = (comps ?? []) as CompanyBackup[]
  for (const c of companyBackup) {
    const { error } = await raw.from('company_profile')
      .update({ representative: '판정임시대표', business_number: '000-00-00000' }).eq('id', c.id)
    if (error) throw new Error(`company_profile 임시 갱신 실패: ${error.message}`)
  }
  console.log('[셋업 완료]')

  const { assembleFirePlan } = await import('../src/lib/fire-plan-generate.ts')
  const { buildFirePlanHtml } = await import('../src/lib/fire-plan-template.ts')
  type AdminArg = Parameters<typeof assembleFirePlan>[0]

  const a = await assembleFirePlan(raw as unknown as AdminArg, customerId, 2026)
  const html = buildFirePlanHtml(a.data, [])

  console.log('\n— M-2: 1.1 계단·경사로 (buildings 원천)')
  check('데이터 stairsCount=3·rampCount=1', a.data.stairsCount === '3' && a.data.rampCount === '1',
    `${a.data.stairsCount}/${a.data.rampCount}`)
  check('HTML 계단 (3개소) 인쇄', html.includes('(3개소)'))
  check('HTML 경사로 1개소 인쇄', html.includes('경사로 1개소'))

  console.log('\n— M-10: 1.1 승강기 3종 체크·대수')
  check('데이터 elevators {4,1,2}', a.data.elevators?.passenger === '4'
    && a.data.elevators?.emergency === '1' && a.data.elevators?.evac === '2', JSON.stringify(a.data.elevators))
  check('HTML ■ 승용(4대)', html.includes('■ 승용</span>(4대)'))
  check('HTML ■ 비상용(1대)', html.includes('■ 비상용</span>(1대)'))
  check('HTML ■ 피난용(2대)', html.includes('■ 피난용</span>(2대)'))

  console.log('\n— M-3: 1.1 대표자 구분·자격구분·강습교육 수료일')
  check('데이터 repRole·managerGrade·managerEduDate', a.data.repRole === '소유자'
    && a.data.managerGrade === '2급' && a.data.managerEduDate === '2025-05-20',
    `${a.data.repRole}/${a.data.managerGrade}/${a.data.managerEduDate}`)
  check('HTML 대표자 [소유자] 병기', html.includes('[소유자]'))
  check('HTML 소방안전관리자 (2급) 병기', html.includes('(2급)'))
  check('HTML 1.7 자동 폴백 행 강습교육 수료일', html.includes('2025-05-20'))

  console.log('\n— M-4: 1.4 항목별 비고')
  check('데이터 facilityNotes 수집', (a.data.facilityNotes ?? []).some(n =>
    n.name === '소화기구 및 자동소화장치' && n.note === '축압식 분말 10개(판정용)'),
    JSON.stringify(a.data.facilityNotes))
  check('HTML ※ 항목별 비고 인쇄', html.includes('※ 항목별 비고') && html.includes('축압식 분말 10개(판정용)'))

  console.log('\n— M-6: 1.8 대행업체 대표자·사업자등록번호')
  check('데이터 companyRep·companyBizNo', a.data.companyRep === '판정임시대표' && a.data.companyBizNo === '000-00-00000',
    `${a.data.companyRep}/${a.data.companyBizNo}`)
  check('HTML 1.8 대표자 행 인쇄', html.includes('대 표 자') && html.includes('판정임시대표'))
  check('HTML 사업자등록번호 인쇄', html.includes('사업자등록번호') && html.includes('000-00-00000'))

  console.log('\n— M-15(Q-1): 조립 autoFilled 산출 + 화면 전용 표시')
  const af = a.data.autoFilled ?? []
  check('autoFilled = brigade·evacRoutes·assembly·evacNote·zones (hazards 제외)',
    af.length === 5 && ['brigade', 'evacRoutes', 'assembly', 'evacNote', 'zones'].every(k => af.includes(k as never))
    && !af.includes('hazards' as never), JSON.stringify(af))
  check('HTML 배너 존재', html.includes('autofill-banner') && html.includes('자동 채움(미입력 폴백)'))
  check('HTML 행 표시 클래스', html.includes('class="autofill"') || html.includes(' autofill"'))
  const mediaIdx = html.indexOf('@media screen')
  check('배너 기본 display:none(인쇄 매체 숨김)', html.includes('.autofill-banner { display: none; }'))
  check('.autofill 스타일은 @media screen 블록 안(PDF 불변)',
    mediaIdx > -1 && html.indexOf('.autofill { background') > mediaIdx)

  console.log('\n— 하위 호환: 개수 0/미입력이면 종전 렌더(허위 표기 없음)')
  await raw.from('buildings').update({
    stairs_count: 0, ramp_count: null, evac_elevator_count: null, elevator_count: null, emergency_elevator_count: 0,
  }).eq('id', buildingId)
  const z = await assembleFirePlan(raw as unknown as AdminArg, customerId, 2026)
  const htmlZ = buildFirePlanHtml(z.data, [])
  check('0·미입력 → 빈 문자열(nz)', z.data.stairsCount === '' && z.data.rampCount === ''
    && z.data.elevators?.passenger === '' && z.data.elevators?.emergency === '' && z.data.elevators?.evac === '')
  check('HTML 경사로·대수 미표기', !htmlZ.includes('경사로') || !htmlZ.includes('개소)'))
  check('HTML 승강기 체크 전부 ☐', htmlZ.includes('☐ 승용</span> <span class="ck">☐ 비상용</span> <span class="ck">☐ 피난용'))
} catch (e) {
  fail++
  console.error('\n❌ 프로브 중단:', (e as Error).message)
} finally {
  for (const c of companyBackup) {
    await raw.from('company_profile')
      .update({ representative: c.representative, business_number: c.business_number }).eq('id', c.id)
  }
  if (companyBackup.length) console.log('\n[원복] company_profile representative·business_number 원래 값 복원')
  if (customerId) {
    if (buildingId) await raw.from('fire_facilities').delete().eq('building_id', buildingId)
    await raw.from('buildings').delete().eq('customer_id', customerId)
    await raw.from('fire_plan_forms').delete().eq('customer_id', customerId)
    await raw.from('customer_contacts').delete().eq('customer_id', customerId)
    await raw.from('activity_logs').delete().eq('entity_id', customerId)
    await raw.from('customers').delete().eq('id', customerId)
    console.log('[정리] 테스트 고객·건물 삭제 완료')
  }
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
