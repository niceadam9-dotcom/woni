// 소방계획서_21 R1-12 — 계획서 공통문구 전역 관리 페이지 E2E
// 8섹션 렌더 · 빈 섹션 ○ · 저장 시 version+1 · 이름만 변경 불변 · 동일 내용 재저장 불변 ·
// ⭐ 지정 시 기존 기본 자동 해제 · 불러오기 미리보기에 고객 고유 필드 미혼입 · 복제 시 원본 불변 ·
// 소프트 삭제 후 가져간 고객 입력 보존
// 실행: npx tsx scripts/test-plan-text-library.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import { PLAN_TEXT_SECTION_KEYS } from '../src/lib/plan-text-sections.ts'

const EMAIL = `plan-text-lib-${Date.now().toString(36)}@test.local`
const LIB = `${BASE}/fire-plans/library`
const SEED_PLACE = '지하1층 기계실'     // 고객 고유 필드 — 라이브러리에 실리면 안 된다
const SEED_SCENARIO = 'E2E 표준 훈련 시나리오 본문'

let userId = '', customerId = '', browser: { close: () => Promise<void> } | null = null
const libIds: string[] = []
/** 이 테스트가 잠시 내려둔 실데이터 ⭐기본 항목 — finally에서 되돌린다 */
let displacedDefaultId: string | null = null

/** 섹션당 활성 ⭐기본은 최대 1개(uq_plan_text_library_default)다. 이 테스트는 자기 항목을 기본으로
 *  심어야 하므로, 실데이터가 이미 그 자리를 쓰고 있으면 잠시 비켜 둔다(정리 단계에서 복원).
 *  종전에는 이 처리가 없어 실데이터에 training 기본문구가 생긴 뒤(2026-08-18) 시드 단계에서
 *  유니크 위반으로 계속 실패했다 — 전역 DB 상태에 의존하던 결함(2026-08-19 정정). */
const releaseExistingDefault = async (sectionKey: string) => {
  const { data } = await raw.from('plan_text_library')
    .select('id').eq('section_key', sectionKey).eq('is_default', true).eq('is_active', true).maybeSingle()
  const id = (data as { id: string } | null)?.id
  if (!id) return
  await raw.from('plan_text_library').update({ is_default: false }).eq('id', id)
  displacedDefaultId = id
}

const seedLib = async (sectionKey: string, title: string, body: unknown, isDefault = false) => {
  const { data, error } = await raw.from('plan_text_library')
    .insert({ section_key: sectionKey, title, body, is_default: isDefault, updated_by: userId })
    .select('id').single()
  if (error) throw new Error(`시드 실패(${title}): ${error.message}`)
  libIds.push(data.id)
  return data.id as string
}
/** 그 순간 **DB가 말하는 참값** — 기본문구(⭐)가 없는 섹션들.
 *
 *  🚨 종전에는 「training만 ⭐이고 나머지 7섹션은 없다」를 **숫자로 박아** 뒀다(`경고 7개`·`○ ≥6`).
 *     그건 2026-08-19의 **전역 DB 스냅샷**이지 계약이 아니다. 2026-09-21 「기본 문구」 8섹션이
 *     등록되자 emptyCount가 0이 되어 두 단언이 통째로 썩었고, 이 스위트가 **test-all 미등록
 *     (고아)**이라 아무도 그 사실을 알려주지 않았다.
 *     (같은 파일이 2026-08-19에도 전역 상태 의존으로 물렸다 — 그때는 유니크 위반 쪽만 고쳤다.)
 *
 *  계약은 「요약 바와 ○ 표시가 **실제로 기본이 없는 섹션 수**를 알린다」이다. 숫자를 박지 않고
 *  DB에 물어 대조한다 — 어떤 전역 상태에서도 뜻이 같다. */
const noDefaultSections = async (): Promise<string[]> => {
  const { data } = await raw.from('plan_text_library')
    .select('section_key').eq('is_default', true).eq('is_active', true)
  const have = new Set((data ?? []).map((r: { section_key: string }) => r.section_key))
  return [...PLAN_TEXT_SECTION_KEYS].filter(k => !have.has(k))
}

/** 화면의 ○/요약 바가 그 참값과 일치하는가 — 두 갈래(경고/초록) 중 옳은 쪽이 떠야 한다 */
const checkEmptyBar = async (page: { locator: (s: string) => { count: () => Promise<number> }; isVisible: (s: string) => Promise<boolean> }, label: string) => {
  const noDef = await noDefaultSections()
  const badges = await page.locator('text=기본문구 없음 — 자동주입 대상 아님').count()
  check(`${label}: ○ 표시 수 = 기본 없는 섹션 수 (${noDef.length})`,
    badges === noDef.length, `배지 ${badges} vs DB ${noDef.length} [${noDef.join(',')}]`)
  const bar = noDef.length > 0
    ? await page.isVisible('text=기본문구가 없는 섹션')
    : await page.isVisible('text=8섹션 모두 기본문구가 있습니다')
  check(`${label}: 요약 바가 그 수를 반영 (${noDef.length > 0 ? '경고' : '초록'})`, bar, `noDef=${noDef.length}`)
  return noDef.length
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

  // 라이브러리 시드 — training 2개(하나는 기본), brigadeTeams 1개.
  // 실데이터가 training ⭐기본을 쓰고 있으면 잠시 비켜 둔다(정리 단계에서 복원)
  await releaseExistingDefault('training')
  // ⚠ trainA는 **아직 기본이 아니다**(종전엔 여기서 바로 is_default=true였다). 화면의 ⭐/○ 계약을
  //   두 갈래 다 보려면 「기본 없음 → 기본 생김」 전이를 직접 만들어야 한다. 아래 1)에서 승격한다.
  const trainA = await seedLib('training', 'E2E 훈련 A(기본)', { scenario: 'A 시나리오', scenarioType: '', details: [] })
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

  // ⭐ 이 화면의 최대 가치는 ⭐/○ 다 — 기본문구가 없는 섹션에서는 신규 고객 자동주입이 **조용히**
  //   아무 일도 하지 않는다. 그래서 「몇 개가 비었는가」를 화면이 정확히 알리는지가 계약이다.
  //   숫자를 박지 않고 DB 참값과 대조한다(위 noDefaultSections 주석 참조).
  //   지금은 training의 실데이터 ⭐를 비켜 둔 채이고 trainA도 아직 기본이 아니다 → **경고 갈래**.
  const emptyBefore = await checkEmptyBar(page, '기본 없음')
  check('전제 — training이 ○ 목록에 있다', (await noDefaultSections()).includes('training'))

  // training에 ⭐를 하나 달면 화면의 ○가 **정확히 하나** 줄어야 한다.
  // ⭐⭐ 이 차분(差分) 단언이 이 블록의 알맹이다 — 전역에 기본이 몇 개든 뜻이 같고,
  //    「화면이 늘 같은 수를 보여준다」는 식의 공허 통과가 원리적으로 불가능하다.
  await raw.from('plan_text_library').update({ is_default: true }).eq('id', trainA)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#sec-training', { timeout: 60000 })
  await page.locator('#sec-training >> text=기본문구 없음 — 자동주입 대상 아님').waitFor({ state: 'detached', timeout: 30000 })
  const emptyAfter = await checkEmptyBar(page, '기본 생김')
  check('★ ⭐를 하나 달면 ○가 정확히 하나 준다',
    emptyBefore - emptyAfter === 1, `${emptyBefore} → ${emptyAfter}`)

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
  // 🚨🚨 **반드시 내가 심은 항목을 먼저 고른다.** 종전엔 이 두 줄이 없어 [삭제]가 그 섹션에
  //   **그때 떠 있던** 항목을 지웠다. 자기가 심은 것이 선택돼 있으리라는 가정인데, 그건 섹션에
  //   항목이 그것뿐일 때만 참이다. 2026-09-21 「기본 문구」가 등록되자 선택 기본값이 그쪽으로
  //   바뀌었고, 이 검사가 **실데이터 ⭐「기본 문구」를 소프트 삭제하고 ⭐까지 떨어뜨렸다**
  //   (수동 복구함). 검사가 실데이터를 부수면 그건 검사가 아니다.
  await teamsSec.locator('select').selectOption(teamsId)
  check('전제 — 삭제 대상이 내가 심은 항목', (await teamsSec.locator('select').inputValue()) === teamsId,
    await teamsSec.locator('select').inputValue())
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
  // 비켜 둔 실데이터 ⭐기본 복원 — **테스트 행 삭제 뒤에** 해야 유니크 인덱스에 걸리지 않는다
  // (테스트 도중 ⭐가 E2E 훈련 B로 옮겨가 있으므로, 그 행이 살아 있으면 복원이 실패한다)
  if (displacedDefaultId) {
    const { error } = await raw.from('plan_text_library')
      .update({ is_default: true }).eq('id', displacedDefaultId)
    if (error) console.error(`⚠ ⭐기본 복원 실패(${displacedDefaultId}): ${error.message} — 수동 확인 필요`)
  }
  if (customerId) {
    await raw.from('plan_text_applied').delete().eq('customer_id', customerId)
    await raw.from('fire_plan_forms').delete().eq('customer_id', customerId)
  }
  await cleanupCustomer(customerId)
  await delUser(userId)
  summary()
}
