/** [독립 판정] 공통 서술 라이브러리 — 소방계획서_15 §5 L-A-1~8 · L-B-1~5 · L-D-1·3·4 E2E 프로브
 *  실행: node scripts/_judge-lib-a.mjs  (dev 서버 :3000 + 스테이징 DB, 마이그레이션 119)
 *  판정자 작성 — 구현 세션 프로브(_probe-text-library.mjs)와 독립. 테스트 항목은 전부 '[JUDGE]' 접두어.
 *  주의: 기본항목(is_default) 생성 구간은 최소화하고 즉시 해제 — 타 사용자 오염 감지·원복 포함.
 *  고정 대기 금지 — 조건 폴링(pollDb·pollForm) 사용 (소방계획서_17 교훈).
 */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'judge-lib-a@erp-test.com'

// ── 프로브 C(_judge-lib-c.mts)와 공유하는 상수 — "주입 결과 DB값"과 "인쇄 검증 시드값"의 연결 고리 ──
const SCENARIO_A = '[JUDGE] 판정 시나리오 v1 — 지하 전기실 화재 상정, 초기소화·통보·피난 유도 순차 대응'
export const TEAM_BODY = {
  command: '[JUDGE] 지휘반 — 상황 전파 및 관계기관 통보 총괄',
  contact: '[JUDGE] 통보연락반 — 119 신고 및 입주사 전파',
  extinguish: '[JUDGE] 초기소화반 — 소화기·옥내소화전 초기 진압',
  evacuate: '[JUDGE] 피난유도반 — 계단 유도 및 집결지 인원 확인',
  rescue: '[JUDGE] 구조구급반 — 부상자 응급조치 후 인계',
  protect: '[JUDGE] 방호안전반 — 위험물 안전조치 및 전기·가스 차단',
  initial: '[JUDGE] 초기대응체계 — 근무자 중심 즉시 대응',
}
export const VUL_BODY = {
  '노인': '[JUDGE] 노인 — 보조자 동행 부축 이동',
  '어린이': '[JUDGE] 어린이 — 인솔자 지정 대피',
  '영유아': '[JUDGE] 영유아 — 보육교사 인솔, 계단 이용',
  '임산부': '[JUDGE] 임산부 — 보조자 2인 동행',
  '장애인': '[JUDGE] 장애인 — 피난기구 활용 및 업무분담 지정',
  '기타': '[JUDGE] 기타 — 상황별 안내방송 유도',
}

let userId = '', custA = '', custB = '', custD = '', browser = null
const myLibIds = []   // 오염 감지용 — 내 라이브러리 항목 id 전부

async function sections(cid) {
  const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', cid).maybeSingle()
  return data?.sections ?? {}
}
async function setSection(cid, key, value) {
  const cur = await sections(cid)
  const { error } = await raw.from('fire_plan_forms').upsert(
    { customer_id: cid, sections: { ...cur, [key]: value }, updated_at: new Date().toISOString() }, { onConflict: 'customer_id' })
  if (error) throw new Error(`setSection(${key}) 실패: ${error.message}`)
}
async function stamps(cid) {
  const { data } = await raw.from('plan_text_applied').select('section_key, source, library_id, library_version').eq('customer_id', cid)
  return data ?? []
}
async function insLib(row) {
  const { data, error } = await raw.from('plan_text_library').insert(row).select('id, version').single()
  if (error) throw new Error(`라이브러리 시드 실패(${row.title}): ${error.message}`)
  myLibIds.push(data.id)
  return data
}
/** jsonb는 키 순서를 정규화하므로(길이→사전순) 키순서 무관 딥 비교로 대조한다 */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]))
  return v
}
const ss = v => JSON.stringify(sortKeys(v))
/** 폼 값 조건 폴링 (RSC 늦은 커밋 대비 — 고정 대기 금지) */
async function pollUi(fn, ms = 15000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try { const r = await fn(); if (r) return r } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 400))
  }
  return null
}

try {
  // 사전: [JUDGE] 잔재 제거
  await raw.from('plan_text_library').delete().like('title', '%[JUDGE]%')
  userId = await mkUser({ email: EMAIL, name: '판정자A', employeeId: 'JUDGE-LIB' })
  custA = await mkCustomer({ customer_name: '[JUDGE]라이브A', address: '경기 양평군 판정로 1', created_by: userId })
  custB = await mkCustomer({ customer_name: '[JUDGE]라이브B', address: '경기 양평군 판정로 2', created_by: userId })

  // ── 시드: 고객A 1.11(등록 원본 — at·place·headcount가 body에 새는지 검증용) ──
  await setSection(custA, 'training', {
    headcount: { worker: '9', resident: '0', brigade: '4' },
    eduMonths: [4], drillMonths: [10],
    details: [{ name: '[JUDGE] 공통 소방교육', at: '2026-05-01', place: '대회의실', target: '전 직원', kind: '교육', form: '강의', materials: '소화기 실물', plan: '연 2회 정기 교육' }],
    scenario: SCENARIO_A, scenarioType: '상가형',
    records: [{ at: '2025-10-01', kind: '훈련', attendees: '8', content: 'A 실시기록', evaluation: '양호' }],
  })
  // ── 시드: 고객B 1.11(비오염 대조군 — 고유 필드 전부 값 보유) ──
  const B_TRAINING = {
    headcount: { worker: '7', resident: '2', brigade: '3' },
    eduMonths: [3], drillMonths: [9],
    details: [{ name: 'B 기존교육', at: '2026-04-01', place: '강당', target: '전 직원', kind: '교육', form: '강의', materials: '', plan: 'B 기존행' }],
    scenario: '기존 시나리오 — 1층 주방 화재', scenarioType: '주택형',
    records: [{ at: '2025-11-10', kind: '소방훈련', attendees: '10', content: 'B 기존 실시 기록', evaluation: '양호' }],
  }
  await setSection(custB, 'training', B_TRAINING)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(45000)
  let promptText = ''
  page.on('dialog', d => { if (d.type() === 'prompt') d.accept(promptText); else d.accept() })
  await login(page, EMAIL)

  const SCEN_TA = 'textarea[placeholder="유형 프리셋을 불러온 뒤 고객 상황에 맞게 수정하세요."]'

  // ════ L-A-1 (1/2) 등록: 고객A [공통으로 등록] → body에 서술만 (정정② at·place 미저장) ════
  await page.goto(`${BASE}/customers/${custA}?tab=plan&form=1.11`)
  await page.waitForSelector('text=1.11.3 훈련 시나리오')
  await pollUi(async () => (await page.inputValue(SCEN_TA)) === SCENARIO_A)
  promptText = '[JUDGE] 훈련A'
  await page.click('[data-testid="libtext-save-training"]')
  await page.waitForSelector(`text=✅ '[JUDGE] 훈련A' 등록됨`)
  const libT = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('id, version, body').eq('title', '[JUDGE] 훈련A').eq('section_key', 'training').maybeSingle()
    return data
  })
  if (!libT) throw new Error('등록 항목 미생성')
  myLibIds.push(libT.id)
  check('L-A-1 등록 body = scenario·scenarioType·details만 (고유 키 없음)',
    libT.body.scenario === SCENARIO_A && libT.body.scenarioType === '상가형'
    && libT.body.headcount === undefined && libT.body.eduMonths === undefined
    && libT.body.drillMonths === undefined && libT.body.records === undefined,
    JSON.stringify(Object.keys(libT.body)))
  check('L-A-1 정정② — 등록 body.details의 at·place는 빈 값(미저장)',
    libT.body.details?.length === 1 && libT.body.details[0].at === '' && libT.body.details[0].place === ''
    && libT.body.details[0].name === '[JUDGE] 공통 소방교육' && libT.body.details[0].plan === '연 2회 정기 교육',
    JSON.stringify(libT.body.details))

  // ════ L-B-5 인라인 확인 + L-B-2 폼만 + L-B-3 unsaved-nav + L-B-4 스탬프 시점 (고객B 1.11) ════
  await page.goto(`${BASE}/customers/${custB}?tab=plan&form=1.11`)
  await page.waitForSelector('text=1.11.3 훈련 시나리오')
  await pollUi(async () => (await page.inputValue(SCEN_TA)) === B_TRAINING.scenario)
  await page.click('[data-testid="libtext-open-training"]')
  await page.waitForSelector('[data-testid="libtext-list-training"] button:has-text("[JUDGE] 훈련A")')
  await page.click('[data-testid="libtext-list-training"] button:has-text("[JUDGE] 훈련A")')
  // 치환형 + 기존 서술 존재 → 인라인 확인 노출
  await page.waitForSelector('text=기존 서술을 덮어씁니다')
  check('L-B-5 치환형 인라인 확인("기존 서술을 덮어씁니다") 표시', true)
  await page.click('[data-testid="libtext-list-training"] button:has-text("취소")')
  check('L-B-5 취소 → 폼 원값 보존', (await page.inputValue(SCEN_TA)) === B_TRAINING.scenario)
  const dbAfterCancel = (await sections(custB)).training
  check('L-B-5 취소 → DB 원값 보존', dbAfterCancel.scenario === B_TRAINING.scenario)

  // 재선택 → [적용]
  await page.click('[data-testid="libtext-list-training"] button:has-text("[JUDGE] 훈련A")')
  await page.waitForSelector('text=기존 서술을 덮어씁니다')
  await page.click('[data-testid="libtext-list-training"] button:has-text("적용")')
  const uiApplied = await pollUi(async () => (await page.inputValue(SCEN_TA)) === SCENARIO_A)
  check('가져오기 적용 → 폼 반영(시나리오 교체)', !!uiApplied)
  const dbAfterApply = (await sections(custB)).training
  check('L-B-2 적용 직후 DB 미반영(폼 상태만)', ss(dbAfterApply) === ss(B_TRAINING),
    JSON.stringify(dbAfterApply.scenario))
  check('L-B-4 적용만(미저장) 시점 스탬프 0건', (await stamps(custB)).length === 0)

  // L-B-3: dirty 상태 트리 이동 → 확인창
  await page.getByRole('button', { name: /1\.10 자체점검/ }).click()
  await page.waitForSelector('[data-testid="unsaved-nav-discard"]')
  check('L-B-3 적용 후 트리 이동 → 미저장 확인창 표시', true)
  check('L-B-3 [저장하고 이동] 버튼 노출', await page.isVisible('[data-testid="unsaved-nav-save"]'))
  await page.click('[data-testid="unsaved-nav-discard"]')   // 저장하지 않고 이동
  await page.waitForSelector('text=1.10.1 연간 자체점검 계획')
  check('L-B-4 미저장 이탈 → DB·스탬프 여전히 없음',
    ss((await sections(custB)).training) === ss(B_TRAINING) && (await stamps(custB)).length === 0)

  // ════ L-A-1 (2/2) 재적용 → [저장] → 필드 단위 대조 + L-B-4 스탬프 기록 ════
  await page.getByRole('button', { name: /1\.11 훈련·교육/ }).click()
  await page.waitForSelector('text=1.11.3 훈련 시나리오')
  await pollUi(async () => (await page.inputValue(SCEN_TA)) === B_TRAINING.scenario)  // 이탈로 폼 원복 확인
  await page.click('[data-testid="libtext-open-training"]')
  await page.waitForSelector('[data-testid="libtext-list-training"] button:has-text("[JUDGE] 훈련A")')
  await page.click('[data-testid="libtext-list-training"] button:has-text("[JUDGE] 훈련A")')
  await page.waitForSelector('text=기존 서술을 덮어씁니다')
  await page.click('[data-testid="libtext-list-training"] button:has-text("적용")')
  await pollUi(async () => (await page.inputValue(SCEN_TA)) === SCENARIO_A)
  await page.click('button:has-text("서식 1.11 저장")')
  await page.waitForSelector('text=서식 1.11 저장됨')
  const tB = await pollDb(async () => {
    const s = await sections(custB)
    return s.training?.scenario === SCENARIO_A ? s.training : null
  })
  check('L-A-1 저장 후 scenario·scenarioType 치환', !!tB && tB.scenarioType === '상가형')
  check('L-A-1 고유 필드 불변 — headcount·eduMonths·drillMonths·records',
    !!tB && ss(tB.headcount) === ss(B_TRAINING.headcount)
    && ss(tB.eduMonths) === ss(B_TRAINING.eduMonths)
    && ss(tB.drillMonths) === ss(B_TRAINING.drillMonths)
    && ss(tB.records) === ss(B_TRAINING.records),
    JSON.stringify({ h: tB?.headcount, e: tB?.eduMonths, d: tB?.drillMonths, r: tB?.records }))
  check('L-A-1 details append — 기존 1행 원문 보존 + 템플릿 1행 추가(at·place 빈 값)',
    !!tB && tB.details?.length === 2
    && ss(tB.details[0]) === ss(B_TRAINING.details[0])
    && tB.details[1].name === '[JUDGE] 공통 소방교육' && tB.details[1].at === '' && tB.details[1].place === '',
    JSON.stringify(tB?.details))
  const stPull = await pollDb(async () => {
    const st = await stamps(custB)
    return st.find(s => s.section_key === 'training' && s.source === 'pull') ?? null
  })
  check('L-B-4 저장 성공 시점 스탬프 1건 — source=pull·library_version 일치',
    !!stPull && stPull.library_id === libT.id && stPull.library_version === libT.version, JSON.stringify(stPull))

  // ════ L-A-2~5 기록부 4종 — append·비오염 (라이브러리 body에 악성 고유값 포함 → 빈 값 정규화 확인) ════
  const LOGS = {
    fireworkLog: {
      title: '[JUDGE] 화기템플릿', label: '1.12 화기취급 감독',
      exist: [
        { date: '2026-01-05', place: '지하 기계실', work: 'B 기존 용접기록1', supervisor: '홍감독', measure: 'B 기존 조치1' },
        { date: '2026-02-10', place: '옥상', work: 'B 기존 용접기록2', supervisor: '김감독', measure: 'B 기존 조치2' },
      ],
      body: [
        { date: '2099-01-01', place: '악성장소', work: '[JUDGE] 용접·용단 작업 화기감독', supervisor: '악성감독', measure: '[JUDGE] 소화기 2대 비치·불티 방지포' },
        { date: '2099-01-02', place: '악성장소2', work: '[JUDGE] 그라인더 작업 감독', supervisor: '악성감독2', measure: '[JUDGE] 주변 가연물 제거' },
      ],
      textCols: ['work', 'measure'], emptyCols: ['date', 'place', 'supervisor'],
    },
    constructionLog: {
      title: '[JUDGE] 공사템플릿', label: '1.13 소방시설 공사·정비',
      exist: [{ date: '2026-03-01', facility: '유도등', content: 'B 기존 공사기록', company: '기존업체', note: '' }],
      body: [{ date: '2099-02-01', facility: '악성설비', content: '[JUDGE] 소방시설 공사 전 임시조치 계획 수립', company: '악성업체', note: '[JUDGE] 공사 비고' }],
      textCols: ['content', 'note'], emptyCols: ['date', 'facility', 'company'],
    },
    promoLog: {
      title: '[JUDGE] 홍보템플릿', label: '1.14 화재예방·홍보',
      exist: [{ date: '2026-04-01', method: '게시', content: 'B 기존 홍보기록', target: '입주사' }],
      body: [{ date: '2099-03-01', method: '[JUDGE] 안내방송', content: '[JUDGE] 화재예방 캠페인 방송 실시', target: '악성대상' }],
      textCols: ['method', 'content'], emptyCols: ['date', 'target'],
    },
    recoveryLog: {
      title: '[JUDGE] 복구템플릿', label: '1.15 피해 복구',
      exist: [{ date: '2026-05-01', damage: 'B 기존 피해기록', recovery: 'B 기존 복구기록', cost: '100만원' }],
      body: [{ date: '2099-04-01', damage: '[JUDGE] 피해 현황 조사 및 기록', recovery: '[JUDGE] 복구 계획 수립·이행', cost: '악성비용' }],
      textCols: ['damage', 'recovery'], emptyCols: ['date', 'cost'],
    },
  }
  for (const [key, cfg] of Object.entries(LOGS)) {
    await setSection(custB, key, cfg.exist)
    await insLib({ section_key: key, title: cfg.title, body: cfg.body })
  }
  await page.goto(`${BASE}/customers/${custB}?tab=plan&form=1.12`)
  await page.waitForSelector('text=1.12 화기취급 감독')
  for (const [key, cfg] of Object.entries(LOGS)) {
    await page.click(`[data-testid="libtext-open-${key}"]`)
    await page.waitForSelector(`[data-testid="libtext-list-${key}"] button:has-text("${cfg.title}")`)
    await page.click(`[data-testid="libtext-list-${key}"] button:has-text("${cfg.title}")`)
    await pollUi(async () => !(await page.isVisible(`[data-testid="libtext-list-${key}"]`)))  // 적용 시 팝오버 닫힘
  }
  await page.click('button:has-text("서식 1.12~1.15 저장")')
  await page.waitForSelector('text=서식 1.12~1.15 저장됨')
  const sAfterLogs = await pollDb(async () => {
    const s = await sections(custB)
    return (s.fireworkLog?.length === 4) ? s : null
  })
  const ids = { fireworkLog: 'L-A-2', constructionLog: 'L-A-3', promoLog: 'L-A-4', recoveryLog: 'L-A-5' }
  for (const [key, cfg] of Object.entries(LOGS)) {
    const rows = sAfterLogs?.[key] ?? []
    const n = cfg.exist.length, m = cfg.body.length
    const existOk = rows.length === n + m && cfg.exist.every((r, i) => ss(rows[i]) === ss(r))
    const appended = rows.slice(n)
    const emptyOk = appended.every(r => cfg.emptyCols.every(c => r[c] === ''))
    const textOk = appended.every((r, i) => cfg.textCols.every(c => r[c] === String(cfg.body[i][c]).trim()))
    check(`${ids[key]} ${cfg.label} — append(${n}+${m}행)·기존 행 원문 보존`, existOk, JSON.stringify(rows.map(r => r[cfg.textCols[0]])))
    check(`${ids[key]} ${cfg.label} — 추가 행 고유칸(${cfg.emptyCols.join('·')}) 빈 값 정규화 + 서술만 반영`, emptyOk && textOk, JSON.stringify(appended))
  }
  const stLogs = await pollDb(async () => {
    const st = await stamps(custB)
    return Object.keys(LOGS).every(k => st.some(s => s.section_key === k && s.source === 'pull')) ? st : null
  })
  check('L-A-2~5 저장 성공 시 4섹션 스탬프 전부 기록(source=pull)', !!stLogs)

  // ════ L-A-6 2장 brigadeTeams 치환 / brigadeGeneral·편성표 불변 ════
  await setSection(custB, 'brigadeGeneral', { type: 'II' })
  await setSection(custB, 'brigadeTeams', { extinguish: 'B 기존 소화 문구' })
  const BRIG_ROWS = [
    { customer_id: custB, team: '자위소방대장', name: '박대장', duty: '총괄 지휘', phone: '010-1000-2000', sort_order: 0 },
    { customer_id: custB, team: '반원', name: '이반원', duty: '초기 소화', phone: '010-3000-4000', sort_order: 1 },
  ]
  {
    const { error } = await raw.from('fire_brigade_members').insert(BRIG_ROWS)
    if (error) throw new Error(`편성표 시드 실패: ${error.message}`)
  }
  const memBefore = (await raw.from('fire_brigade_members').select('team, name, duty, phone').eq('customer_id', custB).order('sort_order')).data
  await insLib({ section_key: 'brigadeTeams', title: '[JUDGE] 팀임무', body: { ...TEAM_BODY, 악성키: '화이트리스트 밖 키' } })
  await page.goto(`${BASE}/customers/${custB}?tab=plan&form=ch2`)
  await page.waitForSelector('text=팀별 임무 (2.5~2.13)')
  await page.click('[data-testid="libtext-open-brigadeTeams"]')
  await page.waitForSelector('[data-testid="libtext-list-brigadeTeams"] button:has-text("[JUDGE] 팀임무")')
  await page.click('[data-testid="libtext-list-brigadeTeams"] button:has-text("[JUDGE] 팀임무")')
  await page.waitForSelector('text=기존 서술을 덮어씁니다')   // extinguish 기존 입력 → 확인 필요
  await page.click('[data-testid="libtext-list-brigadeTeams"] button:has-text("적용")')
  await pollUi(async () => !(await page.isVisible('[data-testid="libtext-list-brigadeTeams"]')))
  await page.click('button:has-text("2장 저장")')
  await page.waitForSelector('text=2장 저장됨')
  const ch2After = await pollDb(async () => {
    const s = await sections(custB)
    return s.brigadeTeams?.command === TEAM_BODY.command ? s : null
  })
  check('L-A-6 brigadeTeams 7팀 치환(기존 extinguish 덮어씀)',
    !!ch2After && Object.keys(TEAM_BODY).every(k => ch2After.brigadeTeams[k] === TEAM_BODY[k]),
    JSON.stringify(ch2After?.brigadeTeams))
  check('L-A-6 화이트리스트 밖 키(악성키) 미유입', ch2After?.brigadeTeams?.['악성키'] === undefined)
  check('L-A-6 brigadeGeneral.type 불변', ch2After?.brigadeGeneral?.type === 'II', JSON.stringify(ch2After?.brigadeGeneral))
  const memAfter = (await raw.from('fire_brigade_members').select('team, name, duty, phone').eq('customer_id', custB).order('sort_order')).data
  check('L-A-6 2.2 편성표(fire_brigade_members) 불변', JSON.stringify(memBefore) === JSON.stringify(memAfter),
    JSON.stringify(memAfter))

  // ════ L-A-7 3.4 procedure만 / assembly·routes 불변 + L-A-8 3.6 6유형 치환 ════
  const B_EVAC = { procedure: '', routes: [{ floor: '2층', route: 'B 기존 경로', guide: '이유도', equip: '완강기' }], assembly: 'B동 옥외 주차장', mapImage: null }
  await setSection(custB, 'evacPlan', B_EVAC)
  await setSection(custB, 'vulnerableMethods', { '노인': 'B 기존 노인 문구' })
  const PROC = '[JUDGE] 피난유도 절차 — 발화층·직상층 우선 대피, 유도원 배치 후 집결지 인원 확인'
  await insLib({ section_key: 'evacPlan', title: '[JUDGE] 절차', body: { procedure: PROC, assembly: '악성 집결지', routes: [{ floor: '오염' }], mapImage: '악성이미지' } })
  await insLib({ section_key: 'vulnerableMethods', title: '[JUDGE] 피난약자', body: { ...VUL_BODY, 해커: '비허용 유형' } })
  await page.goto(`${BASE}/customers/${custB}?tab=plan&form=ch3`)
  await page.waitForSelector('text=3.4 피난유도 절차 및 피난경로')
  await page.click('[data-testid="libtext-open-evacPlan"]')
  await page.waitForSelector('[data-testid="libtext-list-evacPlan"] button:has-text("[JUDGE] 절차")')
  await page.click('[data-testid="libtext-list-evacPlan"] button:has-text("[JUDGE] 절차")')   // procedure 빈 값 → 확인 없이 즉시 적용
  await pollUi(async () => !(await page.isVisible('[data-testid="libtext-list-evacPlan"]')))
  await page.click('[data-testid="libtext-open-vulnerableMethods"]')
  await page.waitForSelector('[data-testid="libtext-list-vulnerableMethods"] button:has-text("[JUDGE] 피난약자")')
  await page.click('[data-testid="libtext-list-vulnerableMethods"] button:has-text("[JUDGE] 피난약자")')
  await page.waitForSelector('text=기존 서술을 덮어씁니다')   // 노인 기존 입력
  await page.click('[data-testid="libtext-list-vulnerableMethods"] button:has-text("적용")')
  await pollUi(async () => !(await page.isVisible('[data-testid="libtext-list-vulnerableMethods"]')))
  await page.click('button:has-text("3장 저장")')
  await page.waitForSelector('text=3장 저장됨')
  const ch3After = await pollDb(async () => {
    const s = await sections(custB)
    return s.evacPlan?.procedure === PROC ? s : null
  })
  check('L-A-7 procedure만 치환', !!ch3After)
  check('L-A-7 assembly(집결지) 불변 — 악성값 미유입', ch3After?.evacPlan?.assembly === 'B동 옥외 주차장', JSON.stringify(ch3After?.evacPlan?.assembly))
  check('L-A-7 routes·mapImage 불변', ss(ch3After?.evacPlan?.routes) === ss(B_EVAC.routes) && (ch3After?.evacPlan?.mapImage ?? null) === null,
    JSON.stringify(ch3After?.evacPlan))
  check('L-A-8 vulnerableMethods 6유형 전부 치환(기존 노인 덮어씀)',
    Object.entries(VUL_BODY).every(([k, v]) => ch3After?.vulnerableMethods?.[k] === v),
    JSON.stringify(ch3After?.vulnerableMethods))
  check('L-A-8 6유형 밖 키(해커) 미유입', ch3After?.vulnerableMethods?.['해커'] === undefined)
  const stCh3 = await pollDb(async () => {
    const st = await stamps(custB)
    return st.some(s => s.section_key === 'evacPlan' && s.source === 'pull')
      && st.some(s => s.section_key === 'vulnerableMethods' && s.source === 'pull') ? st : null
  })
  check('L-A-7·8 스탬프 2건(source=pull)', !!stCh3)

  // ════ L-B-1 자동주입 — 기본항목 지정(최소 구간) → 일부만 채운 고객D: 채운 필드 불변·빈 필드만 ════
  const vmDefault = await insLib({ section_key: 'vulnerableMethods', title: '[JUDGE] 피난약자 기본', body: VUL_BODY, is_default: true })
  const teamDefault = await insLib({ section_key: 'brigadeTeams', title: '[JUDGE] 팀임무 기본', body: TEAM_BODY, is_default: true })
  custD = await mkCustomer({ customer_name: '[JUDGE]라이브D', address: '경기 양평군 판정로 4', created_by: userId })
  await setSection(custD, 'vulnerableMethods', { '노인': '[JUDGE-D] 기존 노인 문구' })   // 일부만 채움
  await page.goto(`${BASE}/customers/${custD}?tab=plan`)
  await page.waitForSelector('text=① 시설현황')
  const injected = await pollDb(async () => {
    const s = await sections(custD)
    return s.brigadeTeams?.command === TEAM_BODY.command ? s : null
  }, 20000)
  check('L-B-1 자동주입 — 빈 섹션(brigadeTeams) 7키 서버 저장', !!injected
    && Object.keys(TEAM_BODY).every(k => injected.brigadeTeams[k] === TEAM_BODY[k]), JSON.stringify(injected?.brigadeTeams))
  check('L-B-1 자동주입 — 채운 필드(노인) 절대 미덮어씀', injected?.vulnerableMethods?.['노인'] === '[JUDGE-D] 기존 노인 문구',
    JSON.stringify(injected?.vulnerableMethods?.['노인']))
  check('L-B-1 자동주입 — 빈 키(어린이~기타 5종)만 주입',
    ['어린이', '영유아', '임산부', '장애인', '기타'].every(k => injected?.vulnerableMethods?.[k] === VUL_BODY[k]),
    JSON.stringify(injected?.vulnerableMethods))
  const stD = await stamps(custD)
  check('L-B-1 스탬프 source=default 2건(버전 일치)',
    stD.some(s => s.section_key === 'vulnerableMethods' && s.source === 'default' && s.library_id === vmDefault.id && s.library_version === vmDefault.version)
    && stD.some(s => s.section_key === 'brigadeTeams' && s.source === 'default' && s.library_id === teamDefault.id),
    JSON.stringify(stD))

  // 재진입 가드 — 값을 지워도 재주입 없음 (§4-0 1회성)
  await setSection(custD, 'brigadeTeams', {})
  await page.goto(`${BASE}/customers/${custD}?tab=plan`)
  await page.waitForSelector('text=① 시설현황')
  const reinjected = await pollDb(async () => {
    const s = await sections(custD)
    return Object.keys(s.brigadeTeams ?? {}).length > 0 ? s : null
  }, 6000)
  check('L-B-1 재진입 시 재주입 없음(스탬프 가드)', reinjected === null, JSON.stringify(reinjected?.brigadeTeams))
  await setSection(custD, 'brigadeTeams', TEAM_BODY)   // L-C-6 UI 대조를 위해 주입 상태 복원

  // ════ L-C-6 (UI측) 2장 화면 표시값 = 주입값 — 인쇄측은 _judge-lib-c.mts가 동일 상수로 단언 ════
  await page.goto(`${BASE}/customers/${custD}?tab=plan&form=ch2`)
  await page.waitForSelector('text=팀별 임무 (2.5~2.13)')
  const taVals = await pollUi(async () => {
    const vals = await page.$$eval('textarea', els => els.map(el => el.value))
    return Object.values(TEAM_BODY).every(v => vals.includes(v)) ? vals : null
  })
  check('L-C-6 자동주입 후 2장 화면 textarea 7개 = 주입값(빈칸 placeholder 아님)', !!taVals)

  // 기본항목 즉시 해제 — 타 사용자 오염 창 최소화
  await raw.from('plan_text_library').update({ is_default: false }).in('id', [vmDefault.id, teamDefault.id])

  // ════ L-D-1 부분 유니크 uq_plan_text_library_default — 중복 is_default insert 실패 ════
  const d1a = await raw.from('plan_text_library').insert({ section_key: 'training', title: '[JUDGE] 유니크1', body: {}, is_default: true }).select('id').single()
  if (d1a.data) myLibIds.push(d1a.data.id)
  const d1b = await raw.from('plan_text_library').insert({ section_key: 'training', title: '[JUDGE] 유니크2', body: {}, is_default: true }).select('id').single()
  if (d1b.data) myLibIds.push(d1b.data.id)
  check('L-D-1 같은 섹션 활성 기본항목 2건째 insert 실패(23505)',
    !!d1a.data && !d1b.data && d1b.error?.code === '23505', JSON.stringify({ code: d1b.error?.code, msg: d1b.error?.message }))
  const d1c = await raw.from('plan_text_library').insert({ section_key: 'training', title: '[JUDGE] 유니크3', body: {}, is_default: true, is_active: false }).select('id').single()
  if (d1c.data) myLibIds.push(d1c.data.id)
  check('L-D-1 비활성(is_active=false)이면 부분 인덱스 제외 — insert 성공', !!d1c.data, JSON.stringify(d1c.error))
  await raw.from('plan_text_library').delete().like('title', '[JUDGE] 유니크%')

  // ════ L-D-4 rename version 미증가 / body 수정만 +1 ════
  await page.goto(`${BASE}/customers/${custA}?tab=plan&form=1.11`)
  await page.waitForSelector('text=1.11.3 훈련 시나리오')
  await page.click('[data-testid="libtext-open-training"]')
  await page.waitForSelector('[data-testid="libtext-list-training"] button:has-text("[JUDGE] 훈련A")')
  await page.click('[data-testid="libtext-list-training"] button[title="이름변경"]', { force: true })
  await page.fill('[data-testid="libtext-list-training"] input', '[JUDGE] 훈련A개명')
  await page.click('[data-testid="libtext-list-training"] button:has-text("확인")')
  const renamed = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('title, version').eq('id', libT.id).single()
    return data?.title === '[JUDGE] 훈련A개명' ? data : null
  })
  check('L-D-4 rename → title 갱신·version 미증가', !!renamed && renamed.version === libT.version, JSON.stringify(renamed))
  // body 변경 덮어쓰기 — 시나리오를 프리셋으로 교체 후 같은 이름으로 등록(→ 덮어쓰기 confirm 수락)
  await page.click('button:has-text("공장형")')
  await pollUi(async () => (await page.inputValue(SCEN_TA)) !== SCENARIO_A)
  promptText = '[JUDGE] 훈련A개명'
  await page.click('[data-testid="libtext-save-training"]')
  await page.waitForSelector(`text=✅ '[JUDGE] 훈련A개명' 등록됨`)
  const bumped = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('version, updated_at').eq('id', libT.id).single()
    return data?.version === libT.version + 1 ? data : null
  })
  check('L-D-4 body 변경 덮어쓰기 → version +1', !!bumped, JSON.stringify(bumped))
  // 동일 body 재등록 (덮어쓰기는 updated_at을 항상 갱신하므로 그것으로 완료를 폴링)
  // ⚠ 1차 실행 반증: version이 또 +1 됐다(2→3). 원인 추정 — savePlanTextAction:65가
  //   JSON.stringify(cur.body)!==JSON.stringify(body)로 비교하는데 jsonb는 키 순서를 정규화해
  //   내용이 같아도 문자열이 달라진다. 아래 단언은 이 반증을 결정적으로 고정한다(내용 비교는 ss로 동일 확인).
  const bodyBefore = (await raw.from('plan_text_library').select('body').eq('id', libT.id).single()).data?.body
  await page.click('[data-testid="libtext-save-training"]')
  const same = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('version, updated_at, body').eq('id', libT.id).single()
    return data && data.updated_at !== bumped?.updated_at ? data : null
  })
  check('L-D-4 [반증 고정] 동일 body 재등록(내용 동일)에도 version +1 — §3-1 위반 재현',
    !!same && ss(same.body) === ss(bodyBefore) && same.version === libT.version + 2,
    JSON.stringify({ v: same?.version, sameBody: ss(same?.body) === ss(bodyBefore) }))

  // ════ L-D-3 소프트 삭제 후 가져간 고객 데이터 무영향 ════
  await page.click('[data-testid="libtext-open-training"]')
  await page.waitForSelector('[data-testid="libtext-list-training"] button:has-text("[JUDGE] 훈련A개명")')
  await page.click('[data-testid="libtext-list-training"] button[title="삭제"]', { force: true })
  const softDel = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('is_active, is_default').eq('id', libT.id).single()
    return data?.is_active === false ? data : null
  })
  check('L-D-3 삭제 = 소프트(is_active=false)', !!softDel)
  const bFinal = (await sections(custB)).training
  check('L-D-3 삭제 후 가져간 고객B 데이터 불변(scenario 유지)', bFinal?.scenario === SCENARIO_A)
  const stFinal = await stamps(custB)
  check('L-D-3 스탬프도 잔존(library_id SET NULL 아닌 유지 — 소프트 삭제)', stFinal.some(s => s.section_key === 'training' && s.library_id === libT.id))
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 400))
} finally {
  if (browser) await browser.close().catch(() => {})
  // ── 오염 감지: 내 라이브러리 항목이 판정 고객 외 고객에 주입/스탬프됐는지 ──
  if (myLibIds.length) {
    const { data: foreign } = await raw.from('plan_text_applied')
      .select('customer_id, section_key, source').in('library_id', myLibIds)
    const mine = new Set([custA, custB, custD].filter(Boolean))
    const leaked = (foreign ?? []).filter(r => !mine.has(r.customer_id))
    if (leaked.length) {
      console.log(`⚠ 외부 고객 오염 감지 ${leaked.length}건 — 원복 시도:`, JSON.stringify(leaked))
      for (const r of leaked) {
        const s = await sections(r.customer_id)
        const v = s[r.section_key]
        if (v && typeof v === 'object') {
          const bodies = { vulnerableMethods: VUL_BODY, brigadeTeams: TEAM_BODY }
          const myBody = bodies[r.section_key]
          if (myBody) {
            const cleaned = Object.fromEntries(Object.entries(v).filter(([k, val]) => myBody[k] !== val))
            await setSection(r.customer_id, r.section_key, cleaned)
          }
        }
        await raw.from('plan_text_applied').delete().eq('customer_id', r.customer_id).eq('section_key', r.section_key)
      }
    } else {
      console.log('오염 감지: 외부 고객 유출 0건')
    }
  }
  // ── 테스트 데이터 하드 정리 ──
  await raw.from('plan_text_library').delete().like('title', '%[JUDGE]%')
  for (const cid of [custA, custB, custD]) {
    if (!cid) continue
    await raw.from('plan_text_applied').delete().eq('customer_id', cid)
    await raw.from('fire_brigade_members').delete().eq('customer_id', cid)
    await raw.from('fire_plan_forms').delete().eq('customer_id', cid)
    await cleanupCustomer(cid).catch(e => console.error(`고객 정리 실패 ${cid}:`, e.message))
  }
  if (userId) await delUser(userId).catch(() => {})
  summary()
}
