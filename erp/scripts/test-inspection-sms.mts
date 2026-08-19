/** 사전 안내 SMS UI 배선 E2E (소방계획서_24 S11-2)
 *  실행: npx tsx scripts/test-inspection-sms.mts   (dev 서버 필요)
 *
 *  서버 로직(수신자 선정·중복 접기·실패 처리·판정)은 _probe-sms-send.mts가 32건으로 덮는다.
 *  여기서 확인하는 것은 **프로브가 볼 수 없는 화면 배선**이다:
 *    · 모니터링이 실제로 사라지고 새 화면으로 이어지는가(S6)
 *    · 달력 버튼이 그날 전 건을 띄우는가 — 달력이 로드하지 않는 자체점검까지(Q-14의 핵심)
 *    · 미확정 건이 목록에서 조용히 빠지지 않는가(S8-11)
 *    · 시점 태그를 추가·삭제하면 배너 줄 수가 따라오는가(Q-13)
 *    · 고객관리 수신 체크가 저장되고 통수 안내가 뜨는가(S5-b)
 */
import { chromium, type Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, PW, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan, login, check, summary } from './_e2e-helpers.mjs'

const SUF = Math.random().toString(36).slice(2, 7)
const EMAIL = `smsui.${SUF}@e2e.test`
const kst = (d = 0) => new Date(Date.now() + 9 * 3600_000 + d * 86400_000).toISOString().slice(0, 10)
const TOMORROW = kst(1)

async function main() {
  const browser = await chromium.launch()
  const page: Page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(20000)

  let userId = ''
  const custIds: string[] = []
  let plan: { id: string; created: boolean } | null = null
  let savedRules: unknown = null

  try {
    userId = await mkUser({ email: EMAIL, name: `문자UI${SUF}`, employeeId: `SU-${SUF}`, role: 'admin' })

    plan = await ensurePlan(+TOMORROW.slice(0, 4), +TOMORROW.slice(5, 7), userId)
    const mkItem = async (cid: string, planType: string, status: string, type = '작동') => {
      const { data, error } = await raw.from('inspection_plan_items').insert({
        plan_id: plan!.id, customer_id: cid, sequence_num: 1,
        inspection_type: type, plan_type: planType,
        scheduled_date: TOMORROW, status,
      }).select('id').single()
      if (error) throw new Error(`계획 항목 생성 실패: ${error.message}`)
      return (data as { id: string }).id
    }

    // A — 자체점검(달력 계획 칩 축에 안 실리는 종류), 관계인 2명
    const cidA = await mkCustomer({ customer_name: `문자UI-A${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '강하면', region_ri: '전수리' })
    custIds.push(cidA)
    await raw.from('customer_contacts').insert([
      { customer_id: cidA, role: '대표', name: '홍길동', phone: '01011112222' },
      { customer_id: cidA, role: '직원1', name: '김철수', phone: '01033334444' },
    ])
    await mkItem(cidA, 'special_작동', 'confirmed')

    // B — 정기(달력 계획 칩에 실림)
    const cidB = await mkCustomer({ customer_name: `문자UI-B${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '양평읍' })
    custIds.push(cidB)
    await raw.from('customer_contacts').insert([{ customer_id: cidB, role: '대표', name: '이대표', phone: '01055556666' }])
    await mkItem(cidB, 'monthly', 'confirmed')

    // D — **계획이 하나도 없는 고객**. Q-17이 든 사례(견적 방문·계획 없는 AS)가 이것이고,
    //     임의 발송 후보를 '화면에 뜬 행'으로 한정하면 이 고객을 못 고른다
    const cidD = await mkCustomer({ customer_name: `문자UI-무계획${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '지평면' })
    custIds.push(cidD)
    await raw.from('customer_contacts').insert([{ customer_id: cidD, role: '대표', name: '무계획', phone: '01099990000' }])

    // C — 미확정(planned)
    const cidC = await mkCustomer({ customer_name: `문자UI-C${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '강하면', region_ri: '전수리' })
    custIds.push(cidC)
    await raw.from('customer_contacts').insert([{ customer_id: cidC, role: '대표', name: '미확정', phone: '01077778888' }])
    await mkItem(cidC, 'monthly', 'planned')

    // 시점 규칙을 **알려진 기준값 [1]로 고정하고 시작**한다.
    // 앞선 실행이 [3,1]을 남기면 배너 첫 줄이 '3일 후'가 되고 태그 추가도 중복으로 막혀
    // 테스트가 자기 잔재에 걸린다(실제로 겪었다). 원래 값은 finally에서 되돌린다.
    const { data: cpBefore } = await raw.from('company_profile')
      .select('id, sms_lead_rules').order('id', { ascending: true }).limit(1).maybeSingle()
    savedRules = (cpBefore as { sms_lead_rules: unknown } | null)?.sms_lead_rules ?? [1]
    await raw.from('company_profile').update({ sms_lead_rules: [1] }).not('id', 'is', null)

    await login(page, EMAIL, PW)

    console.log('\n— S6: 모니터링 폐지')
    await page.goto(`${BASE}/inspection-plans/monitor`, { waitUntil: 'networkidle' })
    check('★ 구 모니터링 주소가 문자 발송으로 이어진다(404·죽은 링크 아님)',
      page.url().includes('/inspections/sms'), page.url())
    // 텍스트 스크래핑('nav, aside' 첫 요소)은 다른 nav를 잡아 헛통과할 수 있다 — 링크로 직접 본다
    check('사이드바에서 [점검현황 모니터링] 링크가 사라졌다',
      await page.locator('a[href="/inspection-plans/monitor"]').count() === 0)
    check('사이드바에 [문자 발송] 링크가 있다',
      await page.locator('a[href="/inspections/sms"]').count() >= 1)

    console.log('\n— S5: 문자 발송 화면')
    await page.waitForSelector('[data-testid="sms-row"]', { timeout: 20000 })
    const rowsTxt = await page.locator('[data-testid="sms-row"]').allInnerTexts()
    check('★ 자체점검 건이 목록에 뜬다(달력 계획 칩 축에는 없는 종류)',
      rowsTxt.some(t => t.includes(`문자UI-A${SUF}`)), rowsTxt.join(' | ').slice(0, 300))
    check('정기 건도 뜬다', rowsTxt.some(t => t.includes(`문자UI-B${SUF}`)))
    check('★ 미확정 건도 숨기지 않는다', rowsTxt.some(t => t.includes(`문자UI-C${SUF}`)))
    check('지역 3단 묶음 헤더가 리까지 보여준다',
      (await page.locator('[data-testid="sms-region-group"]').allInnerTexts()).some(t => t.includes('전수리')),
      (await page.locator('[data-testid="sms-region-group"]').allInnerTexts()).join(' | '))
    // '(리 없음)' 문구는 뺐다 — 읍/면이 있는 고객의 94%가 리 없음이라 화면이 그 문구로 뒤덮였다.
    // 지켜야 할 것은 문구가 아니라 **그 고객이 목록에서 사라지지 않는가**다.
    // 건수는 별도 span이라 라벨 텍스트에 안 들어온다 — 라벨 자체가 읍/면에서 끝나는지만 본다
    check('리가 빈 고객도 목록에 남고, 라벨은 읍/면에서 끝난다',
      rowsTxt.some(t => t.includes(`문자UI-B${SUF}`)) &&
      (await page.locator('[data-testid="sms-region-group"]').allInnerTexts()).some(t => t.trim() === '양평군 · 양평읍'),
      (await page.locator('[data-testid="sms-region-group"]').allInnerTexts()).join(' | '))
    check('어느 라벨에도 (리 없음)이 남지 않는다',
      !(await page.locator('[data-testid="sms-region-group"]').allInnerTexts()).some(t => t.includes('리 없음')))
    // 설계 초안은 '기본 접힘'(S5-11)이었으나 실사용에서 뒤집혔다(2026-08-19 사용자 지시) —
    // 접혀 있으면 좁힐 때마다 한 번 더 눌러야 하고, 무엇이 걸려 있는지도 요약 한 줄로만 보인다.
    check('★ 필터가 항상 펼쳐져 있다(누르지 않아도 조회 조건이 보인다)',
      await page.locator('[data-testid="sms-filter-toggle"]').isVisible() &&
      await page.locator('[data-testid="period-all"]').isVisible())
    // 기본은 **오늘부터 1개월**(2026-08-19 사용자 지시). 사용자가 건 필터는 없지만
    // 범위는 1개월이다 — 라벨이 '전체'라고 하면 화면이 거짓말을 하게 되므로 문구까지 고정한다.
    check('★ 기본 조회 범위가 오늘부터 1개월이라고 화면이 말한다',
      /1개월/.test(await page.locator('[data-testid="sms-filter-summary"]').innerText()),
      await page.locator('[data-testid="sms-filter-summary"]').innerText())
    // 기본은 **발송됨 제외** — 이 화면의 일은 '아직 안 보낸 것'이다.
    // 다만 실패·번호없음은 남아야 한다(조치가 필요한 건인데 함께 빠지면 영영 안 보인다).
    check('★ 기본이 발송 제외라고 화면이 말한다',
      /발송 제외/.test(await page.locator('[data-testid="sms-filter-summary"]').innerText()),
      await page.locator('[data-testid="sms-filter-summary"]').innerText())
    check('발송됨 상태의 행이 목록에 없다',
      !(await page.locator('[data-testid="sms-row"]').allInnerTexts()).some(t => /발송됨/.test(t)))
    check('기본 상태에서는 [필터 해제] 버튼이 없다(누를 게 없으니)',
      await page.locator('[data-testid="sms-filter-clear"]').count() === 0)
    {
      // 서버가 실제로 1개월만 담는가 — 라벨과 결과가 어긋나면 안 된다
      const dates = (await page.locator('[data-testid="sms-row"]').allInnerTexts())
        .map(t => /\d{4}-\d{2}-\d{2}/.exec(t)?.[0]).filter(Boolean) as string[]
      const limit = kst(30)
      check('★ 목록에 1개월 밖 날짜가 섞이지 않는다',
        dates.length > 0 && dates.every(d => d >= kst(0) && d <= limit),
        `${dates.length}건 · 최대 ${dates.sort().at(-1)} (한계 ${limit})`)
    }

    // ★ 기간 해제(전체)로 넓히면 PostgREST의 **1000행 하드 상한**에 걸린다.
    //   넘친 만큼은 오류 없이 그냥 빠져서 화면은 "그만큼밖에 없다"고 믿는다 —
    //   발송 화면에서 잘리면 그 고객만 안내를 못 받는데 화면상으로는 멀쩡해 보인다.
    //   실제로 이 화면이 1000/1001에서 오락가락했다(2026-08-19). 상한을 넘겨 받는지 못 박는다.
    // (1000행 상한 검증은 화면이 아니라 _probe-sms-send.mts에서 한다 —
    //  화면 행은 고객+방문일로 **접힌 그룹**이라 계획 항목 수와 비교할 수 없다.
    //  실제로 1260건이 291행으로 접혀, UI에서 재면 잘림과 접힘을 구별하지 못한다.)

    // ★ 필터를 바꾸면 **바로 조회돼야 한다** — [조회]를 눌러야만 반영되면
    //   값만 바뀌고 목록은 옛 조건 그대로인 상태가 생긴다(특히 '해제했는데 목록이 그대로').
    {
      const before = await page.locator('[data-testid="sms-row"]').count()
      // 필터는 이미 펼쳐져 있다 — 토글을 누르면 오히려 **닫혀서** select를 못 찾는다(실제로 겪음).
      // 인덱스(nth=3)로 집던 것도 열이 늘면 조용히 다른 select를 집으므로 testid로 바꾼다.
      await page.locator('[data-testid="filter-status"]').waitFor()
      // 상태를 '실패'로 — 이 테스트 데이터에는 실패 건이 없으므로 목록이 줄어야 한다
      await page.locator('[data-testid="filter-status"]').selectOption('failed')
      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-testid="sms-row"]').length !== n,
        before, { timeout: 15000 }).catch(() => {})
      const after = await page.locator('[data-testid="sms-row"]').count()
      check('★ 필터를 바꾸면 [조회]를 누르지 않아도 목록이 따라온다', after !== before, `${before} → ${after}`)
      check('필터가 걸리면 [필터 해제]가 나타난다',
        await page.locator('[data-testid="sms-filter-clear"]').count() === 1)
      // ★ 해제도 마찬가지 — 누르면 바로 되돌아와야 한다
      await page.locator('[data-testid="sms-filter-clear"]').click()
      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-testid="sms-row"]').length === n,
        before, { timeout: 15000 }).catch(() => {})
      check('★ [필터 해제]를 누르면 바로 전체가 다시 조회된다',
        await page.locator('[data-testid="sms-row"]').count() === before,
        `${await page.locator('[data-testid="sms-row"]').count()} vs ${before}`)
    }

    console.log('\n— S5-7: 방문 준비 지도 (모니터링 폐지로 소실됐던 기능)')
    {
      // 고객A는 주소가 없다(mkCustomer 기본) — 주소가 있는 고객에만 버튼이 떠야 한다.
      // 눌렀는데 빈 지도가 뜨는 것은 버튼이 없는 것보다 나쁘다.
      await raw.from('customers').update({ address: '경기도 양평군 강하면 강남로 1' }).eq('id', cidA)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="sms-row"]', { timeout: 30000 })
      const withAddr = page.locator('[data-testid="sms-row"]').filter({ hasText: `문자UI-A${SUF}` }).first()
      const noAddr = page.locator('[data-testid="sms-row"]').filter({ hasText: `문자UI-C${SUF}` }).first()
      check('★ 주소가 있는 행에 [지도]가 있다(S5-7 복원)',
        await withAddr.locator('[data-testid="row-map"]').count() === 1)
      check('주소가 없으면 버튼도 없다 — 눌렀는데 빈 지도가 뜨지 않게',
        await noAddr.locator('[data-testid="row-map"]').count() === 0)
      await withAddr.locator('[data-testid="row-map"]').click()
      await page.waitForSelector('[data-testid="address-map-modal"]', { timeout: 20000 })
      const mapText = await page.locator('[data-testid="address-map-modal"]').innerText()
      check('지도 모달이 주소와 [새 창]·[주소 복사]를 함께 준다 — iframe이 막혀도 길이 남는다',
        /강남로 1/.test(mapText) && /새 창/.test(mapText) && /주소 복사/.test(mapText),
        mapText.replace(/\n/g, ' ').slice(0, 120))
      await page.keyboard.press('Escape').catch(() => {})
      await page.locator('[data-testid="address-map-modal"]').press('Escape').catch(() => {})
      await page.mouse.click(5, 5)
      await raw.from('customers').update({ address: null }).eq('id', cidA)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="sms-row"]', { timeout: 30000 })
    }

    console.log('\n— D2·D3: 부분 실패와 굳은 행이 화면에서 덮이지 않는가')
    {
      // 고객A(수신자 2명)에 **1명 성공 + 1명 실패** 이력을 심는다.
      // 종전엔 anySent가 우선이라 행이 '발송됨'으로 덮였고, 기본 필터(발송 제외)에서도 사라져
      // 실패한 그 1명이 영구히 은폐됐다 — Q-9(멀티 수신자)의 근거를 스스로 무너뜨린 셈이다.
      await raw.from('sms_send_log').insert([
        { kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: TOMORROW,
          to_phone: '01011112222', content: 'x', status: 'sent', sent_by: userId },
        { kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: TOMORROW,
          to_phone: '01033334444', content: 'x', status: 'failed', error: '수신거부', sent_by: userId },
      ])
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="sms-row"]', { timeout: 30000 })
      // 상태는 **상태 칸의 data-status로 읽는다** — 행 전체 텍스트로 보면 사유 문구
      // "(1명 발송됨)"에 걸려 오탐이 난다(실제로 겪음).
      const rowLoc = page.locator('[data-testid="sms-row"]').filter({ hasText: `문자UI-A${SUF}` }).first()
      const rowA = await rowLoc.innerText()
      const statusA = await rowLoc.locator('[data-testid="row-status"]').getAttribute('data-status')
      check('★ 일부만 실패해도 행이 "발송됨"으로 덮이지 않는다(조치 필요가 우선)',
        statusA === 'failed', `상태=${statusA} · ${rowA.replace(/\n/g, ' ')}`)
      check('★ 몇 명 중 몇 명이 실패인지 말한다', /2명 중 1명 실패/.test(rowA), rowA.replace(/\n/g, ' '))

      // 굳은 행(sending) — 돈이 나갔을 수 있으므로 '미발송'이 아니라 '확인필요'여야 한다
      await raw.from('sms_send_log').delete().eq('customer_id', cidA).eq('visit_date', TOMORROW)
      await raw.from('sms_send_log').insert({
        kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: TOMORROW,
        to_phone: '01011112222', content: 'x', status: 'sending', sent_by: userId,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="sms-row"]', { timeout: 30000 })
      const rowLocB = page.locator('[data-testid="sms-row"]').filter({ hasText: `문자UI-A${SUF}` }).first()
      const statusB = await rowLocB.locator('[data-testid="row-status"]').getAttribute('data-status')
      check('★ 결과가 안 기록된 행은 "확인필요" — 미발송으로 두면 재발송·이중 과금이 된다',
        statusB === 'stuck', `상태=${statusB} · ${(await rowLocB.innerText()).replace(/\n/g, ' ')}`)
      await raw.from('sms_send_log').delete().eq('customer_id', cidA).eq('visit_date', TOMORROW)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="sms-row"]', { timeout: 30000 })
    }

    console.log('\n— D5·S5-0b: 계획 없는 행의 출구와 일정변경 배지')
    {
      // 계획이 없는 이력(임의 발송 등)은 일괄 경로로 못 보낸다 — 체크가 막히고 전용 버튼이 있어야 한다.
      // 종전엔 체크는 되는데 발송에서 조용히 빠져, 사용자는 보냈다고 믿었다.
      await raw.from('sms_send_log').insert({
        kind: 'adhoc', customer_id: cidD, plan_item_ids: [], visit_date: kst(3),
        to_phone: '01099990000', content: 'x', status: 'failed', error: '수신거부', sent_by: userId,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="sms-row"]', { timeout: 30000 })
      const adhocRow = page.locator('[data-testid="sms-row"]').filter({ hasText: `문자UI-무계획${SUF}` }).first()
      check('★ 계획 없는 행은 체크가 막힌다(일괄 발송에서 조용히 빠지지 않게)',
        await adhocRow.locator('[data-testid="row-check-disabled"]').count() === 1)
      check('★ 대신 행에 [다시 보내기]가 있다 — 없으면 재발송할 방법이 아예 없다',
        await adhocRow.locator('[data-testid="row-resend"]').count() === 1)
      await adhocRow.locator('[data-testid="row-resend"]').click()
      await page.waitForSelector('[data-testid="adhoc-date"]', { timeout: 20000 })
      check('★ 방문일이 미리 채워진다(아는 값을 다시 입력시키지 않는다)',
        await page.locator('[data-testid="adhoc-date"]').inputValue() === kst(3),
        await page.locator('[data-testid="adhoc-date"]').inputValue())
      await page.locator('[data-testid="sms-modal"] button', { hasText: '닫기' }).first().click()
      await raw.from('sms_send_log').delete().eq('customer_id', cidD)

      // 일정변경 — 옛 날짜로 안내가 나간 뒤 점검일이 옮겨진 상황.
      // 그 옛 날짜에는 계획이 없어야 '이동'으로 판정된다(다음 회차와 구별).
      await raw.from('sms_send_log').insert({
        kind: 'pre_visit', customer_id: cidB, plan_item_ids: [], visit_date: kst(9),
        to_phone: '01055556666', content: 'x', status: 'sent', sent_by: userId,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="sms-row"]', { timeout: 30000 })
      const movedRow = page.locator('[data-testid="sms-row"]').filter({ hasText: `문자UI-B${SUF}` }).first()
      check('★ 일정변경 배지가 뜬다 — 그냥 보내면 고객이 두 날짜를 안내받는다(S5-0b)',
        await movedRow.locator('[data-testid="badge-moved"]').count() === 1,
        (await movedRow.innerText()).replace(/\n/g, ' '))
      await raw.from('sms_send_log').delete().eq('customer_id', cidB)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="sms-row"]', { timeout: 30000 })
    }

    console.log('\n— Q-12: 승인 배너')
    const notices = await page.locator('[data-testid="sms-notice"]').allInnerTexts()
    check('배너 줄이 그려진다', notices.length >= 1, notices.join(' | '))
    check('★ 내일 방문 건이 미발송으로 집계된다', notices.some(t => /내일/.test(t) && /미발송/.test(t)), notices.join(' | '))

    console.log('\n— S8: 모달 (배너 승인 경로)')
    // 첫 줄이 아니라 **'내일' 줄**을 눌러야 한다 — 시점 규칙이 [3,1]이면 첫 줄은 3일 후이고
    // 그날 방문 고객은 이 테스트가 만든 건이 아니다(앞선 실행이 남긴 규칙에 걸려 오탐이 났다)
    const tomorrowNotice = page.locator('[data-testid="sms-notice"]').filter({ hasText: '내일' })
    check('내일 배너 줄이 하나 있다', await tomorrowNotice.count() === 1, String(await tomorrowNotice.count()))
    await tomorrowNotice.locator('[data-testid="sms-approve"]').click()
    await page.waitForSelector('[data-testid="sms-modal"]')
    await page.waitForSelector('[data-testid="sms-group"]', { timeout: 20000 })
    const groups = await page.locator('[data-testid="sms-group"]').allInnerTexts()
    check('★ 모달에 자체점검 고객이 든다', groups.some(t => t.includes(`문자UI-A${SUF}`)), groups.join(' | ').slice(0, 300))
    // 관계인 2명이 있지만 **아무도 체크하지 않았으므로** 폴백 1명(대표)만 나가는 것이 설계다(Q-10).
    // 도입만으로 문자량이 몇 배가 되지 않게 하는 장치라, 이 단언이 곧 폴백의 회귀 방어다.
    const groupA = groups.find(t => t.includes(`문자UI-A${SUF}`)) ?? ''
    check('★ 수신 미지정이면 대표 1명만(폴백) — 관계인이 2명이어도 2통이 되지 않는다',
      groupA.includes('홍길동') && !groupA.includes('김철수'), groupA.replace(/\n/g, ' '))
    check('★ 미확정 건은 사유와 함께 보이되 발송 불가',
      (await page.locator('[data-testid="sms-unsendable"]').count()) >= 1)
    // 경고는 **양방향**으로 단언한다. 없을 때 뜨는 것만 보면, 키가 들어온 뒤에도 빨간 띠가
    // 계속 붙어 있는 상태를 통과시킨다 — 항상 켜진 경고는 읽히지 않아 경고가 아니게 된다.
    // (2026-08-19 로컬에 SOLAPI 실키가 들어오면서 실제로 이 방향이 갈렸다)
    const credsMissing = !(process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET
      && (process.env.SOLAPI_SENDER_PHONE || process.env.SMS_SENDER_PHONE))
    const credWarn = await page.locator('[data-testid="sms-cred-warn"]').count()
    check(credsMissing
      ? '자격증명이 없으면 "실제로 나가지 않는다"를 먼저 말한다'
      : '자격증명이 갖춰지면 경고가 사라진다(상시 경고는 경고가 아니다)',
      credsMissing ? credWarn >= 1 : credWarn === 0, `키 ${credsMissing ? '없음' : '있음'} · 경고 ${credWarn}개`)
    const sendLabel = await page.locator('[data-testid="sms-send"]').innerText()
    check('★ 발송 버튼에 실통수가 찍힌다(비용이 눌리기 전에 보인다)', /\d+통 발송/.test(sendLabel), sendLabel)
    check('문구 편집란이 있고 바이트·SMS/LMS를 보여준다',
      (await page.locator('[data-testid="sms-body"]').count()) === 1 &&
      /바이트/.test(await page.locator('[data-testid="sms-modal"]').innerText()))

    // ── 정리된 보기(2026-08-19) — 유형·지역 구별 + 대표/수신 위계 + 모두선택 ──
    // 종전엔 유형 칩이 전부 같은 보라색이라 정기/자체가 구별되지 않았고, 지역은 아예 없었다.
    // 라벨은 달력 데이 패널과 같은 축 — 정기 / 종합 / 작동 / 일반.
    // '작동(정기)' 같은 조합형은 쓰지 않는다(서로 다른 축을 묶어 "작동인데 정기?"로 읽혔다)
    const groupB = groups.find(t => t.includes(`문자UI-B${SUF}`)) ?? ''
    check('★ 자체점검은 유형(작동/종합)으로 보인다', /작동|종합/.test(groupA) && !groupA.includes('(정기)'),
      groupA.replace(/\n/g, ' '))
    check('★ 월간 방문은 정기로 보인다', groupB.includes('정기'), groupB.replace(/\n/g, ' '))
    check('★ 조합형 라벨을 쓰지 않는다', !/\(자체\)|\(정기\)/.test(groups.join(' ')),
      groups.join(' | ').slice(0, 200))

    const modalText = await page.locator('[data-testid="sms-modal"]').innerText()
    check('★ 자체점검·계획 일정 구역이 나뉜다',
      modalText.includes('자체점검') && modalText.includes('계획 일정'), modalText.slice(0, 200).replace(/\n/g, ' '))
    check('바이트·SMS 표기는 목록에서 뺀다(문구 칸에만 남긴다)',
      !/\d+B·(SMS|LMS)/.test(modalText))

    // 대표가 수신자면 '대표'로 표기된다(폴백 1명 케이스) — 누구에게 가는지가 역할과 함께 보인다
    check('★ 대표·수신 구분 표기', groupA.includes('대표'), groupA.replace(/\n/g, ' '))

    // 모두 선택/해제 — 통수가 0이 되고 발송 버튼이 잠긴다
    const selectAll = page.locator('[data-testid="sms-select-all"]')
    check('전체 선택 체크박스가 있다', await selectAll.count() === 1)
    await selectAll.click()
    await page.waitForTimeout(400)
    const offLabel = await page.locator('[data-testid="sms-send"]').innerText()
    check('★ 전체 해제하면 0통이 되고 발송이 잠긴다',
      /0통 발송/.test(offLabel) && await page.locator('[data-testid="sms-send"]').isDisabled(), offLabel)
    await selectAll.click()
    await page.waitForTimeout(400)
    const onLabel = await page.locator('[data-testid="sms-send"]').innerText()
    check('★ 다시 누르면 전부 선택으로 복귀', /[1-9]\d*통 발송/.test(onLabel), onLabel)

    await page.keyboard.press('Escape').catch(() => {})
    await page.locator('[data-testid="sms-modal"] button', { hasText: '닫기' }).first().click().catch(() => {})

    console.log('\n— Q-14: 달력 진입 (날짜 전달 방식)')
    await page.goto(`${BASE}/inspections/calendar`, { waitUntil: 'networkidle' })
    check('툴바에 [사전안내 문자]가 있다', await page.locator('[data-testid="calendar-sms-toolbar"]').isVisible())
    await page.locator('[data-testid="calendar-sms-toolbar"]').click()
    await page.waitForSelector('[data-testid="sms-group"]', { timeout: 20000 })
    const calGroups = await page.locator('[data-testid="sms-group"]').allInnerTexts()
    check('★ 달력에서 열어도 자체점검 포함 전 건이 뜬다 — 달력이 무엇을 로드했는지와 무관(Q-14)',
      calGroups.some(t => t.includes(`문자UI-A${SUF}`)) && calGroups.some(t => t.includes(`문자UI-B${SUF}`)),
      calGroups.join(' | ').slice(0, 300))
    await page.locator('[data-testid="sms-modal"] button', { hasText: '닫기' }).first().click()

    console.log('\n— S5-b: 고객관리 수신 지정')
    await page.goto(`${BASE}/customers/${cidA}?tab=contacts`, { waitUntil: 'networkidle' })
    // 탭 셸이라 URL만으로 안 열리면 탭을 눌러 연다
    if (!(await page.locator('[data-testid="sms-recipient-summary"]').isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /관계인/ }).first().click().catch(() => {})
    }
    await page.waitForSelector('[data-testid="sms-recipient-summary"]', { state: 'visible' })
    const summaryBefore = await page.locator('[data-testid="sms-recipient-summary"]').innerText()
    check('미지정이면 "대표에게 1통"이라고 말한다(폴백을 숨기지 않는다)',
      /미지정/.test(summaryBefore) && /1통/.test(summaryBefore), summaryBefore)
    await page.locator('[data-testid="sms-recipient-toggle"] input').first().check()
    await page.waitForTimeout(1200)
    const { data: afterRow } = await raw.from('customer_contacts')
      .select('name, sms_recipient').eq('customer_id', cidA).eq('role', '대표').maybeSingle()
    check('★ 체크가 DB에 저장된다', (afterRow as { sms_recipient: boolean | null } | null)?.sms_recipient === true,
      JSON.stringify(afterRow))
    const summaryAfter = await page.locator('[data-testid="sms-recipient-summary"]').innerText()
    check('★ 체크 인원 = 회차당 통수를 화면이 말한다(비용이 정해지는 지점)',
      /1명/.test(summaryAfter) && /1회당 1통/.test(summaryAfter), summaryAfter)
    check('임의 발송 진입점이 고객 상세에 있다(Q-17 — 종전에는 누를 곳이 없었다)',
      await page.locator('[data-testid="customer-adhoc-sms"]').isVisible())

    console.log('\n— Q-13: 시점 설정')
    // 기준을 여기서 다시 [1]로 고정한다 — 앞 절에서 규칙이 바뀌었을 수 있고,
    // 상대값(before+1)으로 단언하면 오염된 상태에서 조용히 통과하거나 엉뚱하게 실패한다
    await raw.from('company_profile').update({ sms_lead_rules: [1] }).not('id', 'is', null)
    // networkidle은 dev의 HMR 웹소켓 때문에 안 끝날 수 있다 — 필요한 요소를 직접 기다린다
    await page.goto(`${BASE}/settings/message-templates`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="lead-rule-tag"]', { timeout: 30000 })
    check('기준 상태: 시점 1개(내일)', await page.locator('[data-testid="lead-rule-tag"]').count() === 1,
      (await page.locator('[data-testid="lead-rule-tag"]').allInnerTexts()).join(','))
    await page.locator('[data-testid="lead-rule-input"]').fill('3')
    await page.locator('[data-testid="lead-rule-add"]').click()
    await page.waitForTimeout(1500)
    check('★ 시점 태그를 추가하면 2개가 된다', await page.locator('[data-testid="lead-rule-tag"]').count() === 2,
      (await page.locator('[data-testid="lead-rule-tag"]').allInnerTexts()).join(','))
    const tags = await page.locator('[data-testid="lead-rule-tag"]').allInnerTexts()
    check('먼 시점이 앞에 온다(급한 것이 아래로 가지 않게)', /3일 후/.test(tags[0]), tags.join(','))
    // 중복 거부
    await page.locator('[data-testid="lead-rule-input"]').fill('3')
    await page.locator('[data-testid="lead-rule-add"]').click()
    await page.waitForTimeout(600)
    check('중복 시점은 거부한다', /이미 있는 시점/.test(await page.locator('main, body').first().innerText()))

    check('문구 3종 카드가 그려진다', await page.locator('[data-testid="template-card"]').count() === 3,
      String(await page.locator('[data-testid="template-card"]').count()))
    const cards = await page.locator('[data-testid="template-card"]').allInnerTexts()
    check('★ 관계인 보고 문구가 설정에서 보인다(종전엔 점검 건 안에만 있었다)',
      cards.some(t => t.includes('관계인 보고 메일')), cards.join(' | ').slice(0, 200))
    check('SMS 카드에만 바이트·요금 구분이 뜬다',
      (await page.locator('[data-testid="template-bytes"]').count()) === 1)

    console.log('\n— S9-5: 사이드바 뱃지·대시보드 위젯·툴바 임의 발송')
    await page.goto(`${BASE}/inspections/sms`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="sms-notice"]')
    // 배너가 세는 미발송 곳 수 — 뱃지·위젯이 이 수와 같아야 한다(같은 함수로 세므로)
    const bannerUnsent = (await page.locator('[data-testid="sms-notice"]').allInnerTexts())
      .map(t => /미발송 (\d+)곳/.exec(t)?.[1]).filter(Boolean).reduce((n, v) => n + Number(v), 0)
    check('배너에 미발송이 잡혀 있다(뱃지 비교의 전제)', bannerUnsent > 0, String(bannerUnsent))

    // 뱃지는 **마운트 후 클라이언트에서** 채워진다(렌더 경로에서 뺐기 때문 — 실측 497ms).
    // 즉시 단언하면 부하가 걸린 상황에서만 실패한다: 단독 실행에서는 빨라서 늘 통과하고,
    // 전체 스위트 안에서만 깨져 원인 찾기가 어려워진다. 반드시 나타날 때까지 기다린다.
    const badge = page.locator('[data-testid="sidebar-sms-badge"]')
    await badge.waitFor({ timeout: 30000 }).catch(() => {})
    check('★ 사이드바에 미발송 뱃지가 뜬다(종전에는 액션만 있고 호출부가 없었다)',
      await badge.count() === 1, String(await badge.count()))
    check('★ 뱃지 수 = 배너 미발송 곳 수 — 두 곳이 다른 수를 보이면 어느 쪽을 믿을지 모른다',
      (await badge.innerText()).trim() === String(bannerUnsent),
      `뱃지 ${await badge.innerText()} vs 배너 ${bannerUnsent}`)

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
    const widget = page.locator('[data-testid="dash-sms-widget"]')
    await widget.waitFor({ timeout: 30000 })
    check('★ 대시보드 위젯이 그려진다', await widget.count() === 1)
    const wText = await widget.innerText()
    check('위젯 수도 배너와 일치', new RegExp(`${bannerUnsent}곳`).test(wText), wText.replace(/\n/g, ' '))
    check('위젯이 문자 발송 화면으로 잇는다',
      (await widget.getAttribute('href')) === '/inspections/sms', await widget.getAttribute('href') ?? '')

    await page.goto(`${BASE}/inspections/sms`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="sms-row"]')
    check('툴바에 [임의 발송]이 있다(Q-17 세 번째 진입)',
      await page.locator('[data-testid="sms-adhoc-toolbar"]').isVisible())
    await page.locator('[data-testid="sms-adhoc-toolbar"]').click()
    await page.waitForSelector('[data-testid="sms-adhoc-picker"]')
    // ★ 후보는 '화면에 뜬 행'이 아니라 **전 활성 고객**이어야 한다 —
    //   Q-17이 든 사례(견적 방문·계획 없는 AS)는 계획이 없는 고객이라, 화면 행으로 한정하면
    //   정작 이 기능이 필요한 경우를 못 고른다(독립 판정 지적으로 드러난 결함)
    await page.waitForFunction(
      () => /전체 고객 \d+곳/.test(document.querySelector('[data-testid="sms-adhoc-picker"]')?.textContent ?? ''),
      undefined, { timeout: 30000 })
    const pickerText = await page.locator('[data-testid="sms-adhoc-picker"]').innerText()
    const optionCount = Number(/전체 고객 (\d+)곳/.exec(pickerText)?.[1] ?? 0)
    // 화면 행 수와 비교하면 다른 테스트가 남긴 데이터에 흔들린다 — **활성 고객 수 실측**과 맞춘다
    const { count: activeCustomers } = await raw.from('customers')
      .select('id', { count: 'exact', head: true }).eq('is_active', true)
    check('★ 임의 발송 후보 = 전 활성 고객 (화면에 뜬 행으로 한정되지 않는다)',
      optionCount === (activeCustomers ?? 0), `후보 ${optionCount}곳 vs 활성 고객 ${activeCustomers}곳`)
    // 계획이 전혀 없는 고객을 실제로 고를 수 있는지 — 이 테스트가 만든 '계획 없는 고객'으로 확인.
    // 이름을 **끝까지** 치면 안 된다: 정확히 하나로 좁혀지면 컴포넌트가 '이미 고른 상태'로 보고
    // 제안 목록을 닫는다(customer-filter-search.tsx:48). 부분 문자열로 목록을 띄운다.
    await page.locator('[data-testid="sms-adhoc-customer"]').click()
    await page.locator('[data-testid="sms-adhoc-customer"]').fill(`무계획${SUF}`)
    await page.waitForTimeout(600)
    const listText = await page.locator('[data-testid="sms-adhoc-customer-list"]').innerText().catch(() => '(목록 없음)')
    check('★ 계획이 없는 고객도 후보에 뜬다', listText.includes(`문자UI-무계획${SUF}`), listText.replace(/\n/g, ' '))
    // CustomerFilterSearch는 testId를 input 자체에 붙인다(래퍼가 아니다)
    await page.locator('[data-testid="sms-adhoc-customer"]').fill(`문자UI-A${SUF}`)
    await page.waitForTimeout(400)
    await page.locator('[data-testid="sms-adhoc-open"]').click()
    await page.waitForSelector('[data-testid="adhoc-date"]')
    check('★ 임의 발송은 방문일부터 묻는다(고객은 이미 정해져 있다)',
      await page.locator('[data-testid="adhoc-date"]').isVisible())
    const beforeItems = ((await raw.from('inspection_plan_items').select('id').eq('customer_id', cidA)).data ?? []).length
    await page.locator('[data-testid="adhoc-date"]').fill(kst(3))
    await page.locator('[data-testid="sms-modal"] button', { hasText: '대상 확인' }).click()
    await page.waitForSelector('[data-testid="sms-group"]')
    check('임의 발송 대상이 계산된다', (await page.locator('[data-testid="sms-group"]').count()) === 1)
    const afterItems = ((await raw.from('inspection_plan_items').select('id').eq('customer_id', cidA)).data ?? []).length
    check('★ 대상 계산만으로 계획 회차가 늘지 않는다', beforeItems === afterItems, `${beforeItems} → ${afterItems}`)
    await page.locator('[data-testid="sms-modal"] button', { hasText: '닫기' }).first().click()

    console.log('\n— 배너가 설정 시점을 따라온다')
    await page.goto(`${BASE}/inspections/sms`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="sms-notice"]')
    check('★ 배너 줄 수 = 설정된 시점 수', await page.locator('[data-testid="sms-notice"]').count() === 2,
      String(await page.locator('[data-testid="sms-notice"]').count()))
  } finally {
    if (savedRules) {
      // 모든 행을 되돌린다 — 행이 갈라지면 다음 실행이 어느 행을 볼지에 따라 결과가 달라진다
      await raw.from('company_profile').update({ sms_lead_rules: savedRules }).not('id', 'is', null)
    }
    for (const c of custIds) {
      await raw.from('sms_send_log').delete().eq('customer_id', c)
      await cleanupCustomer(c)
    }
    if (plan?.created) await raw.from('inspection_plans').delete().eq('id', plan.id)
    await delUser(userId)
    await browser.close()
  }
  summary()
}

main().catch(e => { console.error(e); process.exit(1) })
