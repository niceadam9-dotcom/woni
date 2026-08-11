/** [독립 판정] 공통 서술 라이브러리 — 소방계획서_15 §5 L-C-1~6(인쇄측)·L-D-2(키 검증) 프로브
 *  실행: npx tsx --conditions=react-server scripts/_judge-lib-c.mts
 *  방식: _judge-soban15-body.mts 관례 — 스테이징 DB에 테스트 고객 생성 → sections 시드(값은
 *  _judge-lib-a.mjs가 "실제 pull·자동주입 경로가 DB에 남긴 값"과 동일 상수) → assembleFirePlan(실코드)
 *  → buildFirePlanHtml → 문자열 단언 → 삭제. L-C-5 음성 대조(빈 3.6 행째 제외)도 함께 재현.
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

// ── _judge-lib-a.mjs와 동일 상수 (주입 결과 DB값 ↔ 인쇄 시드값 연결 고리) ──
const SCENARIO_A = '[JUDGE] 판정 시나리오 v1 — 지하 전기실 화재 상정, 초기소화·통보·피난 유도 순차 대응'
const TEAM_BODY: Record<string, string> = {
  command: '[JUDGE] 지휘반 — 상황 전파 및 관계기관 통보 총괄',
  contact: '[JUDGE] 통보연락반 — 119 신고 및 입주사 전파',
  extinguish: '[JUDGE] 초기소화반 — 소화기·옥내소화전 초기 진압',
  evacuate: '[JUDGE] 피난유도반 — 계단 유도 및 집결지 인원 확인',
  rescue: '[JUDGE] 구조구급반 — 부상자 응급조치 후 인계',
  protect: '[JUDGE] 방호안전반 — 위험물 안전조치 및 전기·가스 차단',
  initial: '[JUDGE] 초기대응체계 — 근무자 중심 즉시 대응',
}
const VUL_BODY: Record<string, string> = {
  '노인': '[JUDGE] 노인 — 보조자 동행 부축 이동',
  '어린이': '[JUDGE] 어린이 — 인솔자 지정 대피',
  '영유아': '[JUDGE] 영유아 — 보육교사 인솔, 계단 이용',
  '임산부': '[JUDGE] 임산부 — 보조자 2인 동행',
  '장애인': '[JUDGE] 장애인 — 피난기구 활용 및 업무분담 지정',
  '기타': '[JUDGE] 기타 — 상황별 안내방송 유도',
}
const PROC = '[JUDGE] 피난유도 절차 — 발화층·직상층 우선 대피, 유도원 배치 후 집결지 인원 확인'
const LOG_TEXT = {
  fireworkLog: { work: '[JUDGE] 용접·용단 작업 화기감독', measure: '[JUDGE] 소화기 2대 비치·불티 방지포' },
  constructionLog: { content: '[JUDGE] 소방시설 공사 전 임시조치 계획 수립', note: '[JUDGE] 공사 비고' },
  promoLog: { method: '[JUDGE] 안내방송', content: '[JUDGE] 화재예방 캠페인 방송 실시' },
  recoveryLog: { damage: '[JUDGE] 피해 현황 조사 및 기록', recovery: '[JUDGE] 복구 계획 수립·이행' },
}

let customerId = ''
try {
  // ── L-D-2 (런타임 부분): 화이트리스트 = §2의 8키 정확히 ──
  const { PLAN_TEXT_SECTION_KEYS, PLAN_TEXT_SECTIONS } = await import('../src/lib/plan-text-sections.ts')
  const EXPECT8 = ['training', 'fireworkLog', 'constructionLog', 'promoLog', 'recoveryLog', 'brigadeTeams', 'evacPlan', 'vulnerableMethods']
  check('L-D-2 PLAN_TEXT_SECTION_KEYS = §2의 8개 키 정확히 일치',
    PLAN_TEXT_SECTION_KEYS.size === 8 && EXPECT8.every(k => PLAN_TEXT_SECTION_KEYS.has(k)),
    JSON.stringify([...PLAN_TEXT_SECTION_KEYS]))
  check('L-D-2 8키 전부 정의(pick·merge·injectEmpty) 보유',
    EXPECT8.every(k => typeof PLAN_TEXT_SECTIONS[k]?.pick === 'function' && typeof PLAN_TEXT_SECTIONS[k]?.merge === 'function'
      && typeof PLAN_TEXT_SECTIONS[k]?.injectEmpty === 'function'))

  // ── 셋업: 테스트 고객 + sections 시드 (pull·자동주입 후 DB 상태와 동일 형태) ──
  const { data: anyProf } = await raw.from('profiles').select('id').limit(1).single()
  const { data: cust, error: cErr } = await raw.from('customers').insert({
    created_by: (anyProf as { id: string }).id,
    customer_code: `TEST-JLC-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: '[JUDGE]인쇄검증빌딩', inspection_type: '작동',
    inspection_category: '소방안전관리', inspection_sub_type: '작동',
    address: '경기 양평군 판정로 99', is_active: true,
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  customerId = (cust as { id: string }).id

  const sections = {
    training: {
      headcount: { worker: '7', resident: '2', brigade: '3' }, eduMonths: [3], drillMonths: [9],
      details: [], scenario: SCENARIO_A, scenarioType: '상가형', records: [],
    },
    brigadeTeams: TEAM_BODY,
    evacPlan: { procedure: PROC, routes: [], assembly: '', mapImage: null },
    fireworkLog: [
      { date: '2026-01-05', place: '지하 기계실', work: 'B 기존 용접기록1', supervisor: '홍감독', measure: 'B 기존 조치1' },
      { date: '', place: '', work: LOG_TEXT.fireworkLog.work, supervisor: '', measure: LOG_TEXT.fireworkLog.measure },
    ],
    constructionLog: [{ date: '', facility: '', content: LOG_TEXT.constructionLog.content, company: '', note: LOG_TEXT.constructionLog.note }],
    promoLog: [{ date: '', method: LOG_TEXT.promoLog.method, content: LOG_TEXT.promoLog.content, target: '' }],
    recoveryLog: [{ date: '', damage: LOG_TEXT.recoveryLog.damage, recovery: LOG_TEXT.recoveryLog.recovery, cost: '' }],
    vulnerableMethods: VUL_BODY,
  }
  const { error: sErr } = await raw.from('fire_plan_forms').upsert(
    { customer_id: customerId, sections }, { onConflict: 'customer_id' })
  if (sErr) throw new Error(`서식 시드 실패: ${sErr.message}`)
  console.log('[셋업 완료]')

  const { assembleFirePlan } = await import('../src/lib/fire-plan-generate.ts')
  const { buildFirePlanHtml } = await import('../src/lib/fire-plan-template.ts')
  type AdminArg = Parameters<typeof assembleFirePlan>[0]
  const a = await assembleFirePlan(raw as unknown as AdminArg, customerId, 2026)
  const html = buildFirePlanHtml(a.data, [])

  console.log('\n— L-C-1: scenario → 1.11.3 훈련 시나리오')
  const idx1113 = html.indexOf('1.11.3 훈련 시나리오')
  check('1.11.3 섹션 존재 + 시나리오 원문 인쇄', idx1113 > -1 && html.includes(SCENARIO_A))
  check('시나리오 유형(상가형) 병기', html.slice(idx1113, idx1113 + 600).includes('상가형'))
  check('시나리오 기본예시표(SCENARIO_DEFAULTS 폴백) 미출력 — 실값 우선', !html.slice(idx1113, idx1113 + 900).includes('주택형'))

  console.log('\n— L-C-2: brigadeTeams → 2장 팀별 임무 표')
  for (const [k, v] of Object.entries(TEAM_BODY)) {
    check(`팀(${k}) 임무 원문 인쇄`, html.includes(v))
  }

  console.log('\n— L-C-3: procedure → 3.4 피난유도 절차')
  const idx34 = html.indexOf('피난유도 절차 및 피난경로')
  check('3.4 섹션 존재 + 절차 원문 인쇄(화재 시 행)', idx34 > -1 && html.includes(PROC))

  console.log('\n— L-C-4: 행 템플릿 → 1.12~1.15 기록부 표 (pad 최소행 공존)')
  const seg = (from: string, to: string) => {
    const i = html.indexOf(from); const j = html.indexOf(to)
    return i > -1 && j > i ? html.slice(i, j) : ''
  }
  const seg12 = seg('서식 1.12', '서식 1.13')
  check('1.12 기존 행 + 템플릿 행 함께 인쇄', seg12.includes('B 기존 용접기록1') && seg12.includes(LOG_TEXT.fireworkLog.work) && seg12.includes(LOG_TEXT.fireworkLog.measure))
  check('1.12 pad 공존 — 데이터 2행 < 표 행 수(min 3 패딩)', (seg12.match(/<tr>/g) ?? []).length >= 4)  // 헤더1+데이터2+패딩1
  const seg13 = seg('서식 1.13', '서식 1.14')
  check('1.13 템플릿 행 인쇄(content·note)', seg13.includes(LOG_TEXT.constructionLog.content) && seg13.includes(LOG_TEXT.constructionLog.note))
  const seg14 = seg('서식 1.14', '서식 1.15')
  check('1.14 템플릿 행 인쇄(method·content)', seg14.includes(LOG_TEXT.promoLog.method) && seg14.includes(LOG_TEXT.promoLog.content))
  const seg15 = seg('서식 1.15', '제2장')
  check('1.15 템플릿 행 인쇄(damage·recovery)', seg15.includes(LOG_TEXT.recoveryLog.damage) && seg15.includes(LOG_TEXT.recoveryLog.recovery))

  console.log('\n— L-C-5: 3.6 — 6유형 전 행 인쇄 (자동주입 데이터로 해소, 템플릿 폴백 없음)')
  const idx36 = html.indexOf('피난약자 유형별 피난 방법')
  check('서식 3.6 섹션 인쇄', idx36 > -1)
  const seg36 = html.slice(idx36, html.indexOf('서식 3.7') > -1 ? html.indexOf('서식 3.7') : undefined)
  for (const [t, v] of Object.entries(VUL_BODY)) {
    check(`3.6 유형행(${t}) 인쇄`, seg36.includes(`<td>${t}</td>`) && seg36.includes(v))
  }
  check('3.6 행 수 = 6 (전 유형)', (seg36.match(/<tr><td>/g) ?? []).length === 6, String((seg36.match(/<tr><td>/g) ?? []).length))
  // 음성 대조 — 값이 비면 여전히 행째 제외(폴백 미추가·데이터로 해결 방침 그대로)
  const dataEmpty = { ...a.data, forms: { ...a.data.forms, vulnerableMethods: {} } }
  const htmlEmpty = buildFirePlanHtml(dataEmpty, [])
  check('L-C-5 음성 — 빈 vulnerableMethods면 3.6 섹션 자체 미출력(템플릿 폴백 없음 확인)',
    !htmlEmpty.includes('피난약자 유형별 피난 방법'))
  const dataPartial = { ...a.data, forms: { ...a.data.forms, vulnerableMethods: { '노인': VUL_BODY['노인'] } } }
  const htmlPartial = buildFirePlanHtml(dataPartial, [])
  const idx36p = htmlPartial.indexOf('피난약자 유형별 피난 방법')
  const seg36p = htmlPartial.slice(idx36p, htmlPartial.indexOf('서식 3.7'))
  check('L-C-5 음성 — 1유형만 값이면 1행만(빈 유형 행째 제외 로직 존치)',
    idx36p > -1 && (seg36p.match(/<tr><td>/g) ?? []).length === 1, String((seg36p.match(/<tr><td>/g) ?? []).length))

  console.log('\n— L-C-6 (인쇄측): 화면 표시값(_judge-lib-a.mjs에서 textarea=주입값 확인)과 동일 값이 그대로 인쇄')
  check('2장 인쇄값 = 주입값(TEAM_BODY 7건 전부, 프리셋 아님)', Object.values(TEAM_BODY).every(v => html.includes(v)))
  check('2장 초기대응 개요도 주입값 사용(extinguish)', html.includes(TEAM_BODY.extinguish))
} catch (e) {
  fail++
  console.error('\n❌ 프로브 중단:', (e as Error).message)
} finally {
  if (customerId) {
    await raw.from('plan_text_applied').delete().eq('customer_id', customerId)
    await raw.from('fire_plan_forms').delete().eq('customer_id', customerId)
    await raw.from('activity_logs').delete().eq('entity_id', customerId)
    await raw.from('customers').delete().eq('id', customerId)
    console.log('\n[정리] 테스트 고객 삭제 완료')
  }
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
