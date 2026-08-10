/** 소방계획서_15 P1 수정 프로브 — M-1·M-7·M-8 (assembleFirePlan + buildFirePlanHtml 직접 검증)
 *  실행: npx tsx --conditions=react-server scripts/_probe-soban15-p1.mts
 *  (server-only 모듈 — 소방계획서_16 노트 N-a 방식. A9-1은 별지9호 실생성이 필요해 코드 근거로만 남기고 독립 검증 대상)
 *
 *  단언:
 *   M-1: 서식 1.2 짧은 라벨('전기','가스누출') 저장 → data.factors 긴 라벨 정규화 + 본문 HTML '■ 전기적 요인'
 *   M-7: training 미입력 → trainingMonth null + 연간계획 ■ 없음(월 입력본과 ■ 수 정확히 2 차이)
 *   M-8: 1.7 선임현황 '김선임' → managerName 1순위 채택, 대표와 다른 사람이라 전화 공란, 대표는 owner 칸 유지
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
const cnt = (s: string, ch: string) => s.split(ch).length - 1

let customerId = ''
try {
  // ── 셋업 — 대표(관계인)와 다른 이름의 1.7 선임자 + 짧은 라벨 hazards + training 미입력 ──
  const { data: anyProf } = await raw.from('profiles').select('id').limit(1).single()
  const { data: cust, error: cErr } = await raw.from('customers').insert({
    created_by: (anyProf as { id: string }).id,
    customer_code: `TEST-S15-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: 'TEST-S15-P1-빌딩', inspection_type: '작동',
    inspection_category: '소방안전관리', inspection_sub_type: '작동',
    plan_anchor_date: '2026-09-10', address: '경기 양평군 프로브로 15', is_active: true,
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  customerId = (cust as { id: string }).id
  await raw.from('customer_contacts').insert({ customer_id: customerId, role: '대표', name: '홍대표', phone: '010-1111-2222' })
  const sectionsBase = {
    hazards: [{ place: '보일러실', loc: '지하1층', risks: ['전기', '가스누출'] }],
    managers: [
      { role: '관리자', affiliation: '자체', name: '김선임', selectedAt: '2026-01-02', eduAt: '', duty: '소방안전관리 업무 총괄' },
      { role: '보조자', affiliation: '자체', name: '박보조', selectedAt: '', eduAt: '', duty: '' },
    ],
  }
  const { error: fErr } = await raw.from('fire_plan_forms').upsert({ customer_id: customerId, sections: sectionsBase }, { onConflict: 'customer_id' })
  if (fErr) throw new Error(`서식 저장 실패: ${fErr.message}`)
  console.log('\n[셋업 완료]')

  const { assembleFirePlan } = await import('../src/lib/fire-plan-generate.ts')
  const { buildFirePlanHtml } = await import('../src/lib/fire-plan-template.ts')
  type AdminArg = Parameters<typeof assembleFirePlan>[0]

  console.log('\n[1] training 미입력 조립')
  const a = await assembleFirePlan(raw as unknown as AdminArg, customerId, 2026)

  // M-1 — 데이터 수준
  const factors = a.data.hazards[0]?.factors ?? []
  check('M-1 짧은 라벨 → 긴 라벨 정규화 (전기→전기적 요인)', factors.includes('전기적 요인'), JSON.stringify(factors))
  check('M-1 가스누출 → 가스누출(폭발)', factors.includes('가스누출(폭발)'), JSON.stringify(factors))
  check('M-1 미체크 라벨 오염 없음 (기계적 요인 없음)', !factors.includes('기계적 요인') && factors.length === 2, JSON.stringify(factors))

  // M-7 — 데이터 수준
  check('M-7 training 미입력 → trainingMonth null (구 11 고정 제거)', a.data.trainingMonth === null, String(a.data.trainingMonth))

  // M-8 — 데이터 수준
  check('M-8 소방안전관리자 = 1.7 선임현황 1순위 (김선임)', a.data.managerName === '김선임', a.data.managerName)
  check('M-8 보조자 행 제외 (박보조 아님)', a.data.managerName !== '박보조')
  check('M-8 대표와 다른 사람 → 전화 공란 (타인 전화 오기재 방지)', a.data.managerPhone === '', a.data.managerPhone)
  check('M-8 선임일 = 1.7 행 selectedAt', a.data.managerSelectedAt === '2026-01-02', a.data.managerSelectedAt)
  check('M-8 관계인 칸은 대표 유지', a.data.ownerName === '홍대표' && a.data.ownerPhone === '010-1111-2222')

  // HTML 수준
  const htmlA = buildFirePlanHtml(a.data, [])
  check('M-1 본문 HTML ■ 전기적 요인', htmlA.includes('■ 전기적 요인'))
  check('M-1 본문 HTML ■ 가스누출(폭발)', htmlA.includes('■ 가스누출(폭발)'))
  check('M-8 본문 HTML 김선임 인쇄', htmlA.includes('김선임'))

  console.log('\n[2] 훈련월 11 입력본과 대조 — 연간계획 ■ 차이 정확히 5 (교육 3행 + 훈련 2행, template 559-563)')
  const { error: f2Err } = await raw.from('fire_plan_forms')
    .upsert({ customer_id: customerId, sections: { ...sectionsBase, training: { drillMonths: [11] } } }, { onConflict: 'customer_id' })
  if (f2Err) throw new Error(`서식 갱신 실패: ${f2Err.message}`)
  const b = await assembleFirePlan(raw as unknown as AdminArg, customerId, 2026)
  check('M-7 훈련월 입력 시 trainingMonth 유지', b.data.trainingMonth === 11, String(b.data.trainingMonth))
  const htmlB = buildFirePlanHtml(b.data, [])
  const dA = cnt(htmlA, '■'), dB = cnt(htmlB, '■')
  // 연간계획 표는 소방교육·피난교육·자위소방대(eduMonths 3행) + 소방훈련·피난훈련(drillMonths 2행)
  check('M-7 미입력본에 연간계획 허위 ■ 없음 (■ 수 차이 = 5행×1월)', dB === dA + 5, `미입력 ${dA} vs 11월 입력 ${dB}`)

  console.log('\n[3] 폴백 경로 보존 — 1.7 미입력 고객은 종전대로 대표 폴백')
  const { error: f3Err } = await raw.from('fire_plan_forms')
    .upsert({ customer_id: customerId, sections: { hazards: sectionsBase.hazards } }, { onConflict: 'customer_id' })
  if (f3Err) throw new Error(`서식 갱신 실패: ${f3Err.message}`)
  const c = await assembleFirePlan(raw as unknown as AdminArg, customerId, 2026)
  check('M-8 1.7 없으면 대표 폴백 (홍대표·전화 유지)', c.data.managerName === '홍대표' && c.data.managerPhone === '010-1111-2222',
    `${c.data.managerName}/${c.data.managerPhone}`)
  const htmlC = buildFirePlanHtml(c.data, [])
  check('M-1 폴백 프리셋(긴 라벨) 경로 불변 — ■ 전기적 요인 (hazards만 실입력)', htmlC.includes('■ 전기적 요인'))
} catch (e) {
  fail++
  console.error('\n❌ 프로브 중단:', (e as Error).message)
} finally {
  if (customerId) {
    await raw.from('fire_plan_forms').delete().eq('customer_id', customerId)
    await raw.from('customer_contacts').delete().eq('customer_id', customerId)
    await raw.from('activity_logs').delete().eq('entity_id', customerId)
    await raw.from('customers').delete().eq('id', customerId)
    console.log('\n[정리] 테스트 고객 삭제 완료')
  }
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
