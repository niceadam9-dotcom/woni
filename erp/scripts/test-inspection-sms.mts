/** 사전 안내 SMS UI 배선 E2E (소방계획서_24 S11-2)
 *  실행: npx tsx scripts/test-inspection-sms.mts   (dev 서버 필요)
 *
 *  서버 로직(수신자 선정·중복 접기·실패 처리·판정)은 _probe-sms-send.mts가 32건으로 덮는다.
 *  여기서 확인하는 것은 **프로브가 볼 수 없는 화면 배선**이다:
 *    · 모니터링이 실제로 사라지고 새 화면으로 이어지는가(S6)
 *    · **보내는 일은 달력에서, 결과는 이력 화면에서**(2026-09-29) — 종전 「문자 발송」 화면의
 *      승인 배너·임의 발송은 달력 문자 패널로, 목록은 발송 이력으로 갈렸다. 단언도 그 자리를 따라 옮겼다
 *    · 달력에서 **골라** 보내면 그 고객만 체크된 채 열리고, 안 고른 고객은 목록에 남아 있는가
 *    · 달력 버튼이 그날 전 건을 띄우는가 — 달력이 로드하지 않는 자체점검까지(Q-14의 핵심)
 *    · (구)미확정 차단은 2026-09-12 폐지 — 전건 확정 체계라, 이제는 확정 건이 곧바로 발송 대상인가를 본다
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

    // C — 정기 확정 건 하나 더 (구 미확정 사례 자리 — 2026-09-12 전건 확정 체계로 planned 소멸.
    //     이제 지켜야 할 계약은 「태어나며 확정된 건이 곧바로 발송 대상이 되는가」다)
    const cidC = await mkCustomer({ customer_name: `문자UI-C${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '강하면', region_ri: '전수리' })
    custIds.push(cidC)
    await raw.from('customer_contacts').insert([{ customer_id: cidC, role: '대표', name: '정기확정', phone: '01077778888' }])
    await mkItem(cidC, 'monthly', 'confirmed')

    // E — **번호가 없는** 고객(내일 방문). 「보낼 수 없는 건」이 0이면 "뱃지 = 미발송 + 보낼 수 없음"
    //     단언이 뒷항을 물지 못한다 — 산식에서 뒷항을 빼도 초록이다(변이가 살아남는 표본).
    const cidE = await mkCustomer({ customer_name: `문자UI-무번호${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '양평읍' })
    custIds.push(cidE)
    await raw.from('customer_contacts').insert([{ customer_id: cidE, role: '대표', name: '무번호', phone: null }])
    await mkItem(cidE, 'monthly', 'confirmed')

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
    check('사이드바에 [문자 발송 이력] 링크가 있다',
      await page.locator('a[href="/inspections/sms"]').count() >= 1)

    console.log('\n— 발송 이력 화면: 보내는 수단이 없고, 기록만 보여준다')
    const rowOf = (name: string) => page.locator('[data-testid="sms-row"]').filter({ hasText: name })
    /** 이력은 비동기로 온다 — 「행이 없다」를 단언하려면 **조회가 끝났음**부터 확인해야 한다.
     *  상태 칩의 건수는 조회가 끝나야 찍히므로 그것을 기다린다(빈 화면에서 공허 통과 방지). */
    const historyReady = async () => {
      await page.waitForFunction(
        () => /전체\s*\d+/.test(document.querySelector('[data-testid="history-status-all"]')?.textContent ?? ''),
        undefined, { timeout: 30000 })
    }
    const reloadHistory = async () => {
      await page.goto(`${BASE}/inspections/sms`, { waitUntil: 'domcontentloaded' })
      await historyReady()
    }
    await historyReady()
    check('★ 보낸 적 없는 계획은 이력에 없다(이력은 계획이 아니라 기록에서 읽는다)',
      await rowOf(`문자UI-A${SUF}`).count() === 0 && await rowOf(`문자UI-B${SUF}`).count() === 0)
    check('★ 이력 화면에는 승인·발송 버튼이 없다(보내는 곳은 달력 하나)',
      await page.locator('[data-testid="sms-approve"]').count() === 0 &&
      await page.locator('[data-testid="sms-adhoc-toolbar"]').count() === 0)
    check('★ 대신 달력 문자 패널로 가는 길이 있다',
      (await page.locator('[data-testid="sms-go-calendar"]').getAttribute('href')) === '/inspections/calendar?sms=1',
      await page.locator('[data-testid="sms-go-calendar"]').getAttribute('href') ?? '(없음)')
    check('기본 상태는 전체다(이력이 자기 기록을 가리지 않는다)',
      (await page.locator('[data-testid="history-status-all"]').getAttribute('data-active')) === '1')
    {
      // ★ 지난 방문일의 발송도 남는다 — 종전 목록은 하한이 오늘이라 방문일이 지나는 순간
      //   그 문자는 어느 화면에서도 볼 수 없었다. 이력 화면이 생긴 이유다.
      await raw.from('sms_send_log').insert({
        kind: 'pre_visit', customer_id: cidC, plan_item_ids: [], visit_date: kst(-3),
        to_phone: '01077778888', content: 'x', status: 'sent', sent_by: userId,
      })
      await reloadHistory()
      const past = rowOf(`문자UI-C${SUF}`).first()
      check('★ 방문일이 지난 발송도 이력에 남는다', await past.count() === 1)
      check('지난 방문에는 [다시 보내기]가 없다(보낼 수 없는 날짜다)',
        await past.locator('[data-testid="row-resend"]').count() === 0)
      await raw.from('sms_send_log').delete().eq('customer_id', cidC)
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
      await reloadHistory()
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
      await reloadHistory()
      const rowLocB = page.locator('[data-testid="sms-row"]').filter({ hasText: `문자UI-A${SUF}` }).first()
      const statusB = await rowLocB.locator('[data-testid="row-status"]').getAttribute('data-status')
      check('★ 결과가 안 기록된 행은 "확인필요" — 미발송으로 두면 재발송·이중 과금이 된다',
        statusB === 'stuck', `상태=${statusB} · ${(await rowLocB.innerText()).replace(/\n/g, ' ')}`)

      // ── 시간 축(2차 판정) — 이력은 append-only인데 표시가 그걸 몰랐다 ──
      // 옛 실패를 재발송으로 해결해도 행이 영구히 '실패'로 남아 기본 필터에 계속 걸렸다.
      // 사람을 재발송으로 미는 결함이라, 표시 계층이 만들어내는 이중 과금이다.
      await raw.from('sms_send_log').delete().eq('customer_id', cidA).eq('visit_date', TOMORROW)
      const t0 = new Date(Date.now() - 3600_000).toISOString()
      const t1 = new Date(Date.now() - 60_000).toISOString()
      await raw.from('sms_send_log').insert([
        { kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: TOMORROW,
          to_phone: '01011112222', content: 'x', status: 'failed', error: '일시 오류', sent_by: userId, created_at: t0 },
        { kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: TOMORROW,
          to_phone: '01011112222', content: 'x', status: 'sent', sent_by: userId, created_at: t1 },
      ])
      await reloadHistory()
      // ★ 해결된 건은 [실패]로 좁혔을 때 **빠져야 한다** — 남아 있으면 사람을 재발송으로 민다.
      //   전제부터 확인한다: 전체에는 그 행이 **있어야** 아래 「없다」가 뜻을 가진다(빈 화면 공허 통과 방지)
      check('전제: 전체 목록에는 그 행이 있다', await rowOf(`문자UI-A${SUF}`).count() === 1)
      await page.locator('[data-testid="history-status-failed"]').click()
      check('★ 해결된 건은 [실패] 목록에서 사라진다(재발송을 유도하지 않는다)',
        await rowOf(`문자UI-A${SUF}`).count() === 0,
        '아직 목록에 남아 있다 — 옛 실패가 이후 성공을 덮고 있다')
      await page.locator('[data-testid="history-status-all"]').click()
      check('★ 해결된 건에는 [다시 보내기]가 없다',
        await rowOf(`문자UI-A${SUF}`).first().locator('[data-testid="row-resend"]').count() === 0)
      const rowLocC = page.locator('[data-testid="sms-row"]').filter({ hasText: `문자UI-A${SUF}` }).first()
      const statusC = await rowLocC.locator('[data-testid="row-status"]').getAttribute('data-status')
      check('★ 실패를 재발송으로 해결하면 상태가 "발송됨"이다(마지막 결과가 현재 상태)',
        statusC === 'sent', `상태=${statusC} · ${(await rowLocC.innerText()).replace(/\n/g, ' ')}`)
      check('같은 사람에게 2번 시도한 것을 "2명"으로 세지 않는다',
        !/2명 중/.test(await rowLocC.innerText()), (await rowLocC.innerText()).replace(/\n/g, ' '))

      // 옛 '번호없음'도 이후 발송이 있으면 해소된 것이다 —
      // 종전엔 그 행이 이후 성공을 덮고 "연락처를 채우세요"라고 잘못 안내했다
      await raw.from('sms_send_log').delete().eq('customer_id', cidA).eq('visit_date', TOMORROW)
      await raw.from('sms_send_log').insert([
        { kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: TOMORROW,
          to_phone: null, content: '(발송 안 됨)', status: 'no_phone', error: '전화번호 없음', sent_by: userId, created_at: t0 },
        { kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: TOMORROW,
          to_phone: '01011112222', content: 'x', status: 'sent', sent_by: userId, created_at: t1 },
      ])
      await reloadHistory()
      const rowLocD = page.locator('[data-testid="sms-row"]').filter({ hasText: `문자UI-A${SUF}` }).first()
      const statusD = await rowLocD.locator('[data-testid="row-status"]').getAttribute('data-status')
      check('★ 번호를 채우고 보냈으면 "번호없음"이 아니다',
        statusD === 'sent', `상태=${statusD} · ${(await rowLocD.innerText()).replace(/\n/g, ' ')}`)

      await raw.from('sms_send_log').delete().eq('customer_id', cidA).eq('visit_date', TOMORROW)
    }

    console.log('\n— 실패를 본 자리에서 다시 보낸다')
    {
      // 계획이 없는 발송(임의) — 그날 목록이 없으므로 임의 발송 경로로 연다
      await raw.from('sms_send_log').insert({
        kind: 'adhoc', customer_id: cidD, plan_item_ids: [], visit_date: kst(3),
        to_phone: '01099990000', content: 'x', status: 'failed', error: '수신거부', sent_by: userId,
      })
      await reloadHistory()
      const adhocRow = rowOf(`문자UI-무계획${SUF}`).first()
      check('★ 실패한 임의 발송 행에 [다시 보내기]가 있다 — 없으면 재발송할 방법이 아예 없다',
        await adhocRow.locator('[data-testid="row-resend"]').count() === 1)
      await adhocRow.locator('[data-testid="row-resend"]').click()
      await page.waitForSelector('[data-testid="adhoc-date"]', { timeout: 20000 })
      check('★ 방문일이 미리 채워진다(아는 값을 다시 입력시키지 않는다)',
        await page.locator('[data-testid="adhoc-date"]').inputValue() === kst(3),
        await page.locator('[data-testid="adhoc-date"]').inputValue())
      await page.locator('[data-testid="sms-modal"] button', { hasText: '닫기' }).first().click()
      await raw.from('sms_send_log').delete().eq('customer_id', cidD)

      // 계획이 있는 방문 — 그날 목록은 그대로, 체크는 그 고객만
      await raw.from('sms_send_log').insert({
        kind: 'pre_visit', customer_id: cidB, plan_item_ids: [], visit_date: TOMORROW,
        to_phone: '01055556666', content: 'x', status: 'failed', error: '일시 오류', sent_by: userId,
      })
      await reloadHistory()
      await rowOf(`문자UI-B${SUF}`).first().locator('[data-testid="row-resend"]').click()
      await page.waitForSelector('[data-testid="sms-group"]', { timeout: 20000 })
      const pickedOf = async (cid: string) =>
        page.locator(`[data-testid="sms-group"][data-customer-id="${cid}"]`).getAttribute('data-picked')
      check('★ 다시 보낼 고객만 체크돼 있다', await pickedOf(cidB) === '1', String(await pickedOf(cidB)))
      check('★ 같은 날 다른 고객은 **목록에 남되 해제**돼 있다(옆 고객에게 또 나가지 않게)',
        await pickedOf(cidA) === '0' && await pickedOf(cidC) === '0',
        `A=${await pickedOf(cidA)} C=${await pickedOf(cidC)}`)
      check('★ 발송 버튼의 통수가 그 1곳뿐이다',
        /^1통 발송/.test((await page.locator('[data-testid="sms-send"]').innerText()).trim()),
        await page.locator('[data-testid="sms-send"]').innerText())
      await page.locator('[data-testid="sms-modal"] button', { hasText: '닫기' }).first().click()
      await raw.from('sms_send_log').delete().eq('customer_id', cidB)
    }

    console.log('\n— 달력 문자 패널: 자동 준비')
    await page.goto(`${BASE}/inspections/calendar?sms=1`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="cal-sms-panel"]', { timeout: 30000 })
    check('★ ?sms=1로 들어오면 문자 패널이 열린 채 시작한다(위젯·이력 화면의 착지점)',
      await page.locator('[data-testid="cal-sms-panel"]').isVisible())
    await page.waitForSelector('[data-testid="sms-notice"]', { timeout: 30000 })

    const notices = await page.locator('[data-testid="sms-notice"]').allInnerTexts()
    check('자동 준비 줄이 그려진다', notices.length >= 1, notices.join(' | '))
    check('★ 내일 방문 건이 미발송으로 집계된다', notices.some(t => /내일/.test(t) && /미발송/.test(t)), notices.join(' | '))

    console.log('\n— S8: 모달 (자동 준비 → 확인·발송)')
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
    // 미확정 차단 폐지(2026-09-12) — 내일 방문 모달엔 발송 불가 사유가 없어야 한다
    // (남은 불가 사유는 '지난 방문일'뿐인데 내일 건이라 해당 없음). 상시 불가 띠가 남아 있으면 회귀다.
    check('★ 발송 불가 표시가 없다(미확정 차단 폐지 — 전건 발송 가능)',
      (await page.locator('[data-testid="sms-unsendable"]').count()) === 0)
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

    // ── 미치환 변수 — 인라인 편집 오타가 글자 그대로 고객에게 나가는 것을 막는다 ──
    // 문구 **설정** 저장은 이미 알 수 없는 변수를 거부하지만, 이 인라인 편집은 그 검사를 비켜 간다.
    {
      const bodyBox = page.locator('[data-testid="sms-body"]')
      const original = await bodyBox.inputValue()
      await bodyBox.fill('{고객명}님 {점검일자}에 방문합니다')   // 올바른 변수는 {점검일}
      await page.waitForSelector('[data-testid="sms-unresolved-warn"]', { timeout: 10000 })
      const warn = await page.locator('[data-testid="sms-unresolved-warn"]').innerText()
      check('★ 미치환 변수를 이름까지 짚어 경고한다', /점검일자/.test(warn), warn.replace(/\n/g, ' '))
      check('★ 그 상태로는 발송 버튼이 눌리지 않는다(문자는 되돌릴 수 없다)',
        await page.locator('[data-testid="sms-send"]').isDisabled())
      // 고치면 즉시 풀려야 한다 — 안 풀리면 사용자는 원인을 못 찾고 갇힌다
      await bodyBox.fill(original)
      await page.waitForSelector('[data-testid="sms-unresolved-warn"]', { state: 'detached', timeout: 10000 })
      check('고치면 경고가 사라지고 다시 보낼 수 있다',
        !(await page.locator('[data-testid="sms-send"]').isDisabled()))
    }

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

    console.log('\n— Q-14: 달력 날짜 패널 (날짜 전달 방식)')
    await page.goto(`${BASE}/inspections/calendar?day=${TOMORROW}`, { waitUntil: 'domcontentloaded' })
    // 「이 날 문자」 카드 — 날짜를 누르면 보낼지 말지부터 보인다. 세는 일이 끝난 뒤에 읽는다
    await page.waitForSelector('[data-testid="day-sms-card"][data-state="unsent"]', { timeout: 30000 })
    {
      const cardText = await page.locator('[data-testid="day-sms-card"]').innerText()
      const total = Number(/이 날 방문 (\d+)곳/.exec(cardText)?.[1] ?? -1)
      const unsent = Number(/아직 안 보냄 (\d+)곳/.exec(cardText)?.[1] ?? -1)
      // 이 실행이 심은 방문: A·B·C(보낼 수 있음) + E(번호 없음). 실데이터가 더 있을 수 있어 하한으로 본다
      check('★ 카드가 그날 방문 수와 아직 안 보낸 수를 말한다', total >= 4 && unsent >= 3 && unsent < total,
        cardText.replace(/\n/g, ' '))
      check('★ 보낼 수 없는 곳도 카드에서 말한다(번호 없는 고객 E가 분모에 있다)',
        /보낼 수 없음 \d+곳/.test(cardText), cardText.replace(/\n/g, ' '))
      check('★ 버튼에 찍힌 수 = 아직 안 보낸 수',
        (await page.locator('[data-testid="calendar-sms-day"]').innerText()).includes(`${unsent}곳에 보내기`),
        await page.locator('[data-testid="calendar-sms-day"]').innerText())

      // 이미 보낸 곳은 체크에서 빠진다 — 날짜를 누를 때마다 같은 고객에게 또 나가지 않게
      await raw.from('sms_send_log').insert({
        kind: 'pre_visit', customer_id: cidB, plan_item_ids: [], visit_date: TOMORROW,
        to_phone: '01055556666', content: 'x', status: 'sent', sent_by: userId,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="day-sms-card"][data-state="unsent"]', { timeout: 30000 })
      const after = Number(/아직 안 보냄 (\d+)곳/.exec(await page.locator('[data-testid="day-sms-card"]').innerText())?.[1] ?? -1)
      check('★ 한 곳을 보내면 「아직 안 보냄」이 하나 준다', after === unsent - 1, `${unsent} → ${after}`)
      await page.locator('[data-testid="calendar-sms-day"]').click()
      await page.waitForSelector('[data-testid="sms-group"]', { timeout: 20000 })
      const pk = async (cid: string) =>
        page.locator(`[data-testid="sms-group"][data-customer-id="${cid}"]`).getAttribute('data-picked')
      check('★ [N곳에 보내기]는 **이미 보낸 곳을 체크하지 않는다**(목록에는 남는다)',
        await pk(cidB) === '0' && await pk(cidA) === '1' && await pk(cidC) === '1',
        `A=${await pk(cidA)} B=${await pk(cidB)} C=${await pk(cidC)}`)
      await page.locator('[data-testid="sms-modal"] button', { hasText: '닫기' }).first().click()
      await raw.from('sms_send_log').delete().eq('customer_id', cidB)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="day-sms-card"][data-state="unsent"]', { timeout: 30000 })
    }
    check('툴바에 [문자 보내기]가 있다', await page.locator('[data-testid="calendar-sms-toolbar"]').isVisible())
    // 패널 고객명 검색으로 화면을 이 실행이 심은 행으로 좁힌다(실데이터가 있는 DB에서도 돌게)
    await page.locator('input[placeholder="고객명 검색..."]').fill(`문자UI-`)
    await page.waitForTimeout(400)
    await page.locator('[data-testid="calendar-sms-day"]').click()
    await page.waitForSelector('[data-testid="sms-group"]', { timeout: 20000 })
    const calGroups = await page.locator('[data-testid="sms-group"]').allInnerTexts()
    check('★ 달력에서 열어도 자체점검 포함 전 건이 뜬다 — 달력이 무엇을 로드했는지와 무관(Q-14)',
      calGroups.some(t => t.includes(`문자UI-A${SUF}`)) && calGroups.some(t => t.includes(`문자UI-B${SUF}`)),
      calGroups.join(' | ').slice(0, 300))
    check('★ 아무에게도 안 보낸 날은 전원이 체크돼 있다',
      await page.locator(`[data-testid="sms-group"][data-customer-id="${cidB}"]`).getAttribute('data-picked') === '1' &&
      await page.locator(`[data-testid="sms-group"][data-customer-id="${cidC}"]`).getAttribute('data-picked') === '1')
    await page.locator('[data-testid="sms-modal"] button', { hasText: '닫기' }).first().click()

    console.log('\n— 달력 날짜 패널: 골라 보내기')
    {
      const picked = async (cid: string) =>
        page.locator(`[data-testid="sms-group"][data-customer-id="${cid}"]`).getAttribute('data-picked')
      const sendText = async () => (await page.locator('[data-testid="sms-send"]').innerText()).trim()
      const closeModal = async () => page.locator('[data-testid="sms-modal"] button', { hasText: '닫기' }).first().click()

      // 한 곳 — 행의 문자 아이콘
      await page.locator(`[data-testid="day-sms-row"][data-customer-id="${cidB}"]`).click()
      await page.waitForSelector('[data-testid="sms-group"]', { timeout: 20000 })
      check('★ 행 아이콘으로 열면 그 고객만 체크돼 있다', await picked(cidB) === '1', String(await picked(cidB)))
      check('★ 안 고른 고객은 **목록에 남되 해제**돼 있다(「안 고른 것」과 「없는 것」이 구별된다)',
        await picked(cidA) === '0' && await picked(cidC) === '0', `A=${await picked(cidA)} C=${await picked(cidC)}`)
      check('★ 통수가 1통이다', /^1통 발송/.test(await sendText()), await sendText())
      await closeModal()

      // 여러 곳 — 선택 모드
      await page.locator('[data-testid="day-sms-toggle"]').click()
      check('선택 모드에서는 행 아이콘이 사라진다(두 가지 길이 한 화면에 겹치지 않게)',
        await page.locator('[data-testid="day-sms-row"]').count() === 0)
      const sendBtn = page.locator('[data-testid="day-sms-send"]')
      check('★ 아무것도 안 고르면 [문자]가 잠긴다', await sendBtn.isDisabled())
      await page.locator(`[data-testid="day-sms-check"][data-customer-id="${cidB}"]`).check()
      await page.locator(`[data-testid="day-sms-check"][data-customer-id="${cidC}"]`).check()
      check('★ 고른 수가 버튼에 찍힌다', /문자 2곳/.test(await sendBtn.innerText()), await sendBtn.innerText())
      await sendBtn.click()
      await page.waitForSelector('[data-testid="sms-group"]', { timeout: 20000 })
      check('★ 고른 두 곳만 체크돼 있다',
        await picked(cidB) === '1' && await picked(cidC) === '1' && await picked(cidA) === '0',
        `A=${await picked(cidA)} B=${await picked(cidB)} C=${await picked(cidC)}`)
      check('★ 달력에서 고른 수 = 발송 통수(수신자 1명씩)', /^2통 발송/.test(await sendText()), await sendText())
      await closeModal()

      // [전체]는 보이는 것만
      await page.locator('[data-testid="day-sms-clear"]').click()
      await page.locator('input[placeholder="고객명 검색..."]').fill(`문자UI-B${SUF}`)
      await page.waitForTimeout(400)
      await page.locator('[data-testid="day-sms-all"]').click()
      check('★ [전체]는 **지금 화면에 보이는 방문만** 담는다', /문자 1곳/.test(await sendBtn.innerText()), await sendBtn.innerText())
      await page.locator('[data-testid="day-sms-toggle"]').click()
    }

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
    await page.goto(`${BASE}/inspections/calendar?sms=1`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="sms-notice"]', { timeout: 30000 })
    // 배너(달력 문자 패널의 자동 준비)가 세는 미발송 곳 수 — 뱃지·위젯이 이 수와 같아야 한다(같은 함수로 세므로)
    const bannerUnsent = (await page.locator('[data-testid="sms-notice"]').allInnerTexts())
      // 단위는 '건'(고객+방문일)이다 — '곳'은 한 고객이 두 번 방문할 때 거짓이 되어 바꿨다
      .map(t => /미발송 (\d+)건/.exec(t)?.[1]).filter(Boolean).reduce((n, v) => n + Number(v), 0)
    check('배너에 미발송이 잡혀 있다(뱃지 비교의 전제)', bannerUnsent > 0, String(bannerUnsent))

    // 뱃지는 **마운트 후 클라이언트에서** 채워진다(렌더 경로에서 뺐기 때문 — 실측 497ms).
    // 즉시 단언하면 부하가 걸린 상황에서만 실패한다: 단독 실행에서는 빨라서 늘 통과하고,
    // 전체 스위트 안에서만 깨져 원인 찾기가 어려워진다. 반드시 나타날 때까지 기다린다.
    const badge = page.locator('[data-testid="sidebar-sms-badge"]')
    await badge.waitFor({ timeout: 30000 }).catch(() => {})
    check('★ 사이드바에 미발송 뱃지가 뜬다(종전에는 액션만 있고 호출부가 없었다)',
      await badge.count() === 1, String(await badge.count()))
    // 뱃지는 '보낼 것' + '보낼 수 **없는** 것'을 함께 센다. 후자를 빼면 번호 없는 고객만
    // 골라 뱃지에서 지우는 셈이라, 내일 방문 전부가 번호 없음인 날 뱃지가 사라진다.
    const bannerBlocked = Number(
      /보낼 수 없는 건 (\d+)건/.exec(await page.locator('[data-testid="cal-sms-panel"]').innerText())?.[1] ?? 0)
    check('전제: 보낼 수 없는 건이 1건 이상 잡혀 있다(번호 없는 고객 E)', bannerBlocked >= 1, String(bannerBlocked))
    // 도구줄 버튼의 숫자도 같은 값이어야 한다 — 패널을 열기 전에 보는 유일한 신호다
    const toolbarCount = page.locator('[data-testid="calendar-sms-count"]')
    await toolbarCount.waitFor({ timeout: 30000 }).catch(() => {})
    check('★ 도구줄 버튼 숫자 = 패널의 (미발송 + 보낼 수 없음)',
      (await toolbarCount.innerText().catch(() => '(없음)')).trim() === String(bannerUnsent + bannerBlocked),
      `버튼 ${await toolbarCount.innerText().catch(() => '(없음)')} vs 패널 ${bannerUnsent}+${bannerBlocked}`)
    check('★ 뱃지 수 = 배너의 (미발송 + 보낼 수 없음) — 두 곳이 다르면 어느 쪽을 믿을지 모른다',
      (await badge.innerText()).trim() === String(bannerUnsent + bannerBlocked),
      `뱃지 ${await badge.innerText()} vs 배너 미발송 ${bannerUnsent} + 보낼수없음 ${bannerBlocked}`)

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
    const widget = page.locator('[data-testid="dash-sms-widget"]')
    await widget.waitFor({ timeout: 30000 })
    check('★ 대시보드 위젯이 그려진다', await widget.count() === 1)
    const wText = await widget.innerText()
    // ★ 부분 문자열이 아니라 **두 축을 각각** 본다 — 종전엔 `${bannerUnsent}곳` 포함 여부만 봐서
    //   뱃지≠위젯이어도 둘 다 통과했다(3차 판정 지적). 세 화면이 같은 값을 말해야 한다.
    const wUnsent = Number(/보낼 사전 안내 (\d+)건/.exec(wText)?.[1] ?? -1)
    const wBlocked = Number(/보낼 수 없음 (\d+)건/.exec(wText)?.[1] ?? 0)
    check('★ 위젯 = 배너 (미발송·보낼수없음 각각 일치)',
      wUnsent === bannerUnsent && wBlocked === bannerBlocked,
      `위젯 ${wUnsent}/${wBlocked} vs 배너 ${bannerUnsent}/${bannerBlocked} · ${wText.replace(/\n/g, ' ')}`)
    // 뱃지는 여기서 다시 읽지 않는다 — 사이드바는 **활성 그룹만 펼치므로**(sidebar.tsx:272)
    // /dashboard에서는 문자 발송 항목 자체가 DOM에 없다. 없는 것을 기다리면 20초 타임아웃이고,
    // catch로 삼키면 '뱃지 0'과 구별이 안 돼 거짓 실패가 된다(둘 다 실제로 겪었다).
    // 세 화면 일치는 **배너를 축으로** 이미 닫혀 있다: 위(540행) 뱃지=배너, 여기(553행) 위젯=배너.
    check('★ 위젯이 **보내는 곳**(달력 문자 패널)으로 잇는다 — 이력 화면으로 가면 보낼 수단이 없다',
      (await widget.getAttribute('href')) === '/inspections/calendar?sms=1', await widget.getAttribute('href') ?? '')

    await page.goto(`${BASE}/inspections/calendar?sms=1`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="cal-sms-panel"]', { timeout: 30000 })
    check('패널에 [고객 골라 보내기]가 있다(Q-17 세 번째 진입)',
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
    await page.goto(`${BASE}/inspections/calendar?sms=1`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="sms-notice"]', { timeout: 30000 })
    check('★ 자동 준비 줄 수 = 설정된 시점 수', await page.locator('[data-testid="sms-notice"]').count() === 2,
      String(await page.locator('[data-testid="sms-notice"]').count()))

    console.log('\n— 사전 안내 시점 「사용 안 함」')
    {
      const rulesInDb = async () => {
        const { data } = await raw.from('company_profile')
          .select('sms_lead_rules').order('id', { ascending: true }).limit(1).maybeSingle()
        return JSON.stringify((data as { sms_lead_rules: unknown } | null)?.sms_lead_rules)
      }
      const waitRules = async (want: string) => {
        const start = Date.now()
        while (Date.now() - start < 15000) { if (await rulesInDb() === want) return true; await page.waitForTimeout(400) }
        return false
      }
      await page.goto(`${BASE}/settings/message-templates`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="lead-rule-tag"]', { timeout: 30000 })
      const offBox = page.locator('[data-testid="lead-rule-off"]')
      check('전제: 켜져 있는 상태(시점 2개·체크 해제)',
        await page.locator('[data-testid="lead-rule-tag"]').count() === 2 && !(await offBox.isChecked()))
      await offBox.click()   // check()는 즉시 상태를 확인한다 — 이 체크박스는 저장이 끝나야 바뀐다(DB로 기다린다)
      check('★ 체크하면 빈 시점으로 저장된다', await waitRules('[]'), await rulesInDb())
      await page.waitForSelector('[data-testid="lead-rule-off-note"]', { timeout: 15000 })
      check('★ 꺼졌다고 화면이 말하고, 시점 입력이 사라진다',
        await page.locator('[data-testid="lead-rule-tag"]:visible').count() === 0 &&
        await page.locator('[data-testid="lead-rule-input"]').count() === 0)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="lead-rule-off-note"]', { timeout: 30000 })
      check('★ 새로 열어도 체크가 유지된다(빈 값을 기본 [내일]로 되살리지 않는다)', await offBox.isChecked())

      await page.goto(`${BASE}/inspections/calendar?sms=1`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="sms-auto-off"]', { timeout: 30000 })
      check('★ 달력 패널이 「사용하지 않습니다」를 말한다 — "보낼 안내 없음 ✓"가 아니다',
        await page.locator('[data-testid="sms-notice"]').count() === 0 &&
        !/보낼 안내 없음/.test(await page.locator('[data-testid="cal-sms-panel"]').innerText()))
      check('★ 꺼 둔 사람에게 「안내 못 하고 지난 방문」을 세어 보이지 않는다',
        await page.locator('[data-testid="sms-overdue"]').count() === 0)
      check('★ 직접 보내기는 그대로 있다',
        await page.locator('[data-testid="cal-sms-date"]').isVisible() &&
        await page.locator('[data-testid="sms-adhoc-toolbar"]').isVisible())
      // 숫자는 마운트 후에 온다 — 「없다」를 단언하려면 올 시간을 준 뒤에 본다(내일 미발송은 여전히 있다)
      await page.waitForTimeout(4000)
      check('★ 도구줄 버튼·사이드바에 숫자가 없다',
        await page.locator('[data-testid="calendar-sms-count"]').count() === 0 &&
        await page.locator('[data-testid="sidebar-sms-badge"]').count() === 0)
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      check('★ 대시보드 알림도 뜨지 않는다',
        await page.locator('[data-testid="dash-sms-widget"]').count() === 0)

      await page.goto(`${BASE}/settings/message-templates`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="lead-rule-off-note"]', { timeout: 30000 })
      await offBox.click()
      check('★ 다시 켜면 끄기 전 시점이 되살아난다(껐다 켠 것만으로 설정을 잃지 않는다)',
        await waitRules('[3,1]'), await rulesInDb())
      await page.waitForSelector('[data-testid="lead-rule-tag"]', { timeout: 15000 })
      check('시점 태그가 다시 보인다', await page.locator('[data-testid="lead-rule-tag"]:visible').count() === 2)
    }
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
