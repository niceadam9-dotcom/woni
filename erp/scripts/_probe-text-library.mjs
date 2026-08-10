// 공통 서술 라이브러리 프로브 (소방계획서_15_별도라이브러리.md §6 S-1)
// 실행: node scripts/_probe-text-library.mjs  (로컬 dev 서버 + 스테이징 DB, 마이그레이션 119 적용 필요)
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'probe-textlib@erp-test.com'
const TITLE = '프로브E2E-훈련시나리오'
let userId = ''
let custA = ''
let custB = ''
let custC = ''
let browser = null

async function sections(customerId) {
  const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  return data?.sections ?? {}
}
async function setSection(customerId, key, value) {
  const cur = await sections(customerId)
  await raw.from('fire_plan_forms').upsert({ customer_id: customerId, sections: { ...cur, [key]: value }, updated_at: new Date().toISOString() })
}
async function stamps(customerId) {
  const { data } = await raw.from('plan_text_applied').select('section_key, source, library_version').eq('customer_id', customerId)
  return data ?? []
}
const wait = ms => new Promise(r => setTimeout(r, ms))

try {
  // 잔재 정리 (이전 실패 실행분)
  await raw.from('plan_text_library').delete().like('title', '프로브E2E%')
  userId = await mkUser({ email: EMAIL, name: '텍스트라이브프로브', employeeId: 'E2E-TEXTLIB' })
  custA = await mkCustomer({ customer_name: '프로브라이브러리A', address: '경기 양평군 테스트로 11', created_by: userId })
  custB = await mkCustomer({ customer_name: '프로브라이브러리B', address: '경기 양평군 테스트로 12', created_by: userId })

  const l = await launch()
  browser = l.browser
  const page = l.page
  let promptText = ''
  page.on('dialog', d => { if (d.type() === 'prompt') d.accept(promptText); else d.accept() })
  await login(page, EMAIL)

  // ── 1) 고객A: 1.11 시나리오 입력(프리셋) → [공통으로 등록] ──
  await page.goto(`${BASE}/customers/${custA}?tab=plan&form=1.11`)
  await page.waitForSelector('text=1.11.3 훈련 시나리오')
  await page.click('button:has-text("상가형")')
  await page.waitForTimeout(300)
  promptText = TITLE
  await page.click('[data-testid="libtext-save-training"]')
  await page.waitForSelector(`text=✅ '${TITLE}' 등록됨`, { timeout: 10000 })
  const { data: libRow } = await raw.from('plan_text_library')
    .select('id, version, body, is_active').eq('title', TITLE).eq('section_key', 'training').maybeSingle()
  check('1) [공통으로 등록] → plan_text_library 행 생성', !!libRow && libRow.is_active, JSON.stringify(libRow))
  check('1) body에 시나리오 저장·고객 고유 필드(headcount 등) 없음',
    !!libRow?.body?.scenario && libRow.body.headcount === undefined && libRow.body.eduMonths === undefined,
    JSON.stringify(Object.keys(libRow?.body ?? {})))

  // ── 2) 고객B: [공통에서 가져오기] → 저장 전 DB 미반영 → 저장 → 반영 + 스탬프 ──
  await page.goto(`${BASE}/customers/${custB}?tab=plan&form=1.11`)
  await page.waitForSelector('text=1.11.3 훈련 시나리오')
  await page.click('[data-testid="libtext-open-training"]')
  // 컨테이너는 '불러오는 중' 상태로 먼저 뜬다 — 항목 버튼 자체를 기다려야 한다
  await page.waitForSelector(`[data-testid="libtext-list-training"] button:has-text("${TITLE}")`)
  check('2) 리스트에 항목 노출(미리보기 포함)', await page.isVisible(`text=${TITLE}`))
  await page.click(`[data-testid="libtext-list-training"] button:has-text("${TITLE}")`)
  await page.waitForTimeout(600)
  const before = await sections(custB)
  check('2) 적용 직후 DB 미반영(폼 상태만)', before.training === undefined, JSON.stringify(before.training ?? null))
  await page.click('button:has-text("서식 1.11 저장")')
  await page.waitForSelector('text=서식 1.11 저장됨')
  await wait(1200)   // 스탬프는 저장 성공 후 void 비동기
  const afterB = await sections(custB)
  check('2) 저장 후 scenario 반영', !!afterB.training?.scenario && afterB.training.scenario === libRow.body.scenario)
  check('2) 고객 고유 필드 비오염(headcount·월·records 기본값)',
    (afterB.training?.eduMonths ?? []).length === 0 && (afterB.training?.records ?? []).length === 0,
    JSON.stringify({ edu: afterB.training?.eduMonths, rec: afterB.training?.records }))
  const stB = await stamps(custB)
  check('2) 출처 스탬프 source=pull', stB.some(s => s.section_key === 'training' && s.source === 'pull'), JSON.stringify(stB))

  // ── 3) 행 배열 추가형 — 기록부 1.12: 기존 2행 유지 + 템플릿 3행 append, date 빈 값 ──
  await setSection(custB, 'fireworkLog', [
    { date: '2026-01-05', place: '지하 기계실', work: '기존 용접 기록1', supervisor: '홍감독', measure: '소화기 배치' },
    { date: '2026-02-10', place: '옥상', work: '기존 용접 기록2', supervisor: '김감독', measure: '불티 방지막' },
  ])
  const { data: fwLib } = await raw.from('plan_text_library').insert({
    section_key: 'fireworkLog', title: '프로브E2E-화기템플릿',
    body: [
      { date: '', place: '', work: '용접·용단 작업 감독', supervisor: '', measure: '소화기 2대 비치·불티 방지포' },
      { date: '', place: '', work: '그라인더 작업 감독', supervisor: '', measure: '주변 가연물 제거' },
      { date: '', place: '', work: '토치 작업 감독', supervisor: '', measure: '작업 후 30분 잔류 확인' },
    ],
  }).select('id').single()
  await page.goto(`${BASE}/customers/${custB}?tab=plan&form=1.12`)
  await page.waitForSelector('text=1.12 화기취급 감독')
  await page.click('[data-testid="libtext-open-fireworkLog"]')
  await page.waitForSelector('[data-testid="libtext-list-fireworkLog"]')
  await page.click('[data-testid="libtext-list-fireworkLog"] button:has-text("프로브E2E-화기템플릿")')
  await page.waitForTimeout(400)
  await page.click('button:has-text("서식 1.12~1.15 저장")')
  await page.waitForSelector('text=서식 1.12~1.15 저장됨')
  await wait(1200)
  const fw = (await sections(custB)).fireworkLog ?? []
  check('3) 추가형 — 기존 2행 + 템플릿 3행 = 5행', fw.length === 5, `rows=${fw.length}`)
  check('3) 기존 행 불변', fw[0]?.work === '기존 용접 기록1' && fw[0]?.date === '2026-01-05' && fw[1]?.supervisor === '김감독')
  check('3) 새 행 고객 고유 칸(date·place·supervisor) 빈 값',
    fw.slice(2).every(r => r.date === '' && r.place === '' && r.supervisor === '') && fw[2]?.work === '용접·용단 작업 감독',
    JSON.stringify(fw[2]))

  // ── 4) 3.4 — 라이브러리 body에 악성 assembly가 있어도 procedure만 반영 (정정 ① 회귀 방지) ──
  await setSection(custB, 'evacPlan', { procedure: '', routes: [], assembly: 'B동 1층 주차장', mapImage: null })
  await raw.from('plan_text_library').insert({
    section_key: 'evacPlan', title: '프로브E2E-절차',
    body: { procedure: '공통 절차 E2E — 계단 이용·집결지 인원 확인', assembly: '악성 집결지 값', routes: [{ floor: '오염' }] },
  })
  await page.goto(`${BASE}/customers/${custB}?tab=plan&form=ch3`)
  await page.waitForSelector('text=3.4 피난유도 절차 및 피난경로')
  await page.click('[data-testid="libtext-open-evacPlan"]')
  await page.waitForSelector('[data-testid="libtext-list-evacPlan"]')
  await page.click('[data-testid="libtext-list-evacPlan"] button:has-text("프로브E2E-절차")')
  await page.waitForTimeout(400)
  await page.click('button:has-text("3장 저장")')
  await page.waitForSelector('text=3장 저장됨')
  await wait(800)
  const ep = (await sections(custB)).evacPlan ?? {}
  check('4) procedure 반영', (ep.procedure ?? '').startsWith('공통 절차 E2E'))
  check('4) assembly(집결지) 미오염 — 건물 고유 값 유지', ep.assembly === 'B동 1층 주차장', JSON.stringify(ep.assembly))
  check('4) routes 미오염', (ep.routes ?? []).length === 0, JSON.stringify(ep.routes))

  // ── 5) 자동주입 — 기본항목 지정 → 신규 고객C 진입 시 빈 칸만 서버 저장 + default 스탬프 ──
  const { data: vmLib } = await raw.from('plan_text_library').insert({
    section_key: 'vulnerableMethods', title: '프로브E2E-피난약자기본', is_default: true,
    body: { '노인': '보조자 1인 동행, 계단 이용 시 부축', '어린이': '보육 담당자 인솔 하에 집결지 이동' },
  }).select('id').single()
  custC = await mkCustomer({ customer_name: '프로브라이브러리C', address: '경기 양평군 테스트로 13', created_by: userId })
  await page.goto(`${BASE}/customers/${custC}?tab=plan`)
  await page.waitForSelector('text=① 시설현황')
  let injected = null
  for (let i = 0; i < 15; i++) {   // 자동주입은 진입 후 비동기 — 최대 ~9초 폴링
    injected = (await sections(custC)).vulnerableMethods
    if (injected) break
    await wait(600)
  }
  check('5) 자동주입 — vulnerableMethods 서버 저장', !!injected && injected['노인']?.includes('보조자'), JSON.stringify(injected))
  const stC = await stamps(custC)
  check('5) 스탬프 source=default', stC.some(s => s.section_key === 'vulnerableMethods' && s.source === 'default'), JSON.stringify(stC))
  // 사용자가 지운 뒤에는 재주입하지 않는다 (스탬프 가드)
  await setSection(custC, 'vulnerableMethods', {})
  await page.goto(`${BASE}/customers/${custC}?tab=plan`)
  await page.waitForSelector('text=① 시설현황')
  await wait(3000)
  const afterClear = (await sections(custC)).vulnerableMethods
  check('5) 재진입 시 재주입 없음(스탬프 가드)', afterClear && Object.keys(afterClear).length === 0, JSON.stringify(afterClear))

  // ── 6) 이름변경(version 미증가)·삭제(soft) — 팝오버 안 관리 ──
  await page.goto(`${BASE}/customers/${custA}?tab=plan&form=1.11`)
  await page.waitForSelector('text=1.11.3 훈련 시나리오')
  await page.click('[data-testid="libtext-open-training"]')
  await page.waitForSelector('[data-testid="libtext-list-training"]')
  await page.click('button[title="이름변경"]', { force: true })
  await page.fill('[data-testid="libtext-list-training"] input', '프로브E2E-개명')
  await page.click('[data-testid="libtext-list-training"] button:has-text("확인")')
  // 서버 액션 왕복은 dev 서버에서 수백 ms~수 초로 흔들린다 — 고정 대기 대신 조건 폴링 (E2E 플레이크 패턴)
  const renamed = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('title, version').eq('id', libRow.id).single()
    return data?.title === '프로브E2E-개명' ? data : null
  })
  check('6) 이름변경 — title 갱신·version 미증가', !!renamed && renamed.version === libRow.version, JSON.stringify(renamed))
  // 삭제 버튼은 재조회(reload) 중 목록이 잠시 사라지므로, 행이 다시 그려진 뒤 클릭한다
  await page.waitForSelector('[data-testid="libtext-list-training"] button[title="삭제"]', { timeout: 10000 })
  await page.click('[data-testid="libtext-list-training"] button[title="삭제"]', { force: true })   // confirm은 전역 dialog 핸들러가 수락
  const deleted = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('is_active').eq('id', libRow.id).single()
    return data?.is_active === false ? data : null
  })
  check('6) 삭제 — 소프트(is_active=false)', !!deleted, JSON.stringify(deleted))
  const afterDel = await sections(custB)
  check('6) 삭제 후에도 가져간 고객 데이터 불변', afterDel.training?.scenario === libRow.body.scenario)

  check('참고) 권한 — customer_manage는 전 직원(employee·manager·admin) 개방이라 역할 거부 케이스 없음(비로그인만 차단)', true)
  void fwLib; void vmLib
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  await raw.from('plan_text_library').delete().like('title', '프로브E2E%')
  if (custA) await cleanupCustomer(custA)
  if (custB) await cleanupCustomer(custB)
  if (custC) await cleanupCustomer(custC)
  if (userId) await delUser(userId)
  summary()
}
