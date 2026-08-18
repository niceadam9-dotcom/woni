// 소방계획서_21 R1-12 — 계획서 공통문구 전역 관리 페이지 E2E
// 8섹션 렌더 · 빈 섹션 ○ · 저장 시 version+1 · 이름만 변경 불변 · 동일 내용 재저장 불변 ·
// ⭐ 지정 시 기존 기본 자동 해제 · 불러오기 미리보기에 고객 고유 필드 미혼입 · 복제 시 원본 불변 ·
// 소프트 삭제 후 가져간 고객 입력 보존
// 실행: npx tsx scripts/test-plan-text-library.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = `plan-text-lib-${Date.now().toString(36)}@test.local`
const LIB = `${BASE}/fire-plans/library`
const SEED_PLACE = '지하1층 기계실'     // 고객 고유 필드 — 라이브러리에 실리면 안 된다
const SEED_SCENARIO = 'E2E 표준 훈련 시나리오 본문'

let userId = '', customerId = '', browser: { close: () => Promise<void> } | null = null
const libIds: string[] = []

const seedLib = async (sectionKey: string, title: string, body: unknown, isDefault = false) => {
  const { data, error } = await raw.from('plan_text_library')
    .insert({ section_key: sectionKey, title, body, is_default: isDefault, updated_by: userId })
    .select('id').single()
  if (error) throw new Error(`시드 실패(${title}): ${error.message}`)
  libIds.push(data.id)
  return data.id as string
}
const libRow = async (id: string) => {
  const { data } = await raw.from('plan_text_library')
    .select('title, body, version, is_default, is_active').eq('id', id).maybeSingle()
  return data as { title: string; body: Record<string, unknown>; version: number; is_default: boolean; is_active: boolean } | null
}

try {
  userId = await mkUser({ email: EMAIL, name: '공통문구E2E', employeeId: `E2E-PTL-${Date.now().toString(36)}` })
  customerId = await mkCustomer({ customer_name: '공통문구E2E고객', created_by: userId })

  // 고객 서식 — 훈련 시나리오(서술) + 고객 고유 필드(일시·장소)가 섞인 상태
  await raw.from('fire_plan_forms').upsert({
    customer_id: customerId,
    sections: {
      training: {
        scenario: SEED_SCENARIO, scenarioType: '아파트',
        details: [{ name: '합동훈련', at: '2026-05-01 14:00', place: SEED_PLACE, target: '전 직원', kind: '합동', form: '실습', materials: '교재', plan: '피난 유도 훈련' }],
      },
      brigadeTeams: { command: 'E2E 지휘통제 서술', contact: 'E2E 비상연락 서술' },
    },
    updated_at: new Date().toISOString(), updated_by: userId,
  } as Record<string, unknown>)

  // 라이브러리 시드 — training 2개(하나는 기본), brigadeTeams 1개
  const trainA = await seedLib('training', 'E2E 훈련 A(기본)', { scenario: 'A 시나리오', scenarioType: '', details: [] }, true)
  const trainB = await seedLib('training', 'E2E 훈련 B', { scenario: 'B 시나리오', scenarioType: '', details: [] })
  const teamsId = await seedLib('brigadeTeams', 'E2E 팀별임무', { command: '지휘 서술' })
  check('시드 — 라이브러리 3건', libIds.length === 3)

  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)
  await page.goto(LIB, { waitUntil: 'domcontentloaded' })
  // h1은 SSR이라 즉시 뜬다 — 목록은 클라이언트가 액션으로 받아오므로 섹션이 실제로 그려질 때까지 기다린다
  await page.waitForSelector('#sec-training', { timeout: 60000 })

  // ── 1) 8섹션 렌더 + 빈 섹션 ○ 표시 ──
  const labels = ['1.11 훈련·교육', '1.12 화기취급 감독', '1.13 소방시설 공사·정비', '1.14 화재예방·홍보',
    '1.15 피해 복구', '2장 팀별임무', '3.4 피난유도 절차', '3.6 피난약자 방법']
  let rendered = 0
  for (const t of labels) if (await page.locator(`h2:text-is("${t}")`).count()) rendered += 1
  check('8섹션 전부 렌더', rendered === 8, `${rendered}/8`)
  // training만 기본(⭐)이 있고 나머지 7섹션은 기본이 없다 → 요약 바가 그 수를 알린다
  check('빈 기본문구 경고 — 7개', await page.isVisible('text=기본문구가 없는 섹션'), '요약 바')
  check('섹션 헤더 ○ 표시(기본 없음)', (await page.locator('text=기본문구 없음 — 자동주입 대상 아님').count()) >= 6)

  // ── 2) 본문 저장 → version +1 ──
  const trainSec = page.locator('#sec-training')
  await trainSec.locator('select').selectOption(trainB)
  const before = await libRow(trainB)
  const ta = trainSec.locator('textarea').first()
  await ta.fill('B 시나리오 — E2E 수정')
  await trainSec.locator('button:has-text("이 섹션 저장")').click()
  await trainSec.locator('text=저장됨 (개정 +1)').waitFor({ timeout: 30000 })
  const afterSave = await libRow(trainB)
  check('본문 저장 — version +1', afterSave!.version === before!.version + 1, `${before!.version} → ${afterSave!.version}`)
  check('본문 저장 — 내용 반영', String((afterSave!.body as { scenario?: string }).scenario).includes('E2E 수정'))

  // ── 3) 동일 내용 재저장 불변 — 변경이 없으면 저장 버튼이 잠긴다 ──
  check('변경 없음 — 저장 버튼 비활성', await trainSec.locator('button:has-text("이 섹션 저장")').isDisabled())

  // ── 4) 이름만 변경 → version 불변 ──
  const nameInput = trainSec.locator('input').first()
  await nameInput.fill('E2E 훈련 B(이름변경)')
  await trainSec.locator('button:has-text("이 섹션 저장")').click()
  await trainSec.locator('text=이름 변경됨 (개정 유지)').waitFor({ timeout: 30000 })
  const afterRename = await libRow(trainB)
  check('이름만 변경 — version 불변', afterRename!.version === afterSave!.version, `${afterSave!.version} → ${afterRename!.version}`)
  check('이름만 변경 — 이름 반영', afterRename!.title === 'E2E 훈련 B(이름변경)', afterRename!.title)

  // ── 5) ⭐ 지정 → 기존 기본 자동 해제 ──
  await trainSec.locator('button:has-text("기본으로")').click()
  await trainSec.locator('text=기본문구로 지정').waitFor({ timeout: 30000 })
  const [aRow, bRow] = [await libRow(trainA), await libRow(trainB)]
  check('⭐ 지정 — 새 항목이 기본', bRow!.is_default === true)
  check('⭐ 지정 — 기존 기본 자동 해제', aRow!.is_default === false)
  const { data: defs } = await raw.from('plan_text_library')
    .select('id').eq('section_key', 'training').eq('is_default', true).eq('is_active', true)
  check('⭐ 섹션당 기본 1개 유지', (defs ?? []).length === 1, `${(defs ?? []).length}개`)

  // ── 6) 복제 → 원본 version 불변 ──
  page.once('dialog', d => d.accept('E2E 훈련 B 사본'))
  await trainSec.locator('button:has-text("복제")').click()
  await trainSec.locator('text=복제됨').waitFor({ timeout: 30000 })
  const afterDup = await libRow(trainB)
  check('복제 — 원본 version 불변', afterDup!.version === afterRename!.version, `${afterRename!.version} → ${afterDup!.version}`)
  const { data: copies } = await raw.from('plan_text_library')
    .select('id, version').eq('section_key', 'training').eq('title', 'E2E 훈련 B 사본').eq('is_active', true)
  check('복제 — 사본 생성(version 1)', (copies ?? []).length === 1 && copies![0].version === 1, JSON.stringify(copies))
  for (const c of copies ?? []) libIds.push(c.id)

  // ── 7) [고객에서 불러오기] 미리보기에 고객 고유 필드 미혼입 ──
  await page.locator('button:has-text("고객에서 불러오기")').click()
  await page.waitForSelector('input[placeholder="고객명 2자 이상 입력"]')
  await page.fill('input[placeholder="고객명 2자 이상 입력"]', '공통문구E2E고객')
  await page.locator('button:has-text("공통문구E2E고객")').first().click({ timeout: 30000 })
  await page.waitForSelector('text=서술이 있는 섹션', { timeout: 30000 })
  const dialogText = await page.locator('div.fixed >> text=서술이 있는 섹션').locator('xpath=ancestor::div[contains(@class,"fixed")]').first().innerText()
  check('불러오기 — 서술은 보임', dialogText.includes(SEED_SCENARIO.slice(0, 12)), dialogText.slice(0, 120))
  check('불러오기 — 고객 고유 필드(장소) 미혼입', !dialogText.includes(SEED_PLACE), SEED_PLACE)
  check('불러오기 — 고객 고유 필드(일시) 미혼입', !dialogText.includes('2026-05-01'))
  check('불러오기 — 빈 섹션은 선택 불가 안내', dialogText.includes('이 고객에 서술 없음'))
  await page.locator('div.fixed button:has-text("취소")').first().click()

  // ── 8) 소프트 삭제 후에도 가져간 고객 입력 보존 ──
  const teamsSec = page.locator('#sec-brigadeTeams')
  page.once('dialog', d => d.accept())
  await teamsSec.locator('button:has-text("삭제")').click()
  await teamsSec.locator('text=삭제되었습니다').waitFor({ timeout: 30000 })
  const deleted = await libRow(teamsId)
  check('삭제 — 소프트 삭제(is_active=false)', deleted!.is_active === false)
  const { data: form } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const teams = (form as { sections: Record<string, Record<string, string>> }).sections.brigadeTeams
  check('삭제 — 가져간 고객 입력 보존', teams?.command === 'E2E 지휘통제 서술', JSON.stringify(teams))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  // 시드 정리 — 라이브러리는 하드 삭제(테스트 데이터가 실제 목록에 남으면 안 된다)
  if (libIds.length) await raw.from('plan_text_library').delete().in('id', libIds)
  if (customerId) {
    await raw.from('plan_text_applied').delete().eq('customer_id', customerId)
    await raw.from('fire_plan_forms').delete().eq('customer_id', customerId)
  }
  await cleanupCustomer(customerId)
  await delUser(userId)
  summary()
}
